const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 客户端「成功保存到相册」后调用，才增加 downloadCount。
 * 仅拿到临时链接、下载/保存失败时不应调用本函数。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const packId = event.packId;
  const index = Number(event.index);
  const grantRaw = String(event.grantType || '').trim().toLowerCase();
  const grantType = ['vip', 'points', 'mixed', 'ad'].includes(grantRaw)
    ? grantRaw
    : '';

  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!packId || Number.isNaN(index) || index < 0) {
    return { ok: false, code: 'BAD_PARAM', message: '参数错误' };
  }

  try {
    const doc = await db.collection('packs').doc(packId).get();
    const pack = doc.data;
    if (!pack || pack.status !== 'published') {
      return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };
    }

    const emojiCount = (pack.emojiFileIDs || []).length;
    if (index >= emojiCount) {
      return { ok: false, code: 'OUT_OF_RANGE', message: '原图不存在' };
    }

    try {
      const logData = {
        openid: OPENID,
        packId,
        emojiIndex: index,
        success: true,
        createdAt: db.serverDate(),
      };
      if (grantType) logData.grantType = grantType;
      await db.collection('download_logs').add({ data: logData });
    } catch (e) {
      console.warn('download_logs skip', e.message);
    }

    await db.collection('packs').doc(packId).update({
      data: { downloadCount: _.inc(1) },
    });

    return {
      ok: true,
      data: {
        downloadCount: (pack.downloadCount || 0) + 1,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'REPORT_FAIL', message: e.message || '统计失败' };
  }
};
