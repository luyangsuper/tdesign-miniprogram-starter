const cloud = require('wx-server-sdk');
const { toMs } = require('./toMs');
const { isCategoryOptional, normalizeContentType } = require('./contentType');
const { invalidateListCaches } = require('./invalidateCaches');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const BATCH = 10;

function isPublishReady(pack) {
  if (!pack) return false;
  const contentType = normalizeContentType(pack.contentType);
  if (contentType === 'video') return false;
  if (!String(pack.title || '').trim()) return false;
  if (!pack.coverFileID) return false;
  const emojiCount =
    Number(pack.emojiCount) ||
    (Array.isArray(pack.emojiFileIDs) ? pack.emojiFileIDs.length : 0);
  if (!emojiCount) return false;
  if (!isCategoryOptional(contentType) && !String(pack.categoryId || '').trim()) {
    return false;
  }
  return true;
}

function updatedCount(res) {
  const stats = (res && res.stats) || {};
  return Number(stats.updated) || 0;
}

async function sendNotifySafe(pack) {
  try {
    // eslint-disable-next-line global-require
    const { sendNewPackNotify } = require('./notify');
    return await sendNewPackNotify(cloud, db, pack);
  } catch (e) {
    console.warn('[adminPublishDuePacks] notify load/send', e.message || e);
    return { sent: 0, skipped: 0, total: 0, lastError: e.message || 'notify fail' };
  }
}

/**
 * 抢通知锁：把 notifyOnPublish true → false。
 * 只有抢到的那一路才发订阅消息，避免定时器 + 懒触发双推。
 */
async function claimNotifySlot(packId) {
  try {
    const res = await db
      .collection('packs')
      .where({
        _id: packId,
        status: 'published',
        notifyOnPublish: true,
      })
      .update({
        data: {
          notifyOnPublish: false,
          notifyClaimedAt: Date.now(),
          updatedAt: db.serverDate(),
        },
      });
    return updatedCount(res) > 0;
  } catch (e) {
    console.warn('[adminPublishDuePacks] claimNotify', packId, e.message || e);
    // 降级：读一次再写（仍可能极窄窗口双推，但强于必双推）
    try {
      const doc = await db.collection('packs').doc(packId).get();
      const p = doc.data;
      if (!p || p.status !== 'published' || !p.notifyOnPublish) return false;
      if (toMs(p.notifiedAt) > 0) return false;
      await db.collection('packs').doc(packId).update({
        data: {
          notifyOnPublish: false,
          notifyClaimedAt: Date.now(),
          updatedAt: db.serverDate(),
        },
      });
      return true;
    } catch (err) {
      return false;
    }
  }
}

async function releaseNotifySlot(packId) {
  try {
    await db.collection('packs').doc(packId).update({
      data: {
        notifyOnPublish: true,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    /* ignore */
  }
}

async function runNotifyOnce(pack) {
  const packId = pack._id;
  if (toMs(pack.notifiedAt) > 0) {
    return { sent: 0, skipped: 0, total: 0, lastError: '', skippedReason: 'already_notified' };
  }
  const claimed = await claimNotifySlot(packId);
  if (!claimed) {
    return { sent: 0, skipped: 0, total: 0, lastError: '', skippedReason: 'claim_lost' };
  }
  const notify = await sendNotifySafe({ ...pack, status: 'published' });
  const leavePending =
    Number(notify.sent) === 0 &&
    Number(notify.total) > 0 &&
    !!notify.lastError;
  if (leavePending) {
    // 推送全失败：放回槽位，下轮可补
    await releaseNotifySlot(packId);
  }
  return notify;
}

async function publishOne(pack, now) {
  const packId = pack._id;
  if (!isPublishReady(pack)) {
    const errMsg = '内容未齐，定时上架已跳过，请补全后保存';
    if (String(pack.scheduleError || '') !== errMsg) {
      await db.collection('packs').doc(packId).update({
        data: {
          scheduleError: errMsg,
          updatedAt: db.serverDate(),
        },
      });
    }
    return { packId, ok: false, code: 'NOT_READY' };
  }

  const publishAt = toMs(pack.publishAt);
  if (!(publishAt > 0 && publishAt <= now)) {
    return { packId, ok: false, code: 'NOT_DUE', publishAt, now };
  }

  const shouldNotify = pack.notifyOnPublish !== false;

  // 原子上架：只有 status 仍是 draft 时才能改成功，并发只会有一个赢家
  let won = false;
  try {
    const res = await db
      .collection('packs')
      .where({
        _id: packId,
        status: 'draft',
      })
      .update({
        data: {
          status: 'published',
          publishedAt: db.serverDate(),
          publishAt: 0,
          notifyOnPublish: !!shouldNotify,
          scheduleError: '',
          updatedAt: db.serverDate(),
        },
      });
    won = updatedCount(res) > 0;
  } catch (e) {
    console.warn('[adminPublishDuePacks] atomic publish fallback', e.message || e);
    const fresh = await db.collection('packs').doc(packId).get();
    const cur = fresh.data;
    if (!cur || cur.status !== 'draft') {
      return { packId, ok: false, code: 'RACE' };
    }
    const curAt = toMs(cur.publishAt);
    if (!(curAt > 0 && curAt <= now)) {
      return { packId, ok: false, code: 'NOT_DUE', publishAt: curAt, now };
    }
    await db.collection('packs').doc(packId).update({
      data: {
        status: 'published',
        publishedAt: cur.publishedAt || db.serverDate(),
        publishAt: 0,
        notifyOnPublish: !!shouldNotify,
        scheduleError: '',
        updatedAt: db.serverDate(),
      },
    });
    won = true;
  }

  if (!won) {
    return { packId, ok: false, code: 'RACE' };
  }

  let notify = { sent: 0, skipped: 0, total: 0, lastError: '' };
  if (shouldNotify) {
    notify = await runNotifyOnce({ ...pack, _id: packId, status: 'published' });
  }

  return {
    packId,
    ok: true,
    notified: shouldNotify && Number(notify.sent) > 0,
    notifySkipped: notify.skippedReason || '',
    notify,
    publishAt,
    at: now,
  };
}

async function retryPendingNotify(limit = BATCH) {
  let snap;
  try {
    snap = await db
      .collection('packs')
      .where({
        status: 'published',
        notifyOnPublish: true,
      })
      .limit(limit)
      .get();
  } catch (e) {
    console.warn('[adminPublishDuePacks] retry query', e.message || e);
    return { retried: 0, results: [] };
  }

  const list = snap.data || [];
  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const pack = list[i];
    if (toMs(pack.notifiedAt) > 0) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await db.collection('packs').doc(pack._id).update({
          data: {
            notifyOnPublish: false,
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        /* ignore */
      }
      results.push({ packId: pack._id, ok: true, skipped: 'already_notified' });
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const notify = await runNotifyOnce(pack);
    results.push({
      packId: pack._id,
      ok: !notify.skippedReason || notify.skippedReason === 'already_notified',
      notify,
    });
  }
  return { retried: list.length, results };
}

async function scanAndPublishDue(limit = BATCH) {
  const now = Date.now();
  let snap;
  try {
    snap = await db.collection('packs').where({ status: 'draft' }).limit(100).get();
  } catch (err) {
    console.error('[adminPublishDuePacks] draft query failed', err.message || err);
    return {
      scanned: 0,
      published: 0,
      results: [],
      now,
      error: err.message || String(err),
    };
  }

  const rows = snap.data || [];
  const due = rows
    .filter((p) => {
      const at = toMs(p.publishAt);
      return at > 0 && at <= now;
    })
    .sort((a, b) => toMs(a.publishAt) - toMs(b.publishAt))
    .slice(0, limit);

  console.log(
    '[adminPublishDuePacks] now=',
    now,
    'drafts=',
    rows.length,
    'due=',
    due.length,
    due.map((p) => ({
      id: p._id,
      publishAt: toMs(p.publishAt),
      title: p.title,
    })),
  );

  const results = [];
  for (let i = 0; i < due.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await publishOne(due[i], now));
  }

  if (results.some((r) => r.ok)) {
    try {
      await invalidateListCaches(db);
    } catch (e) {
      console.warn('[adminPublishDuePacks] invalidate', e.message || e);
    }
  }

  return {
    scanned: due.length,
    published: results.filter((r) => r.ok).length,
    results,
    now,
  };
}

/**
 * 定时触发 / 懒触发：扫到期草稿 → 上架 → 推订阅通知。
 * 不鉴权：只把已到期 draft 改为 published。
 */
exports.main = async () => {
  try {
    const published = await scanAndPublishDue(BATCH);
    const notifyRetry = await retryPendingNotify(BATCH);
    return { ok: true, data: { ...published, notifyRetry } };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'FAIL', message: e.message || '定时上架失败' };
  }
};
