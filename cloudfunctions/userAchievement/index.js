const cloud = require('wx-server-sdk');
const { DEFAULT_ACHIEVEMENTS } = require('./achievements');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MAX = 1000;

function shanghaiDayKey(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function prevDayKey(dayKey) {
  const [y, m, d] = String(dayKey || '')
    .split('-')
    .map((n) => Number(n));
  if (!y || !m || !d) return '';
  const utc = Date.UTC(y, m - 1, d, 12, 0, 0);
  return shanghaiDayKey(utc - 24 * 60 * 60 * 1000);
}

async function safeCount(collection, where) {
  try {
    const col = where
      ? db.collection(collection).where(where)
      : db.collection(collection);
    const res = await col.count();
    return res.total || 0;
  } catch (e) {
    return 0;
  }
}

async function resolveTempUrls(fileIDs = []) {
  const ids = Array.from(new Set((fileIDs || []).map((x) => String(x || '').trim()).filter(Boolean)));
  const map = {};
  if (!ids.length) return map;
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      // eslint-disable-next-line no-await-in-loop
      const res = await cloud.getTempFileURL({ fileList: batch });
      (res.fileList || []).forEach((item) => {
        if (item && item.fileID && item.tempFileURL) {
          map[item.fileID] = item.tempFileURL;
        }
      });
    }
  } catch (e) {
    console.warn('[userAchievement] tempUrl', e.message || e);
  }
  return map;
}

function normalizeDefs(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : DEFAULT_ACHIEVEMENTS;
  return list
    .map((d, i) => ({
      id: String(d.id || '').trim(),
      type: String(d.type || '').trim(),
      threshold: Math.max(0, Number(d.threshold) || 0),
      title: String(d.title || '').trim() || String(d.id || ''),
      desc: String(d.desc || '').trim(),
      frameId: String(d.frameId || '').trim(),
      sort: Number(d.sort) || (i + 1) * 10,
    }))
    .filter((d) => d.id && d.type);
}

/** 兼容误用 node-sdk 写成 { data: {...} } 的旧文档 */
function unwrapRecord(row) {
  if (!row || typeof row !== 'object') return row;
  const nested = row.data;
  if (
    nested &&
    typeof nested === 'object' &&
    !Array.isArray(nested) &&
    (nested.fileID || nested.key || nested.defs || nested.status)
  ) {
    return { ...nested, _id: row._id || nested._id };
  }
  return row;
}

function frameAccessOf(f) {
  const a = String((f && f.access) || '').trim();
  if (a === 'vip' || a === 'paid' || a === 'pool' || a === 'achievement') return a;
  return 'achievement';
}

function toExpireMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v > 0 ? v : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v.getTime === 'function') {
    const t = v.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

function userIsVip(user) {
  return toExpireMs(user && user.vipExpireAt) > Date.now();
}

/**
 * 卸下无效佩戴：会员过期 / 框已下架 / pool / 未拥有的付费·成就框
 * @param {Set<string>} [ownedSet]
 */
async function clearInvalidEquippedFrame(openid, user, ownedSet) {
  const equipped = String((user && user.avatarFrameId) || '').trim();
  if (!equipped) return { avatarFrameId: '', cleared: false };

  let frame = null;
  try {
    const snap = await db.collection('avatar_frames').doc(equipped).get();
    frame = unwrapRecord((snap && snap.data) || null);
  } catch (_) {
    frame = null;
  }

  let reason = '';
  if (!frame || !frame.fileID || (frame.status && frame.status !== 'published')) {
    reason = 'missing';
  } else {
    const access = frameAccessOf(frame);
    if (access === 'pool') {
      reason = 'pool';
    } else if (access === 'vip' && !userIsVip(user)) {
      reason = 'vip_expired';
    } else if (
      (access === 'paid' || access === 'achievement') &&
      ownedSet &&
      !ownedSet.has(equipped)
    ) {
      reason = 'not_owned';
    }
  }

  if (!reason) return { avatarFrameId: equipped, cleared: false };

  try {
    await db.collection('users').doc(openid).update({
      data: { avatarFrameId: '', updatedAt: db.serverDate() },
    });
  } catch (_) {
    /* ignore */
  }
  return { avatarFrameId: '', cleared: true, reason };
}

async function loadAchievementDefsRaw() {
  try {
    const snap = await db.collection('app_config').doc('achievements').get();
    const row = unwrapRecord(snap.data || {});
    return normalizeDefs(row && row.defs);
  } catch (e) {
    return normalizeDefs(DEFAULT_ACHIEVEMENTS);
  }
}

async function loadPublishedFrames() {
  const rows = [];
  let skip = 0;
  while (rows.length < 500) {
    let batch = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await db.collection('avatar_frames').skip(skip).limit(100).get();
      batch = res.data || [];
    } catch (e) {
      break;
    }
    if (!batch.length) break;
    rows.push(...batch);
    skip += batch.length;
    if (batch.length < 100) break;
  }
  return rows
    .map(unwrapRecord)
    .filter((f) => f && f.fileID && (f.status === 'published' || !f.status))
    .slice()
    .sort(
      (a, b) =>
        (Number(a.sort) || 0) - (Number(b.sort) || 0) ||
        String(a._id || a.key || '').localeCompare(String(b._id || b.key || '')),
    );
}

/** 成就未绑框时按排序自动绑定，并写回 app_config（只用 achievement 池） */
async function ensureDefsBound(defs, frames) {
  const achFrames = (frames || []).filter(
    (f) => frameAccessOf(f) === 'achievement',
  );
  const ids = achFrames
    .map((f) => String((f && (f._id || f.key)) || '').trim())
    .filter(Boolean);
  const idSet = new Set(
    (frames || [])
      .map((f) => String((f && (f._id || f.key)) || '').trim())
      .filter(Boolean),
  );
  let changed = false;
  const next = defs.map((d, i) => {
    if (d.frameId && idSet.has(d.frameId)) return d;
    const fid = ids[i] || '';
    if (fid && fid !== d.frameId) {
      changed = true;
      return { ...d, frameId: fid };
    }
    return d;
  });
  if (changed) {
    try {
      await db.collection('app_config').doc('achievements').set({
        data: { defs: next, updatedAt: Date.now(), autoBound: true },
      });
    } catch (e) {
      console.warn('[achievement] autoBind', e.message || e);
    }
  }
  return next;
}

async function loadUser(openid) {
  try {
    const snap = await db.collection('users').doc(openid).get();
    return { ...(snap.data || {}), _id: openid, openid };
  } catch (e) {
    return { openid, ownedFrameIds: [], avatarFrameId: '', achievementClaims: {} };
  }
}

/** 连续签到：从今天（未签则昨天）往前数 */
async function calcCheckinStreak(openid) {
  const today = shanghaiDayKey();
  let rows = [];
  try {
    const res = await db
      .collection('user_checkins')
      .where({ openid })
      .orderBy('dateKey', 'desc')
      .limit(MAX)
      .get();
    rows = res.data || [];
  } catch (e) {
    try {
      const res = await db.collection('user_checkins').where({ openid }).limit(MAX).get();
      rows = res.data || [];
    } catch (err) {
      return 0;
    }
  }
  const set = new Set(
    rows.map((r) => String((r && r.dateKey) || '').trim()).filter(Boolean),
  );
  let cursor = set.has(today) ? today : prevDayKey(today);
  if (!cursor || !set.has(cursor)) return 0;
  let streak = 0;
  while (cursor && set.has(cursor) && streak < 400) {
    streak += 1;
    cursor = prevDayKey(cursor);
  }
  return streak;
}

async function calcDownloadTotal(openid) {
  const [pack, lib] = await Promise.all([
    safeCount('download_logs', { openid }),
    safeCount('library_logs', { openid }),
  ]);
  return pack + lib;
}

async function calcPaidStats(openid) {
  let rows = [];
  try {
    const res = await db
      .collection('orders')
      .where({ openid, status: 'delivered' })
      .limit(MAX)
      .get();
    rows = res.data || [];
  } catch (e) {
    rows = [];
  }
  const paidFen = rows.reduce(
    (s, o) => s + Math.max(0, Number(o.priceFen) || 0),
    0,
  );
  return { payCount: rows.length, paidFen };
}

function progressFor(def, metrics) {
  const t = Math.max(0, Number(def.threshold) || 0);
  if (def.type === 'checkin_streak') {
    return { current: metrics.streak, target: t, done: metrics.streak >= t };
  }
  if (def.type === 'download_total') {
    return {
      current: metrics.downloads,
      target: t,
      done: metrics.downloads >= t,
    };
  }
  if (def.type === 'first_pay') {
    return {
      current: metrics.payCount > 0 ? 1 : 0,
      target: 1,
      done: metrics.payCount >= 1,
    };
  }
  if (def.type === 'paid_total') {
    return {
      current: metrics.paidFen,
      target: t,
      done: metrics.paidFen >= t,
    };
  }
  return { current: 0, target: t, done: false };
}

async function runSync(openid, defsInput) {
  const frames = await loadPublishedFrames();
  const defs = await ensureDefsBound(
    defsInput || (await loadAchievementDefsRaw()),
    frames,
  );
  const [user, streak, downloads, paid] = await Promise.all([
    loadUser(openid),
    calcCheckinStreak(openid),
    calcDownloadTotal(openid),
    calcPaidStats(openid),
  ]);
  const metrics = {
    streak,
    downloads,
    payCount: paid.payCount,
    paidFen: paid.paidFen,
  };
  const owned = new Set(
    (Array.isArray(user.ownedFrameIds) ? user.ownedFrameIds : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean),
  );
  const claims = {
    ...(user.achievementClaims && typeof user.achievementClaims === 'object'
      ? user.achievementClaims
      : {}),
  };
  const newly = [];
  const now = Date.now();
  // 已领取但当时没绑框：补发 frameId
  let patchedOwned = false;
  defs.forEach((def) => {
    const prog = progressFor(def, metrics);
    const claimed = !!claims[def.id];
    if (prog.done && !claimed) {
      claims[def.id] = now;
      if (def.frameId) owned.add(def.frameId);
      newly.push({
        id: def.id,
        title: def.title,
        desc: def.desc,
        frameId: def.frameId || '',
      });
      return;
    }
    if (claimed && def.frameId && !owned.has(def.frameId)) {
      owned.add(def.frameId);
      patchedOwned = true;
    }
  });

  if (newly.length || patchedOwned) {
    await db.collection('users').doc(openid).update({
      data: {
        ownedFrameIds: Array.from(owned),
        achievementClaims: claims,
        updatedAt: db.serverDate(),
      },
    });
  }

  const equipState = await clearInvalidEquippedFrame(openid, user, owned);

  return {
    metrics,
    newly,
    ownedFrameIds: Array.from(owned),
    avatarFrameId: equipState.avatarFrameId,
    frameCleared: !!equipState.cleared,
    defs,
    frames,
  };
}

async function listCatalog(openid) {
  const sync = await runSync(openid);
  const user = await loadUser(openid);
  const defs = sync.defs || [];
  const frames = sync.frames || [];
  const owned = new Set(sync.ownedFrameIds || []);
  const isVip = userIsVip(user);
  const claims = {
    ...(user.achievementClaims && typeof user.achievementClaims === 'object'
      ? user.achievementClaims
      : {}),
  };
  (sync.newly || []).forEach((n) => {
    if (n && n.id) claims[n.id] = Date.now();
  });

  const fileIDs = [];
  frames.forEach((f) => {
    if (frameAccessOf(f) === 'pool') return;
    if (f.thumbFileID) fileIDs.push(f.thumbFileID);
    if (f.fileID) fileIDs.push(f.fileID);
  });
  const urlMap = await resolveTempUrls(fileIDs);
  // 以 runSync 清理后的佩戴为准（避免 loadUser 读到清理前缓存）
  let equipped = String(
    sync.avatarFrameId != null ? sync.avatarFrameId : user.avatarFrameId || '',
  ).trim();

  const frameById = {};
  frames.forEach((f) => {
    const id = String(f._id || f.key || '').trim();
    if (!id) return;
    const access = frameAccessOf(f);
    if (access === 'pool') return;
    const priceFen = Math.max(0, Number(f.priceFen) || 0);
    const unlocked =
      access === 'vip'
        ? isVip
        : access === 'paid'
          ? owned.has(id)
          : owned.has(id);
    frameById[id] = {
      id,
      title: f.title || id,
      animated: !!f.animated,
      access,
      priceFen: access === 'paid' ? priceFen || 300 : 0,
      priceYuan: access === 'paid' ? ((priceFen || 300) / 100).toFixed(0) : '',
      fileID: f.fileID || '',
      thumbFileID: f.thumbFileID || f.fileID || '',
      thumbUrl: urlMap[f.thumbFileID || f.fileID] || '',
      url: urlMap[f.fileID] || urlMap[f.thumbFileID] || '',
      owned: owned.has(id) || (access === 'vip' && isVip),
      unlocked,
      equipped: equipped === id,
      sort: f.sort || 0,
    };
  });

  // runSync 已卸无效框；此处再兜底：装备 id 不在已发布目录里
  if (equipped && !frameById[equipped]) {
    try {
      await db.collection('users').doc(openid).update({
        data: { avatarFrameId: '', updatedAt: db.serverDate() },
      });
    } catch (_) {
      /* ignore */
    }
    equipped = '';
  }
  if (equipped && frameById[equipped] && frameById[equipped].access === 'vip' && !isVip) {
    try {
      await db.collection('users').doc(openid).update({
        data: { avatarFrameId: '', updatedAt: db.serverDate() },
      });
    } catch (_) {
      /* ignore */
    }
    equipped = '';
    Object.keys(frameById).forEach((k) => {
      frameById[k].equipped = false;
    });
  }

  const achievements = defs.map((def) => {
    const prog = progressFor(def, sync.metrics);
    const unlocked = !!(claims[def.id] || prog.done);
    const frame = def.frameId ? frameById[def.frameId] : null;
    if (unlocked && def.frameId && frame) {
      frame.owned = true;
      frame.unlocked = true;
    }
    return {
      id: def.id,
      type: def.type,
      title: def.title,
      desc: def.desc,
      threshold: def.threshold,
      current: prog.current,
      target: prog.target,
      unlocked,
      frameId: def.frameId || '',
      frame: frame || null,
      sort: def.sort || 0,
      source: 'achievement',
    };
  });

  const vipFrames = Object.values(frameById)
    .filter((f) => f.access === 'vip')
    .sort((a, b) => a.sort - b.sort)
    .map((f) => ({
      id: `vip_${f.id}`,
      source: 'vip',
      title: f.title,
      desc: isVip ? '会员专属 · 点按佩戴' : '会员专属 · 点按开通后可用',
      unlocked: !!f.unlocked,
      frameId: f.id,
      frame: f,
      framePreviewUrl: f.url || f.thumbUrl || '',
      frameEquipped: !!f.equipped,
      current: isVip ? 1 : 0,
      target: 1,
      sort: f.sort,
    }));

  const shopFrames = Object.values(frameById)
    .filter((f) => f.access === 'paid')
    .sort((a, b) => a.sort - b.sort)
    .map((f) => ({
      id: `shop_${f.id}`,
      source: 'paid',
      title: f.title,
      desc: f.unlocked
        ? '已购买 · 点按佩戴'
        : `点按购买 · ¥${f.priceYuan || '3'} 永久`,
      unlocked: !!f.unlocked,
      frameId: f.id,
      frame: f,
      framePreviewUrl: f.url || f.thumbUrl || '',
      frameEquipped: !!f.equipped,
      priceFen: f.priceFen || 300,
      priceYuan: f.priceYuan || '3',
      current: f.unlocked ? 1 : 0,
      target: 1,
      sort: f.sort,
    }));

  return {
    metrics: sync.metrics,
    newly: sync.newly || [],
    isVip,
    equippedFrameId: equipped,
    equippedFrame: equipped ? frameById[equipped] || null : null,
    achievements,
    vipFrames,
    shopFrames,
    frames: Object.values(frameById).sort((a, b) => a.sort - b.sort),
  };
}

async function equipFrame(openid, frameId, unequip) {
  if (unequip || !frameId) {
    await db.collection('users').doc(openid).update({
      data: { avatarFrameId: '', updatedAt: db.serverDate() },
    });
    return { avatarFrameId: '' };
  }
  const id = String(frameId || '').trim();
  const user = await loadUser(openid);
  const owned = new Set(
    (Array.isArray(user.ownedFrameIds) ? user.ownedFrameIds : []).map(String),
  );
  let frame = null;
  try {
    const snap = await db.collection('avatar_frames').doc(id).get();
    frame = snap.data || null;
  } catch (e) {
    frame = null;
  }
  frame = unwrapRecord(frame);
  if (!frame || !frame.fileID || (frame.status && frame.status !== 'published')) {
    return { ok: false, code: 'NOT_FOUND', message: '头像框不存在' };
  }
  const access = frameAccessOf(frame);
  if (access === 'pool') {
    return { ok: false, code: 'LOCKED', message: '该头像框暂未开放' };
  }
  if (access === 'vip') {
    if (!userIsVip(user)) {
      return { ok: false, code: 'VIP_REQUIRED', message: '会员专属头像框' };
    }
  } else {
    if (!owned.has(id)) {
      const sync = await runSync(openid);
      (sync.ownedFrameIds || []).forEach((x) => owned.add(x));
    }
    if (!owned.has(id)) {
      if (access === 'paid') {
        return { ok: false, code: 'NEED_BUY', message: '请先购买该头像框' };
      }
      return { ok: false, code: 'LOCKED', message: '尚未解锁该头像框' };
    }
  }
  await db.collection('users').doc(openid).update({
    data: { avatarFrameId: id, updatedAt: db.serverDate() },
  });
  const urlMap = await resolveTempUrls([frame.fileID, frame.thumbFileID]);
  return {
    ok: true,
    avatarFrameId: id,
    frame: {
      id,
      title: frame.title || id,
      access,
      url: urlMap[frame.fileID] || urlMap[frame.thumbFileID] || '',
      thumbUrl: urlMap[frame.thumbFileID || frame.fileID] || '',
      animated: !!frame.animated,
    },
  };
}

function resolveOpenid(event, contextOpenid) {
  if (contextOpenid) return contextOpenid;
  // 云函数互调：无终端 OPENID 时可用 targetOpenid
  const target = String((event && event.targetOpenid) || '').trim();
  return target;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const openid = resolveOpenid(event, OPENID);
  if (!openid) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = String(event.action || 'list').trim();

  try {
    if (action === 'sync') {
      const data = await runSync(openid);
      return { ok: true, data };
    }
    if (action === 'list') {
      const data = await listCatalog(openid);
      return { ok: true, data };
    }
    if (action === 'equip') {
      const res = await equipFrame(openid, event.frameId, false);
      if (res.ok === false) return res;
      return { ok: true, data: res };
    }
    if (action === 'unequip') {
      const res = await equipFrame(openid, '', true);
      return { ok: true, data: res };
    }
    return { ok: false, code: 'BAD_PARAM', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'ACHIEVEMENT_FAIL',
      message: e.message || '成就服务失败',
    };
  }
};
