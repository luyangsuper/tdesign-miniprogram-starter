const cloud = require('wx-server-sdk');
const { resolveCategory } = require('./categories');
const { invalidateListCaches } = require('./invalidateCaches');
const {
  normalizeContentType,
  isEmojiType,
  isCategoryOptional,
} = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];
const DRAFT_TITLE_FALLBACK = '未命名草稿';

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function assertAdmin(openid) {
  return getAdminList().includes(openid);
}

function originalsRequiredMessage(contentType) {
  const type = normalizeContentType(contentType);
  if (type === 'video') return '请至少上传一段原视频';
  if (type === 'avatar') return '请至少上传一张头像原图';
  if (type === 'wallpaper') return '请至少上传一张壁纸原图';
  return '请至少上传一张静态原图';
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  if (!assertAdmin(OPENID)) return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };

  const packId = event.packId || event.id;
  const contentType = normalizeContentType(event.contentType);
  let title = (event.title || '').trim();
  const categoryId = String(event.categoryId || '').trim();
  const coverFileID = event.coverFileID ? String(event.coverFileID) : '';
  const previewFileIDs = Array.isArray(event.previewFileIDs) ? event.previewFileIDs.filter(Boolean) : [];
  // 暂时屏蔽预览视频：保存时清空（含历史预览视频）
  const previewVideoFileID = '';
  const emojiFileIDs = Array.isArray(event.emojiFileIDs) ? event.emojiFileIDs.filter(Boolean) : [];
  const rawAnim = Array.isArray(event.emojiAnimFileIDs) ? event.emojiAnimFileIDs : [];
  const emojiAnimFileIDs = isEmojiType(contentType)
    ? emojiFileIDs.map((_, i) => {
        const id = rawAnim[i];
        return id ? String(id) : '';
      })
    : emojiFileIDs.map(() => '');

  if (!packId) return { ok: false, code: 'BAD_PARAM', message: '缺少 packId' };
  if (contentType === 'video') {
    return { ok: false, code: 'BAD_PARAM', message: '暂不支持保存视频合集' };
  }

  try {
    const doc = await db.collection('packs').doc(packId).get();
    if (!doc.data) return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };

    const old = doc.data;
    const oldStatus = old.status === 'draft' ? 'draft' : 'published';
    const wantStatus =
      event.status === 'draft' || event.status === 'published' ? event.status : null;
    const nextStatus = wantStatus || oldStatus;

    // 已上架的合集不允许改回草稿，避免误下架
    if (oldStatus === 'published' && nextStatus === 'draft') {
      return { ok: false, code: 'BAD_STATUS', message: '已发布合集不能改回草稿' };
    }

    const isDraft = nextStatus === 'draft';
    const rawPublishAt = Math.floor(Number(event.publishAt) || 0);
    // 仅草稿可挂定时；立即发布或未传则清掉
    const clearSchedule = event.clearSchedule === true || !isDraft;
    const publishAt = clearSchedule ? 0 : rawPublishAt > 0 ? rawPublishAt : 0;
    const notifyOnPublish = publishAt > 0;
    const needReady = !isDraft || publishAt > 0;

    if (!title) {
      if (isDraft && !publishAt) {
        title = DRAFT_TITLE_FALLBACK;
      } else {
        return { ok: false, code: 'BAD_PARAM', message: '请填写标题' };
      }
    }
    // 新设定时必须晚于现在；沿用原 publishAt（含即将到点）允许保存内容
    const oldPublishAt = Math.floor(Number(old.publishAt) || 0);
    if (
      publishAt > 0 &&
      publishAt !== oldPublishAt &&
      publishAt < Date.now() + 60 * 1000
    ) {
      return { ok: false, code: 'BAD_PARAM', message: '定时时间需晚于现在至少 1 分钟' };
    }
    if (needReady) {
      if (!isCategoryOptional(contentType) && !categoryId) {
        return { ok: false, code: 'BAD_PARAM', message: '请选择分类' };
      }
      if (!coverFileID) {
        return { ok: false, code: 'BAD_PARAM', message: '请上传封面' };
      }
      if (!emojiFileIDs.length) {
        return { ok: false, code: 'BAD_PARAM', message: originalsRequiredMessage(contentType) };
      }
    }

    let cat = null;
    if (categoryId) {
      cat = await resolveCategory(db, categoryId);
      if (!cat) return { ok: false, code: 'BAD_PARAM', message: '分类不存在' };
    }

    const oldFiles = [
      old.coverFileID,
      old.previewVideoFileID,
      ...(old.previewFileIDs || []),
      ...(old.emojiFileIDs || []),
      ...(old.emojiAnimFileIDs || []),
    ].filter(Boolean);
    const newFiles = [
      coverFileID,
      previewVideoFileID,
      ...previewFileIDs,
      ...emojiFileIDs,
      ...emojiAnimFileIDs.filter(Boolean),
    ].filter(Boolean);
    const removed = oldFiles.filter((id) => !newFiles.includes(id));

    const pairKeys = Array.isArray(event.pairKeys) ? event.pairKeys.filter(Boolean) : [];
    const staticDriveUrl = String(event.staticDriveUrl || '').trim().slice(0, 500);
    const animDriveUrl = isEmojiType(contentType)
      ? String(event.animDriveUrl || '').trim().slice(0, 500)
      : '';

    const patch = {
      title,
      description: String(event.description || '').replace(/\r\n/g, '\n').trim().slice(0, 800),
      contentType,
      staticDriveUrl,
      animDriveUrl,
      categoryId: cat ? cat.id : '',
      categoryName: cat ? cat.name : '',
      coverFileID: coverFileID || '',
      coverWidth: coverFileID ? Math.max(0, Number(event.coverWidth) || 0) : 0,
      coverHeight: coverFileID ? Math.max(0, Number(event.coverHeight) || 0) : 0,
      previewFileIDs,
      previewVideoFileID,
      emojiFileIDs,
      emojiAnimFileIDs,
      pairKeys,
      previewCount: previewFileIDs.length + (previewVideoFileID ? 1 : 0),
      emojiCount: emojiFileIDs.length,
      status: nextStatus,
      publishAt,
      notifyOnPublish,
      scheduleError: '',
      updatedAt: db.serverDate(),
    };
    // 草稿首次正式上架：补 publishedAt，便于后续排查
    if (oldStatus === 'draft' && nextStatus === 'published' && !old.publishedAt) {
      patch.publishedAt = db.serverDate();
    }

    await db.collection('packs').doc(packId).update({ data: patch });

    if (removed.length) {
      try {
        await cloud.deleteFile({ fileList: removed });
      } catch (e) {
        console.warn('delete unused files', e.message);
      }
    }

    await invalidateListCaches(db);
    return {
      ok: true,
      data: {
        _id: packId,
        contentType,
        status: nextStatus,
        publishAt,
        notifyOnPublish,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'UPDATE_FAIL', message: e.message || '更新失败' };
  }
};
