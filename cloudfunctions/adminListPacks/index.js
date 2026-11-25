const cloud = require('wx-server-sdk');
const { normalizeContentType, contentTypeLabel } = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];
const MAX_PAGE_SIZE = 50;

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

function toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** 云函数默认 UTC：必须按上海时区格式化，否则 09:20 会显示成 01:20 */
function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (type) => {
      const hit = parts.find((p) => p.type === type);
      return hit ? hit.value : '';
    };
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  } catch (e) {
    // 无 Intl 时区时退回 +8 偏移
    const shifted = new Date(ms + 8 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`;
  }
}

async function toUrlMap(fileIds) {
  const urlMap = {};
  const list = (fileIds || []).filter(Boolean);
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    // eslint-disable-next-line no-await-in-loop
    const temp = await cloud.getTempFileURL({ fileList: chunk });
    (temp.fileList || []).forEach((item) => {
      if (item && item.fileID) urlMap[item.fileID] = item.tempFileURL || '';
    });
  }
  return urlMap;
}

/**
 * 管理端合集列表（默认草稿）。
 * event.status: draft | published | all
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  if (!assertAdmin(OPENID)) return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };

  const statusRaw = String(event.status || 'draft').trim();
  const status =
    statusRaw === 'published' || statusRaw === 'all' || statusRaw === 'draft'
      ? statusRaw
      : 'draft';
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(event.pageSize) || 20));
  const skip = (page - 1) * pageSize;

  const where = status === 'all' ? {} : { status };

  try {
    const col = db.collection('packs');
    const countRes = await col.where(where).count();
    const total = (countRes && countRes.total) || 0;

    // 草稿量通常不大：多取一点再按 updatedAt 排，避免强依赖复合索引
    const fetchLimit = Math.min(200, Math.max(pageSize * page, pageSize));
    let snap;
    try {
      snap = await col.where(where).orderBy('updatedAt', 'desc').limit(fetchLimit).get();
    } catch (e) {
      // 无 updatedAt 索引时退回 createdAt（已有 status_createdAt）
      try {
        snap = await col.where(where).orderBy('createdAt', 'desc').limit(fetchLimit).get();
      } catch (err) {
        snap = await col.where(where).limit(fetchLimit).get();
      }
    }

    const rows = (snap.data || [])
      .map((p) => {
        const updatedAt = toMs(p.updatedAt) || toMs(p.createdAt);
        return { ...p, _sortAt: updatedAt };
      })
      .sort((a, b) => b._sortAt - a._sortAt)
      .slice(skip, skip + pageSize);

    const coverIds = rows.map((p) => p.coverFileID).filter(Boolean);
    const urlMap = await toUrlMap(coverIds);

    const list = rows.map((p) => {
      const contentType = normalizeContentType(p.contentType);
      const updatedAt = p._sortAt || 0;
      const packStatus = p.status === 'draft' ? 'draft' : 'published';
      const publishAt = toMs(p.publishAt);
      const hasSchedule = packStatus === 'draft' && publishAt > 0;
      return {
        _id: p._id,
        title: p.title || '未命名草稿',
        description: p.description || '',
        contentType,
        contentTypeName: contentTypeLabel(contentType),
        categoryId: p.categoryId || '',
        categoryName: p.categoryName || '',
        status: packStatus,
        statusLabel: packStatus === 'draft' ? '草稿' : '已发布',
        coverFileID: p.coverFileID || '',
        coverUrl: (p.coverFileID && urlMap[p.coverFileID]) || '',
        emojiCount: Number(p.emojiCount) || (Array.isArray(p.emojiFileIDs) ? p.emojiFileIDs.length : 0),
        previewCount: Number(p.previewCount) || 0,
        updatedAt,
        updatedText: formatTime(updatedAt),
        publishAt,
        publishAtText: hasSchedule ? formatTime(publishAt) : '',
        hasSchedule,
        notifyOnPublish: !!p.notifyOnPublish,
        scheduleError: p.scheduleError || '',
      };
    });

    return {
      ok: true,
      data: {
        list,
        total,
        page,
        pageSize,
        hasMore: skip + list.length < total,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'LIST_FAIL', message: e.message || '加载失败' };
  }
};
