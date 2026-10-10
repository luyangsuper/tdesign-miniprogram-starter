const cloud = require('wx-server-sdk');
const { consumeDownload, syncVipMonthQuota } = require('./membership');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 下发一张原图临时链接。
 * 鉴权：本月包月额度 → 购买积分（广告通道关闭）。
 * 不增加 packs.downloadCount（相册保存成功后由 reportDownload 负责）。
 */

async function ensureUser(openid) {
  const ref = db.collection('users').doc(openid);
  try {
    const snap = await ref.get();
    return { ref, data: snap.data || {} };
  } catch (e) {
    const data = {
      openid,
      points: 0,
      vipExpireAt: null,
      createdAt: db.serverDate(),
    };
    try {
      await ref.set({ data });
    } catch (err) {
      console.warn('ensureUser', err.message);
    }
    return { ref, data };
  }
}

/**
 * @returns {{ ok: true, grantType: string, cost: number, entitlement: object } | { ok: false, code: string, message: string, entitlement?: object }}
 */
async function authorizeDownload(openid, variant) {
  const { ref, data: user } = await ensureUser(openid);
  const synced = await syncVipMonthQuota(ref, user, db.serverDate());
  return consumeDownload(ref, synced, variant, _, db.serverDate());
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const packId = event.packId;
  const index = Number(event.index);
  const variant = event.variant === 'anim' ? 'anim' : 'static';

  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!packId || Number.isNaN(index) || index < 0) {
    return { ok: false, code: 'BAD_PARAM', message: '参数错误' };
  }

  try {
    const auth = await authorizeDownload(OPENID, variant);
    if (!auth.ok) {
      return auth;
    }

    const doc = await db.collection('packs').doc(packId).get();
    const pack = doc.data;
    if (!pack || pack.status !== 'published') {
      return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };
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

    const temp = await cloud.getTempFileURL({ fileList: [fileID] });
    const item = (temp.fileList || [])[0];
    if (!item || !item.tempFileURL) {
      return { ok: false, code: 'URL_FAIL', message: '获取下载链接失败' };
    }

    return {
      ok: true,
      data: {
        url: item.tempFileURL,
        index,
        variant,
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
