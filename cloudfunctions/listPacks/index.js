const cloud = require('wx-server-sdk');
const { resolveTempUrls } = require('./tempUrlCache');
const {
  normalizeContentType,
  CONTENT_TYPES,
  contentTypeLabel,
} = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 混排比例（无搜索时）：
 * - 50% 最新主轨（可稳定翻页）
 * - 30% 热门池随机抽（避免永远固定榜首）
 * - 20% 更早发布的随机合集（抬曝光）
 */
const MIX_NEWEST_RATIO = 0.5;
const MIX_HOT_RATIO = 0.3;
const MIX_RANDOM_RATIO = 0.2;
/** 热门候选池大小，从中随机抽取 */
const HOT_POOL_SIZE = 48;
/** 随机旧货每次抽样窗口 */
const RANDOM_POOL_SIZE = 24;

function buildContentTypeCond(contentType) {
  const raw = String(contentType || 'all').trim() || 'all';
  // 暂时下线视频：全部 / 误传 video 都不返回视频合集
  if (!raw || raw === 'all' || raw === 'video') {
    return { contentType: _.neq('video') };
  }
  if (!CONTENT_TYPES.includes(raw)) return { contentType: _.neq('video') };
  if (raw === 'emoji') {
    return _.or([
      { contentType: 'emoji' },
      { contentType: _.exists(false) },
      { contentType: null },
      { contentType: '' },
    ]);
  }
  return { contentType: raw };
}

function buildKeywordCond(keyword) {
  if (!keyword) return null;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = db.RegExp({ regexp: escaped, options: 'i' });
  return _.or([
    { title: re },
    { description: re },
    { categoryName: re },
  ]);
}

function buildCategoryConds(categoryId, categoryIds) {
  if (categoryId === 'uncategorized') {
    return _.or([
      { categoryId: _.exists(false) },
      { categoryId: null },
      { categoryId: '' },
    ]);
  }
  if (categoryId && categoryId !== 'all') {
    return { categoryId };
  }
  /* 首页偏好多选：点「全部」时只查所选角色 */
  const ids = Array.isArray(categoryIds)
    ? categoryIds.map((x) => String(x || '').trim()).filter((id) => id && id !== 'all' && id !== 'uncategorized')
    : [];
  if (ids.length === 1) return { categoryId: ids[0] };
  if (ids.length > 1) return { categoryId: _.in(ids) };
  return null;
}

const PACK_FIELDS = {
  title: true,
  description: true,
  contentType: true,
  coverFileID: true,
  previewFileIDs: true,
  previewCount: true,
  emojiFileIDs: true,
  emojiAnimFileIDs: true,
  emojiCount: true,
  downloadCount: true,
  viewCount: true,
  categoryId: true,
  categoryName: true,
  coverWidth: true,
  coverHeight: true,
  createdAt: true,
  lastDownloadAt: true,
  revivedAt: true,
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** 云函数实例内缓存 top5% 下载阈值，避免每页重复扫库 */
let _viralThresholdCache = { at: 0, value: 0 };

async function resolveViralDownloadMin(where) {
  const now = Date.now();
  if (_viralThresholdCache.value > 0 && now - _viralThresholdCache.at < 10 * 60 * 1000) {
    return _viralThresholdCache.value;
  }
  try {
    const countRes = await db.collection('packs').where(where).count();
    const total = Math.max(0, Number(countRes.total) || 0);
    if (total <= 0) {
      _viralThresholdCache = { at: now, value: 30 };
      return 30;
    }
    // 前 5% 的最低下载量：跳到第 ceil(total*0.05) 名
    const rank = Math.max(1, Math.ceil(total * 0.05));
    const skip = Math.max(0, rank - 1);
    const tip = await db
      .collection('packs')
      .where(where)
      .orderBy('downloadCount', 'desc')
      .skip(skip)
      .limit(1)
      .field({ downloadCount: true })
      .get();
    const tipCount = Math.max(0, Number((tip.data && tip.data[0] && tip.data[0].downloadCount) || 0));
    // 库很小时 top5% 可能几乎是 0，给个保底
    const value = Math.max(tipCount, total < 20 ? 12 : 8);
    _viralThresholdCache = { at: now, value };
    return value;
  } catch (e) {
    console.warn('[listPacks] viral threshold fallback', e.message || e);
    return _viralThresholdCache.value || 30;
  }
}

/**
 * 合集氛围状态（一张卡一个）：爆火 > 飙升 > 复活 > 新发布 > 人气 > 沉睡 > 冷门
 */
function resolveMoodId(pack, { viralMin, popularMin, now }) {
  const createdAt = Number(pack.createdAt) || 0;
  const downloadCount = Math.max(0, Number(pack.downloadCount) || 0);
  const lastDownloadAt = Number(pack.lastDownloadAt) || 0;
  const revivedAt = Number(pack.revivedAt) || 0;
  const age = createdAt > 0 ? now - createdAt : 0;
  const vMin = Math.max(1, Number(viralMin) || 30);
  const pMin = Math.max(8, Number(popularMin) || 12);

  if (downloadCount >= vMin) return 'viral';
  if (
    lastDownloadAt > 0 &&
    now - lastDownloadAt < DAY_MS &&
    downloadCount >= Math.max(5, Math.floor(pMin * 0.5)) &&
    age > 3 * DAY_MS
  ) {
    return 'rising';
  }
  // 复活：显式 revivedAt（14 天）或老合集近三周又有下载（回流）
  if (revivedAt > 0 && now - revivedAt < 14 * DAY_MS) return 'revived';
  if (
    age > 14 * DAY_MS &&
    lastDownloadAt > 0 &&
    now - lastDownloadAt < 21 * DAY_MS &&
    downloadCount >= 1
  ) {
    return 'revived';
  }
  if (createdAt > 0 && age < 3 * DAY_MS) return 'fresh';
  if (downloadCount >= pMin) return 'popular';

  const idleMs = lastDownloadAt > 0 ? now - lastDownloadAt : age;
  if (age > 30 * DAY_MS && idleMs > 30 * DAY_MS) return 'sleeping';
  if (
    age > 14 * DAY_MS &&
    downloadCount > 0 &&
    downloadCount < Math.max(3, Math.floor(pMin * 0.2)) &&
    idleMs <= 30 * DAY_MS
  ) {
    return 'cold';
  }
  return '';
}

function resolveCoverFileID(pack) {
  if (pack && pack.coverFileID) return pack.coverFileID;
  // 视频可不传封面：列表用首张预览图顶上
  if (pack && normalizeContentType(pack.contentType) === 'video') {
    const first = Array.isArray(pack.previewFileIDs) ? pack.previewFileIDs.find(Boolean) : '';
    return first || '';
  }
  return '';
}

/** 表情/头像列表需要 4 宫格预览；壁纸只靠封面卡 */
function needsPreviewGrid(contentType) {
  const t = normalizeContentType(contentType);
  return t === 'emoji' || t === 'avatar';
}

/**
 * 四宫格用图优先级：
 * - 表情：动图 emojiAnim → 静图 emoji → 预览图 → 封面
 * - 头像：原图 emoji → 预览图 → 封面（不用拼图封面优先）
 */
function pickGridFileIDs(pack, contentType) {
  const coverId = resolveCoverFileID(pack);
  const anims = Array.isArray(pack && pack.emojiAnimFileIDs)
    ? pack.emojiAnimFileIDs
    : [];
  const statics = Array.isArray(pack && pack.emojiFileIDs)
    ? pack.emojiFileIDs
    : [];
  const previews = Array.isArray(pack && pack.previewFileIDs)
    ? pack.previewFileIDs
    : [];
  const ids = [];
  const push = (id) => {
    const s = String(id || '').trim();
    if (!s || ids.includes(s) || ids.length >= 6) return;
    ids.push(s);
  };
  if (contentType === 'avatar') {
    statics.forEach(push);
    previews.forEach(push);
    push(coverId);
  } else {
    anims.forEach(push);
    statics.forEach(push);
    previews.forEach(push);
    push(coverId);
  }
  return ids.slice(0, 6);
}

async function mapPacksWithCovers(packs, { forceRefresh = false, viralMin = 0, popularMin = 0 } = {}) {
  const coverIds = packs.map((p) => resolveCoverFileID(p)).filter(Boolean);
  const previewIdSet = new Set(coverIds);
  packs.forEach((p) => {
    const contentType = normalizeContentType(p && p.contentType);
    if (!needsPreviewGrid(contentType)) return;
    pickGridFileIDs(p, contentType).forEach((id) => {
      if (id) previewIdSet.add(id);
    });
  });
  const urlMap = await resolveTempUrls(cloud, Array.from(previewIdSet), {
    forceRefresh,
  });
  return packs.map((p) => {
    const coverId = resolveCoverFileID(p);
    const coverUrl = (coverId && urlMap[coverId]) || '';
    const cw = Number(p.coverWidth) || 0;
    const ch = Number(p.coverHeight) || 0;
    const coverRatio = cw > 0 && ch > 0 ? ch / cw : 0;
    const contentType = normalizeContentType(p.contentType);
    /** 与 previewUrls 下标对齐，供客户端裂图后按 fileID 换签重载 */
    let previewFileIDs = [];
    let previewUrls = [];
    if (needsPreviewGrid(contentType)) {
      const pairs = pickGridFileIDs(p, contentType)
        .map((id) => {
          const fileID = String(id || '').trim();
          const url = (fileID && urlMap[fileID]) || '';
          return fileID && url ? { fileID, url } : null;
        })
        .filter(Boolean)
        .slice(0, 6);
      previewFileIDs = pairs.map((x) => x.fileID);
      previewUrls = pairs.map((x) => x.url);
    }
    const emojiCount =
      Number(p.emojiCount) ||
      (Array.isArray(p.emojiFileIDs) ? p.emojiFileIDs.filter(Boolean).length : 0) ||
      0;
    const previewCount =
      Number(p.previewCount) ||
      (Array.isArray(p.previewFileIDs)
        ? p.previewFileIDs.filter(Boolean).length
        : 0) ||
      0;
    const gridTotal = emojiCount > 0 ? emojiCount : previewCount;
    const previewSlotCap = Math.max(1, previewUrls.length || 4);
    const hasAnim =
      contentType === 'emoji' &&
      Array.isArray(p.emojiAnimFileIDs) &&
      p.emojiAnimFileIDs.some((id) => String(id || '').trim());
    const createdAt = Number(p.createdAt) || 0;
    const now = Date.now();
    const NEW_MS = 3 * DAY_MS;
    const isNew = createdAt > 0 && now - createdAt < NEW_MS;
    const downloadCount = Math.max(0, Number(p.downloadCount) || 0);
    const viewCount = Math.max(0, Number(p.viewCount) || 0);
    const lastDownloadAt = Number(p.lastDownloadAt) || 0;
    const revivedAt = Number(p.revivedAt) || 0;
    const vMin = Math.max(1, Number(viralMin) || 30);
    const pMin = Math.max(8, Number(popularMin) || Math.max(8, Math.floor(vMin * 0.25)));
    const moodId = resolveMoodId(p, { viralMin: vMin, popularMin: pMin, now });
    const countUnit =
      contentType === 'avatar' || contentType === 'video' ? '个' : '张';
    const countText = gridTotal > 0 ? `${gridTotal} ${countUnit}` : '';
    return {
      _id: p._id,
      title: p.title,
      description: p.description || '',
      contentType,
      contentTypeName: contentTypeLabel(contentType),
      coverFileID: coverId || '',
      coverUrl,
      coverRatio,
      previewFileIDs,
      previewUrls,
      slides: coverUrl ? [coverUrl] : [],
      previewCount,
      emojiCount,
      downloadCount,
      viewCount,
      categoryId: p.categoryId || '',
      categoryName: String(p.categoryName || '').trim(),
      hasAnim: !!hasAnim,
      createdAt,
      lastDownloadAt,
      revivedAt,
      isNew: !!isNew,
      /** @deprecated 兼容旧客户端；请用 moodId */
      isHot: moodId === 'viral' || moodId === 'popular',
      moodId,
      countText,
      /** 末格 +N：总数减已露出的（格数-1）张；客户端再按偏好截断 */
      moreCount:
        gridTotal > previewSlotCap ? gridTotal - (previewSlotCap - 1) : 0,
    };
  });
}

function buildWhere({ keyword, categoryId, categoryIds, contentType }) {
  const conds = [{ status: 'published' }];
  const kw = buildKeywordCond(keyword);
  if (kw) conds.push(kw);
  const cat = buildCategoryConds(categoryId, categoryIds);
  if (cat) conds.push(cat);
  const typeCond = buildContentTypeCond(contentType);
  if (typeCond) conds.push(typeCond);
  return conds.length === 1 ? conds[0] : _.and(conds);
}

function shuffleInPlace(list) {
  const arr = Array.isArray(list) ? list : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pickRandom(list, n) {
  const need = Math.max(0, Number(n) || 0);
  if (!need) return [];
  const pool = (Array.isArray(list) ? list : []).filter((p) => p && p._id);
  if (pool.length <= need) return shuffleInPlace(pool.slice());
  return shuffleInPlace(pool.slice()).slice(0, need);
}

/**
 * 最新主轨 + 插花（热门随机 / 旧货随机）交错。
 * 约每 2 条最新插 1 条，插花顺序已打乱。
 */
function weaveNewestAndInserts(newest, inserts) {
  const a = Array.isArray(newest) ? newest : [];
  const b = shuffleInPlace((Array.isArray(inserts) ? inserts : []).slice());
  if (!b.length) return a.slice();
  if (!a.length) return b;
  const out = [];
  let bi = 0;
  for (let i = 0; i < a.length; i += 1) {
    out.push(a[i]);
    if ((i + 1) % 2 === 0 && bi < b.length) {
      out.push(b[bi]);
      bi += 1;
    }
  }
  while (bi < b.length) {
    out.push(b[bi]);
    bi += 1;
  }
  return out;
}

function excludeByIds(list, excludeIds) {
  const ban = excludeIds instanceof Set ? excludeIds : new Set();
  return (Array.isArray(list) ? list : []).filter((p) => p && p._id && !ban.has(p._id));
}

/** 热门池：取一段高下载候选，再随机抽，避免永远固定榜首顺序 */
async function fetchHotRandom(where, { excludeIds, count, page }) {
  if (count <= 0) return [];
  try {
    // 每页错开池子起点，再加一点抖动
    const jitter = Math.floor(Math.random() * 8);
    const hotSkip = Math.max(0, (page - 1) * 4 + jitter);
    const hotRes = await db
      .collection('packs')
      .where(where)
      .orderBy('downloadCount', 'desc')
      .skip(hotSkip)
      .limit(HOT_POOL_SIZE)
      .field(PACK_FIELDS)
      .get();
    return pickRandom(excludeByIds(hotRes.data || [], excludeIds), count);
  } catch (e) {
    console.warn('[listPacks] hot random fallback', e.message || e);
    return [];
  }
}

/**
 * 随机旧货：跳过靠前的「新鲜区」，在更早发布的区间里抽一窗再随机。
 * 库太小时退化为全量随机（仍排除本页已选）。
 */
async function fetchOlderRandom(where, { excludeIds, count, total, newestSkip, newestCount }) {
  if (count <= 0 || total <= 0) return [];
  try {
    const freshZone = Math.min(
      total,
      Math.max(newestSkip + newestCount + 12, Math.min(30, Math.ceil(total * 0.15))),
    );
    const olderSpan = Math.max(0, total - freshZone);
    let start = 0;
    let take = RANDOM_POOL_SIZE;
    if (olderSpan > 0) {
      take = Math.min(RANDOM_POOL_SIZE, olderSpan);
      const maxStart = Math.max(0, olderSpan - take);
      start = freshZone + Math.floor(Math.random() * (maxStart + 1));
    } else {
      // 内容很少：从中后段随便抽
      take = Math.min(RANDOM_POOL_SIZE, total);
      start = Math.floor(Math.random() * Math.max(1, total - take + 1));
    }
    const res = await db
      .collection('packs')
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(start)
      .limit(take)
      .field(PACK_FIELDS)
      .get();
    return pickRandom(excludeByIds(res.data || [], excludeIds), count);
  } catch (e) {
    console.warn('[listPacks] older random fallback', e.message || e);
    return [];
  }
}

/**
 * 混排一页：
 * - 50% 最新主轨（createdAt 倒序分页）
 * - 30% 热门池随机
 * - 20% 更早发布随机
 * 热门索引缺失时跳过热门，旧货仍尽量插。
 */
async function fetchMixedPage(where, { page, pageSize, total }) {
  let newestCount = Math.max(1, Math.round(pageSize * MIX_NEWEST_RATIO));
  let hotCount = Math.max(0, Math.round(pageSize * MIX_HOT_RATIO));
  let randomCount = Math.max(0, pageSize - newestCount - hotCount);
  // 比例四舍五入可能导致超页，裁剪到 pageSize
  while (newestCount + hotCount + randomCount > pageSize) {
    if (randomCount > 0) randomCount -= 1;
    else if (hotCount > 0) hotCount -= 1;
    else newestCount -= 1;
  }
  if (randomCount < Math.floor(pageSize * MIX_RANDOM_RATIO) && newestCount > 1) {
    // 尽量保住约 20% 随机旧货
    newestCount -= 1;
    randomCount += 1;
  }

  const newestSkip = (page - 1) * newestCount;
  const newestRes = await db
    .collection('packs')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(newestSkip)
    .limit(newestCount)
    .field(PACK_FIELDS)
    .get();
  const newest = newestRes.data || [];

  const used = new Set(newest.map((p) => p && p._id).filter(Boolean));
  const hot = await fetchHotRandom(where, {
    excludeIds: used,
    count: hotCount,
    page,
  });
  hot.forEach((p) => used.add(p._id));

  const older = await fetchOlderRandom(where, {
    excludeIds: used,
    count: randomCount,
    total,
    newestSkip,
    newestCount,
  });

  const packs = weaveNewestAndInserts(newest, hot.concat(older));
  const newestHasMore = newest.length >= newestCount;
  return { packs, newestHasMore, newestCount };
}

/**
 * 详情页推荐：同角色优先，再同类型，再全局随机；排除当前合集。
 */
async function fetchRandomPool(where, { excludeIds, count }) {
  if (count <= 0) return [];
  try {
    const countRes = await db.collection('packs').where(where).count();
    const total = countRes.total || 0;
    if (!total) return [];
    const poolSize = Math.min(40, total);
    const maxSkip = Math.max(0, total - poolSize);
    const start = Math.floor(Math.random() * (maxSkip + 1));
    const res = await db
      .collection('packs')
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(start)
      .limit(poolSize)
      .field(PACK_FIELDS)
      .get();
    return pickRandom(excludeByIds(res.data || [], excludeIds), count);
  } catch (e) {
    console.warn('[listPacks] recommend pool fallback', e.message || e);
    return [];
  }
}

async function fetchRecommendPacks({
  excludePackId,
  categoryId,
  contentType,
  limit,
}) {
  const need = Math.min(12, Math.max(1, Number(limit) || 6));
  const used = new Set(
    [excludePackId].map((x) => String(x || '').trim()).filter(Boolean),
  );
  const out = [];

  const take = async (filter, count) => {
    if (count <= 0) return;
    const where = buildWhere(filter);
    const picked = await fetchRandomPool(where, { excludeIds: used, count });
    picked.forEach((p) => {
      if (!p || !p._id || used.has(p._id)) return;
      used.add(p._id);
      out.push(p);
    });
  };

  // 1) 同角色
  if (categoryId && categoryId !== 'all' && categoryId !== 'uncategorized') {
    await take({ categoryId, contentType: 'all', keyword: '' }, need);
  }
  // 2) 同类型补齐
  if (out.length < need && contentType && contentType !== 'all') {
    await take(
      { categoryId: 'all', contentType, keyword: '' },
      need - out.length,
    );
  }
  // 3) 全局随机补齐
  if (out.length < need) {
    await take(
      { categoryId: 'all', contentType: 'all', keyword: '' },
      need - out.length,
    );
  }

  return shuffleInPlace(out.slice(0, need));
}

/**
 * 合集列表：keyword / categoryId / contentType
 * mode=mixed（默认，无搜索时）：最新为主 + 热门插花
 * mode=newest：纯最新
 * mode=recommend：详情页推荐（同角色优先随机）
 */
/** 首页拉列表前冲刷到期定时合集（定时器漏跑时也能上架） */
async function flushDuePacksQuiet() {
  try {
    await cloud.callFunction({
      name: 'adminPublishDuePacks',
      data: { action: 'flush' },
    });
  } catch (e) {
    console.warn('[listPacks] flushDuePacks', e.message || e);
  }
}

exports.main = async (event = {}) => {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(20, Math.max(1, Number(event.pageSize) || 10));
  const skip = (page - 1) * pageSize;
  const keyword = String(event.keyword || '')
    .trim()
    .slice(0, 40);
  const categoryId = String(event.categoryId || 'all').trim() || 'all';
  const categoryIds = Array.isArray(event.categoryIds)
    ? event.categoryIds.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const contentType = String(event.contentType || 'all').trim() || 'all';
  const forceRefresh = !!(event.forceRefresh || event.refreshCovers);
  const excludePackId = String(event.excludePackId || event.packId || '').trim();
  // 有搜索词时不做插花，保证结果相关且稳定
  const modeRaw = String(event.mode || event.sort || '').trim();
  const mode = modeRaw === 'recommend'
    ? 'recommend'
    : keyword
      ? 'newest'
      : modeRaw === 'newest'
        ? 'newest'
        : 'mixed';

  try {
    // 仅首页首屏混排时冲刷，避免每次翻页都打一次
    if (page === 1 && mode === 'mixed' && !keyword) {
      await flushDuePacksQuiet();
    }
    const moodWhere = buildWhere({
      keyword: '',
      categoryId: 'all',
      categoryIds: [],
      contentType: 'all',
    });
    const viralMin = await resolveViralDownloadMin(moodWhere);
    const popularMin = Math.max(8, Math.floor(viralMin * 0.25));

    if (mode === 'recommend') {
      const packs = await fetchRecommendPacks({
        excludePackId,
        categoryId,
        contentType,
        limit: Math.min(12, Math.max(1, Number(event.limit) || pageSize || 6)),
      });
      const list = await mapPacksWithCovers(packs, {
        forceRefresh,
        viralMin,
        popularMin,
      });
      return {
        ok: true,
        data: {
          list,
          page: 1,
          pageSize: list.length,
          total: list.length,
          hasMore: false,
          mode,
          viralMin,
        },
      };
    }

    const where = buildWhere({ keyword, categoryId, categoryIds, contentType });
    const countRes = await db.collection('packs').where(where).count();
    const total = countRes.total || 0;

    let packs = [];
    let hasMore = false;

    if (mode === 'mixed') {
      const mixed = await fetchMixedPage(where, { page, pageSize, total });
      packs = mixed.packs;
      // 以最新主轨是否还有下一页为准；不要用插花条数撑 hasMore，否则末页会空转
      hasMore = mixed.newestHasMore && page * mixed.newestCount < total;
    } else {
      const listRes = await db
        .collection('packs')
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(pageSize)
        .field(PACK_FIELDS)
        .get();
      packs = listRes.data || [];
      hasMore = skip + packs.length < total;
    }

    const list = await mapPacksWithCovers(packs, {
      forceRefresh,
      viralMin,
      popularMin,
    });

    return {
      ok: true,
      data: {
        list,
        page,
        pageSize,
        total,
        hasMore,
        mode,
        viralMin,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'LIST_FAIL', message: e.message || '加载失败' };
  }
};
