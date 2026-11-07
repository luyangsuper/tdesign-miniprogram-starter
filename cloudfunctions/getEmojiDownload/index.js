const cloud = require('wx-server-sdk');
const {
  buildEntitlement,
  consumeDownload,
  downloadCost,
  resolveDownloadCosts,
  refundDownload,
  syncVipMonthQuota,
} = require('./membership');
const { recordPointsLog } = require('./pointsLog');
const { resolveTempUrls } = require('./tempUrlCache');
const {
  normalizeContentType,
  isEmojiType,
  resolveCostKey,
  costKindLabel,
} = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 下发一张/一段原文件临时链接。
 * 鉴权：本月包月额度 → 购买积分（广告通道关闭）。
 * 先确认原文件可下发，再扣费；相册保存失败可 action=refund 原路退回。
 * 不增加 packs.downloadCount（相册保存成功后由 reportDownload 负责）。
 */

async function ensureUser(openid) {
  const ref = db.collection('users').doc(openid);
  try {
    const snap = await ref.get();
    return { ref, data: snap.data || {} };
  } catch (e) {
    // 不抢建 users，避免与 login 见面礼竞态
    return {
      ref,
      data: { openid, points: 0, vipExpireAt: null },
    };
  }
}

function denyGrant(user, costKey, kindLabel, costMap) {
  const cost = downloadCost(costKey, costMap);
  const vipMonthQuota = Math.max(0, Number(user.vipMonthQuota) || 0);
  const points = Math.max(0, Number(user.points) || 0);
  const kind = kindLabel || '原图';
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
      title: '保存失败退回',
      meta: {
        packId: String(event.packId || '').trim(),
        fromVip: vip,
        fromPoints: pts,
      },
    });
  }
  return result;
}

exports.main = async (event) => {
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

  const packId = event.packId;
  const index = Number(event.index);
  const requestedVariant = event.variant === 'anim' ? 'anim' : 'static';

  if (!packId || Number.isNaN(index) || index < 0) {
    return { ok: false, code: 'BAD_PARAM', message: '参数错误' };
  }

  try {
    const doc = await db.collection('packs').doc(packId).get();
    const pack = doc.data;
    if (!pack || pack.status !== 'published') {
      return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };
    }

    const contentType = normalizeContentType(pack.contentType);
    const emojiOnly = isEmojiType(contentType);
    if (!emojiOnly && requestedVariant === 'anim') {
      return { ok: false, code: 'BAD_PARAM', message: '该合集无动态原图' };
    }
    const variant = emojiOnly ? requestedVariant : 'static';
    const costKey = resolveCostKey(contentType, variant);
    const kindLabel = costKindLabel(contentType, variant);
    const costMap = await resolveDownloadCosts(db);

    const { ref, data: user } = await ensureUser(OPENID);
    const synced = await syncVipMonthQuota(ref, user, db.serverDate(), db);
    if (!canAfford(synced, costKey, costMap)) {
      return denyGrant(synced, costKey, kindLabel, costMap);
    }

    const emojiFileIDs = pack.emojiFileIDs || [];
    if (index >= emojiFileIDs.length) {
      return { ok: false, code: 'OUT_OF_RANGE', message: '原图不存在' };
    }

    let fileID = emojiFileIDs[index];
    if (variant === 'anim') {
      const animId = (pack.emojiAnimFileIDs || [])[index];
      if (!animId || !String(animId).trim()) {
        return { ok: false, code: 'NO_ANIM', message: '该张无动态原图' };
      }
      fileID = animId;
    }

    const urlMap = await resolveTempUrls(cloud, [fileID]);
    const tempUrl = urlMap[fileID] || '';
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
      kindLabel,
      costMap,
    );
    if (!auth.ok) {
      return auth;
    }

    const fromVip = Math.max(0, Number(auth.fromVip) || 0);
    const fromPoints = Math.max(0, Number(auth.fromPoints) || 0);
    const total = fromVip + fromPoints;
    if (total > 0) {
      const packTitle = String(pack.title || pack.name || '').trim().slice(0, 40);
      const ent = auth.entitlement || {};
      await recordPointsLog(db, {
        openid: OPENID,
        delta: -total,
        balance:
          Math.max(0, Number(ent.points) || 0) +
          Math.max(0, Number(ent.vipMonthQuota) || 0),
        reason: 'download',
        title: packTitle ? `保存「${packTitle}」` : '保存原图',
        meta: {
          packId,
          packTitle,
          index,
          variant: emojiOnly ? variant : contentType,
          contentType,
          costKey,
          fromVip,
          fromPoints,
        },
      });
    }

    const logVariant = emojiOnly ? variant : contentType;

    return {
      ok: true,
      data: {
        url: tempUrl,
        index,
        variant: logVariant,
        contentType,
        mediaKind: contentType === 'video' ? 'video' : 'image',
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
