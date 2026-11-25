const cloud = require('wx-server-sdk');
const {
  buildEntitlement,
  consumeDownload,
  downloadCost,
  refundDownload,
  syncVipMonthQuota,
} = require('./membership');
const { recordPointsLog } = require('./pointsLog');
const { resolveTempUrls } = require('./tempUrlCache');
const { getPointsSettings, downloadCostsFromSettings } = require('./pointsSettings');
const {
  resolveLibraryCostKey,
  libraryKindLabel,
  isLibraryAnimFormat,
} = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const ALLOWED_FORMATS = new Set(['gif', 'webp', 'lottie', 'png', 'svg', 'jpg', 'jpeg']);

function normalizeFormat(value) {
  const t = String(value || '')
    .trim()
    .toLowerCase();
  if (t === 'json' || t === 'lottie.json') return 'lottie';
  return t;
}

function isHttpUrl(v) {
  return /^https?:\/\//i.test(String(v || '').trim());
}

async function ensureUser(openid) {
  const ref = db.collection('users').doc(openid);
  try {
    const snap = await ref.get();
    return { ref, data: snap.data || {} };
  } catch (e) {
    return {
      ref,
      data: { openid, points: 0, vipExpireAt: null },
    };
  }
}

/**
 * 素材库单价表：
 * - 全局默认 libraryAnim=4 / libraryStatic=2（app_config/points）
 * - lib_sources.costs = { anim, static } 可按仓库覆盖（后续其它源用）
 */
async function resolveLibraryCostMap(sourceId) {
  let map = downloadCostsFromSettings({});
  try {
    const settings = await getPointsSettings(db);
    map = downloadCostsFromSettings(settings);
  } catch (e) {
    /* defaults */
  }

  const sid = String(sourceId || '').trim();
  if (sid) {
    try {
      const snap = await db.collection('lib_sources').doc(sid).get();
      const costs = (snap.data && snap.data.costs) || null;
      if (costs && typeof costs === 'object') {
        const anim = Number(costs.anim);
        const stil = Number(costs.static);
        if (anim > 0) map.libraryAnim = Math.min(999, Math.floor(anim));
        if (stil > 0) map.libraryStatic = Math.min(999, Math.floor(stil));
      }
    } catch (e) {
      /* ignore */
    }
  }
  return map;
}

function denyGrant(user, costKey, costMap, format) {
  const cost = downloadCost(costKey, costMap);
  const vipMonthQuota = Math.max(0, Number(user.vipMonthQuota) || 0);
  const points = Math.max(0, Number(user.points) || 0);
  const kind = libraryKindLabel(format);
  return {
    ok: false,
    code: 'NO_GRANT',
    message:
      vipMonthQuota + points > 0
        ? `积分不足：${kind}需 ${cost} 积分，本月额度 ${vipMonthQuota}、积分 ${points}`
        : '暂无法下载，请兑换包月会员或积分',
    entitlement: buildEntitlement(user),
  };
}

function canAfford(user, costKey, costMap) {
  const cost = downloadCost(costKey, costMap);
  const vipMonthQuota = Math.max(0, Number(user.vipMonthQuota) || 0);
  const points = Math.max(0, Number(user.points) || 0);
  return vipMonthQuota + points >= cost;
}

async function handleRefund(openid, event) {
  const fromVip = Number(event.fromVip) || 0;
  const fromPoints = Number(event.fromPoints) || 0;
  const { ref, data: user } = await ensureUser(openid);
  const synced = await syncVipMonthQuota(ref, user, db.serverDate(), db);
  const result = await refundDownload(
    ref,
    synced,
    fromVip,
    fromPoints,
    _,
    db.serverDate(),
  );
  const vip = Math.max(0, Math.floor(Number(fromVip) || 0));
  const pts = Math.max(0, Math.floor(Number(fromPoints) || 0));
  const total = vip + pts;
  if (total > 0) {
    const ent = (result && result.entitlement) || {};
    const balance =
      Math.max(0, Number(ent.points) || 0) +
      Math.max(0, Number(ent.vipMonthQuota) || 0);
    await recordPointsLog(db, {
      openid,
      delta: total,
      balance,
      reason: 'download_refund',
      title: '素材保存失败退回',
      meta: {
        itemId: String(event.itemId || '').trim(),
        fromVip: vip,
        fromPoints: pts,
        library: true,
      },
    });
  }
  return result;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  if (event.action === 'refund') {
    try {
      return await handleRefund(OPENID, event);
    } catch (e) {
      console.error(e);
      return { ok: false, code: 'REFUND_FAIL', message: e.message || '退回积分失败' };
    }
  }

  const itemId = String(event.itemId || '').trim();
  const format = normalizeFormat(event.format || 'gif');
  if (!itemId) {
    return { ok: false, code: 'BAD_PARAM', message: '参数错误' };
  }
  if (!ALLOWED_FORMATS.has(format)) {
    return { ok: false, code: 'BAD_FORMAT', message: '不支持的格式' };
  }

  try {
    const doc = await db.collection('lib_items').doc(itemId).get();
    const item = doc.data;
    if (!item || item.status !== 'published') {
      return { ok: false, code: 'NOT_FOUND', message: '素材不存在' };
    }

    const fileRef = item.files && item.files[format];
    if (!fileRef || !String(fileRef).trim()) {
      return { ok: false, code: 'NO_FORMAT', message: `该表情没有 ${format.toUpperCase()} 格式` };
    }
    const fileID = String(fileRef).trim();
    const sourceId = String(item.sourceId || '').trim();
    const costKey = resolveLibraryCostKey(format);
    const costMap = await resolveLibraryCostMap(sourceId);

    const { ref, data: user } = await ensureUser(OPENID);
    const synced = await syncVipMonthQuota(ref, user, db.serverDate(), db);
    if (!canAfford(synced, costKey, costMap)) {
      return denyGrant(synced, costKey, costMap, format);
    }

    let tempUrl = '';
    if (isHttpUrl(fileID)) {
      tempUrl = fileID;
    } else {
      const urlMap = await resolveTempUrls(cloud, [fileID]);
      tempUrl = urlMap[fileID] || '';
    }
    if (!tempUrl) {
      return { ok: false, code: 'URL_FAIL', message: '获取下载链接失败' };
    }

    const freshSnap = await ref.get();
    const freshUser = { ...synced, ...(freshSnap.data || {}) };
    const auth = await consumeDownload(
      ref,
      freshUser,
      costKey,
      _,
      db.serverDate(),
      libraryKindLabel(format),
      costMap,
    );
    if (!auth.ok) return auth;

    const fromVip = Math.max(0, Number(auth.fromVip) || 0);
    const fromPoints = Math.max(0, Number(auth.fromPoints) || 0);
    const total = fromVip + fromPoints;
    if (total > 0) {
      const title = String(item.name || item.externalKey || '').trim().slice(0, 40);
      const ent = auth.entitlement || {};
      await recordPointsLog(db, {
        openid: OPENID,
        delta: -total,
        balance:
          Math.max(0, Number(ent.points) || 0) +
          Math.max(0, Number(ent.vipMonthQuota) || 0),
        reason: 'download',
        title: title ? `保存素材「${title}」` : '保存素材',
        meta: {
          itemId,
          sourceId,
          format,
          costKey,
          anim: isLibraryAnimFormat(format),
          fromVip,
          fromPoints,
          library: true,
        },
      });
    }

    try {
      await db.collection('lib_items').doc(itemId).update({
        data: {
          downloadCount: _.inc(1),
          updatedAt: db.serverDate(),
        },
      });
    } catch (e) {
      /* ignore count */
    }
    if (sourceId) {
      try {
        await db.collection('lib_sources').doc(sourceId).update({
          data: {
            downloadCount: _.inc(1),
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        /* ignore */
      }
    }

    const saveToAlbum =
      format === 'gif' ||
      format === 'webp' ||
      format === 'png' ||
      format === 'jpg' ||
      format === 'jpeg';

    return {
      ok: true,
      data: {
        url: tempUrl,
        format,
        saveToAlbum,
        mediaKind: 'image',
        costKey,
        cost: auth.cost,
        fromVip: auth.fromVip || 0,
        fromPoints: auth.fromPoints || 0,
        grantType: auth.grantType,
        entitlement: auth.entitlement,
        expiresHint: '临时链接，请尽快保存',
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'DOWNLOAD_FAIL', message: e.message || '下载失败' };
  }
};
