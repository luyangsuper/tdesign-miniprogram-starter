const cloud = require('wx-server-sdk');
const { normalizeContentType, isEmojiType } = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 客户端「成功保存到相册」后调用，才增加 downloadCount。
 * 写入 download_logs（含 index / variant / fileID），供管理端按用户追溯。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const packId = String(event.packId || '').trim();
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

    const contentType = normalizeContentType(pack.contentType);
    const emojiOnly = isEmojiType(contentType);
    const requested = String(event.variant || '').trim();
    let variant = 'static';
    if (emojiOnly) {
      variant = requested === 'anim' ? 'anim' : 'static';
    } else if (
      requested === contentType ||
      requested === 'original' ||
      requested === 'wallpaper' ||
      requested === 'avatar' ||
      requested === 'video'
    ) {
      variant = contentType;
    } else {
      variant = contentType;
    }

    const emojiFileIDs = pack.emojiFileIDs || [];
    if (index >= emojiFileIDs.length) {
      return { ok: false, code: 'OUT_OF_RANGE', message: '原图不存在' };
    }

    const staticFileID = String(emojiFileIDs[index] || '').trim();
    let fileID = staticFileID;
    if (variant === 'anim') {
      const animId = String((pack.emojiAnimFileIDs || [])[index] || '').trim();
      if (!animId) {
        return { ok: false, code: 'NO_ANIM', message: '该张无动态原图' };
      }
      fileID = animId;
    }

    try {
      const logData = {
        openid: OPENID,
        packId,
        packTitle: String(pack.title || pack.name || '').trim().slice(0, 80),
        contentType,
        emojiIndex: index,
        variant,
        /** 实际保存的文件 */
        fileID,
        /** 列表缩略图用静态/条目原文件 */
        thumbFileID: staticFileID || fileID,
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
