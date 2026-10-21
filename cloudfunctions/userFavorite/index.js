const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const MAX_FAVORITES = 200;
const PACK_FIELDS = {
  title: true,
  coverFileID: true,
  emojiCount: true,
  downloadCount: true,
  categoryId: true,
  categoryName: true,
  coverWidth: true,
  coverHeight: true,
  status: true,
};

function normalizePackId(raw) {
  return String(raw || '').trim().slice(0, 64);
}

function favDocId(openid, packId) {
  return `${openid}_${packId}`;
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 上海时区 YYYY-MM-DD HH:mm（按 UTC+8 展示） */
function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

async function packExistsPublished(packId) {
  try {
    const snap = await db.collection('packs').doc(packId).get();
    const pack = snap.data;
    return !!(pack && pack.status === 'published');
  } catch (e) {
    return false;
  }
}

async function isFavorited(openid, packId) {
  try {
    const snap = await db.collection('favorites').doc(favDocId(openid, packId)).get();
    return !!(snap && snap.data);
  } catch (e) {
    return false;
  }
}

async function resolveCoverUrls(fileIds) {
  const ids = Array.from(new Set((fileIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  const urlMap = {};
  if (!ids.length) return urlMap;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      // eslint-disable-next-line no-await-in-loop
      const temp = await cloud.getTempFileURL({ fileList: chunk });
      (temp.fileList || []).forEach((item) => {
        if (item && item.fileID && item.tempFileURL) {
          urlMap[item.fileID] = item.tempFileURL;
        }
      });
    } catch (e) {
      console.warn('[userFavorite] getTempFileURL', e.message || e);
    }
  }
  return urlMap;
}

async function fetchPacksByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    // eslint-disable-next-line no-await-in-loop
    const res = await db.collection('packs').where({ _id: _.in(chunk) }).field(PACK_FIELDS).get();
    out.push(...(res.data || []));
  }
  return out;
}

async function addFavorite(openid, packId) {
  const okPack = await packExistsPublished(packId);
  if (!okPack) {
    return { ok: false, code: 'NOT_FOUND', message: '合集不存在或已下架' };
  }
  const countRes = await db.collection('favorites').where({ openid }).count();
  const total = Number(countRes.total) || 0;
  const existed = await isFavorited(openid, packId);
  if (!existed && total >= MAX_FAVORITES) {
    return { ok: false, code: 'FAV_FULL', message: `最多收藏 ${MAX_FAVORITES} 个合集` };
  }
  await db.collection('favorites').doc(favDocId(openid, packId)).set({
    data: {
      openid,
      packId,
      createdAt: db.serverDate(),
    },
  });
  return { ok: true, data: { favorited: true } };
}

async function removeFavorite(openid, packId) {
  try {
    await db.collection('favorites').doc(favDocId(openid, packId)).remove();
  } catch (e) {
    /* 本来就没有也算取消成功 */
  }
  return { ok: true, data: { favorited: false } };
}

async function setFavorite(openid, packId, favorited) {
  if (!packId) {
    return { ok: false, code: 'BAD_PARAM', message: '缺少合集' };
  }
  if (favorited) return addFavorite(openid, packId);
  return removeFavorite(openid, packId);
}

async function toggleFavorite(openid, packId) {
  if (!packId) {
    return { ok: false, code: 'BAD_PARAM', message: '缺少合集' };
  }
  const existed = await isFavorited(openid, packId);
  if (existed) return removeFavorite(openid, packId);
  return addFavorite(openid, packId);
}

async function listFavorites(openid, event = {}) {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(20, Math.max(1, Number(event.pageSize) || 10));
  const skip = (page - 1) * pageSize;

  const where = { openid };
  const countRes = await db.collection('favorites').where(where).count();
  const total = Number(countRes.total) || 0;
  const favRes = await db
    .collection('favorites')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();
  const favs = favRes.data || [];
  const packIds = favs.map((f) => f.packId).filter(Boolean);
  const packs = packIds.length ? await fetchPacksByIds(packIds) : [];
  const packMap = {};
  packs.forEach((p) => {
    if (p && p._id) packMap[p._id] = p;
  });

  const stale = [];
  const live = [];
  favs.forEach((f) => {
    const pack = packMap[f.packId];
    if (!pack || pack.status !== 'published') {
      stale.push(f.packId);
      return;
    }
    live.push({ fav: f, pack });
  });

  if (stale.length) {
    await Promise.all(
      stale.map((id) =>
        db
          .collection('favorites')
          .doc(favDocId(openid, id))
          .remove()
          .catch(() => null),
      ),
    );
  }

  const urlMap = await resolveCoverUrls(live.map((x) => x.pack.coverFileID));
  const list = live.map(({ fav, pack }) => {
    const cw = Number(pack.coverWidth) || 0;
    const ch = Number(pack.coverHeight) || 0;
    const ms = toMs(fav.createdAt);
    return {
      packId: pack._id,
      title: pack.title || '未命名合集',
      coverUrl: urlMap[pack.coverFileID] || '',
      coverRatio: cw > 0 && ch > 0 ? ch / cw : 0,
      emojiCount: pack.emojiCount || 0,
      downloadCount: pack.downloadCount || 0,
      categoryId: pack.categoryId || '',
      categoryName: pack.categoryName || '',
      createdAt: ms,
      createdText: formatDate(ms),
    };
  });

  return {
    ok: true,
    data: {
      list,
      total,
      hasMore: skip + favs.length < total,
      page,
      pageSize,
    },
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = String(event.action || 'status').trim();
  const packId = normalizePackId(event.packId || event.id);

  try {
    if (action === 'toggle') {
      return await toggleFavorite(OPENID, packId);
    }
    if (action === 'set') {
      const want = event.favorited === true || event.favorited === 'true' || event.favorited === 1;
      return await setFavorite(OPENID, packId, want);
    }
    if (action === 'status') {
      if (!packId) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少合集' };
      }
      const favorited = await isFavorited(OPENID, packId);
      return { ok: true, data: { favorited } };
    }
    if (action === 'list') {
      return await listFavorites(OPENID, event);
    }
    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'FAV_FAIL',
      message: e.message || '收藏失败',
    };
  }
};
