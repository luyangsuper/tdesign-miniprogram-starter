const cloud = require('wx-server-sdk');
const { resolveTempUrls } = require('./tempUrlCache');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const SOURCE_ANIMATE = 'animatemojis';
const SOURCE_FLUENT = 'fluent-emoji';
const SOURCE_COMMUNITY = 'animatemojis-community';
const SOURCE_MEME = 'meme-api';

/** 使用 Unicode 官方分组的源；meme-api 分组由导入脚本写入 */
const EMOJI_GROUP_SOURCE_IDS = new Set([
  SOURCE_ANIMATE,
  SOURCE_FLUENT,
  SOURCE_COMMUNITY,
]);

const ANIMATE_GROUPS = [
  { key: 'smileys', title: '笑脸与情绪', emoji: '😊', sort: 10 },
  { key: 'people', title: '人物', emoji: '👋', sort: 20 },
  { key: 'animals', title: '动物与自然', emoji: '🐾', sort: 30 },
  { key: 'food', title: '饮食', emoji: '🍕', sort: 40 },
  { key: 'travel', title: '旅行与地点', emoji: '🚀', sort: 50 },
  { key: 'activities', title: '活动与事件', emoji: '🎉', sort: 60 },
  { key: 'objects', title: '物品', emoji: '💡', sort: 70 },
  { key: 'symbols', title: '符号', emoji: '✅', sort: 80 },
  { key: 'flags', title: '旗帜', emoji: '🏁', sort: 90 },
  { key: 'social', title: '社交', emoji: '💬', sort: 100 },
];

const SOURCE_SEEDS = [
  {
    id: SOURCE_ANIMATE,
    title: '经典动态表情',
    subtitle: '多格式',
    desc: '圆润笑脸与日常表情，含平面动图与 3D 静态图',
    formatsDefault: ['gif', 'webp', 'lottie', 'png'],
    sort: 10,
  },
  {
    id: SOURCE_FLUENT,
    title: '立体动态表情',
    subtitle: '立体',
    desc: '偏写实立体风格，人物动作更生动',
    formatsDefault: ['gif', 'webp'],
    sort: 20,
  },
  {
    id: SOURCE_COMMUNITY,
    title: '趣味反应表情',
    subtitle: '梗图',
    desc: '派对、Blob 等聊天反应，发梗更有气氛',
    formatsDefault: ['gif', 'webp'],
    sort: 30,
  },
  {
    id: SOURCE_MEME,
    title: '萌芽表情包',
    subtitle: '梗图',
    desc: '经典网络梗图表情 · 素材来自 meme-api · CC BY-NC-SA 4.0',
    formatsDefault: ['webp', 'gif'],
    sort: 40,
    costs: { anim: 0, static: 0 },
  },
  {
    id: 'sticker-ext',
    title: '精选聊天表情',
    subtitle: '全量',
    desc: '带描述的聊天表情合集 · sticker-ext',
    formatsDefault: ['gif', 'png', 'jpg', 'webp'],
    sort: 50,
    costs: { anim: 0, static: 0 },
  },
  {
    id: 'particlefx',
    title: '粒子特效素材',
    subtitle: '动图',
    desc: '氛围粒子动图，点开可选颜色 · ParticleFX',
    formatsDefault: ['gif'],
    sort: 60,
    costs: { anim: 4, static: 4 },
  },
];

function isHttpUrl(v) {
  return /^https?:\/\//i.test(String(v || '').trim());
}

function pickPreviewRef(item) {
  if (!item) return '';
  if (item.previewUrl && isHttpUrl(item.previewUrl)) return String(item.previewUrl);
  if (item.previewFileID) return String(item.previewFileID);
  const files = item.files || {};
  return String(files.webp || files.gif || files.png || '').trim();
}

/** 列表缩略图：优先静图，减少同屏 GIF 解码卡顿 */
function pickListThumbRef(item) {
  if (!item) return '';
  const files = item.files || {};
  if (files.webp) return String(files.webp).trim();
  if (files.png) return String(files.png).trim();
  if (files.jpg) return String(files.jpg).trim();
  if (files.jpeg) return String(files.jpeg).trim();
  return pickPreviewRef(item);
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 已存在会报错，忽略
  }
}

/** 冷启动只种子一次，避免每次 list 都串行扫库 */
let _seededAt = 0;
const SEED_TTL_MS = 10 * 60 * 1000;

async function ensureLibCollections() {
  await ensureCollection('lib_sources');
  await ensureCollection('lib_groups');
  await ensureCollection('lib_items');
}

async function ensureLibSources(opts = false) {
  const force = typeof opts === 'boolean' ? opts : !!(opts && opts.force);
  if (!force && _seededAt && Date.now() - _seededAt < SEED_TTL_MS) {
    return;
  }
  await ensureLibCollections();
  const groupCol = db.collection('lib_groups');

  // eslint-disable-next-line no-restricted-syntax
  for (const seed of SOURCE_SEEDS) {
    const ref = db.collection('lib_sources').doc(seed.id);
    let exists = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      const snap = await ref.get();
      const row = snap && snap.data;
      exists = !!row;
      if (exists) {
        // 同步展示文案；enabled/status 仅补缺，不覆盖手动关闭
        const patch = {
          title: seed.title,
          subtitle: seed.subtitle,
          desc: seed.desc,
          formatsDefault: seed.formatsDefault,
          sort: seed.sort,
          updatedAt: db.serverDate(),
        };
        if (row.enabled !== true && row.enabled !== false) {
          patch.enabled = true;
        }
        if (!row.status) {
          patch.status = 'published';
        }
        if (seed.costs && typeof seed.costs === 'object') {
          patch.costs = seed.costs;
        }
        // eslint-disable-next-line no-await-in-loop
        await ref.update({
          data: patch,
        });
      }
    } catch (e) {
      exists = false;
    }

    if (!exists) {
      try {
        const seedData = {
          id: seed.id,
          title: seed.title,
          subtitle: seed.subtitle,
          desc: seed.desc,
          uiTemplate: 'animated_multiformat',
          formatsDefault: seed.formatsDefault,
          coverFileID: '',
          previewFileIDs: [],
          itemCount: 0,
          groupCount: EMOJI_GROUP_SOURCE_IDS.has(seed.id)
            ? ANIMATE_GROUPS.length
            : 0,
          status: 'published',
          enabled: true,
          sort: seed.sort,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        };
        if (seed.costs && typeof seed.costs === 'object') {
          seedData.costs = seed.costs;
        }
        // eslint-disable-next-line no-await-in-loop
        await ref.set({
          data: seedData,
        });
      } catch (e) {
        console.warn('[listLibrary] seed source', seed.id, e.message || e);
      }
    }

    if (!EMOJI_GROUP_SOURCE_IDS.has(seed.id)) {
      continue;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const g of ANIMATE_GROUPS) {
      const gid = `${seed.id}_${g.key}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        const snap = await groupCol.doc(gid).get();
        if (snap && snap.data) continue;
      } catch (e) {
        /* create */
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await groupCol.doc(gid).set({
          data: {
            sourceId: seed.id,
            externalKey: g.key,
            title: g.title,
            emoji: g.emoji,
            coverFileID: '',
            itemCount: 0,
            sort: g.sort,
            status: 'published',
            createdAt: db.serverDate(),
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        console.warn('[listLibrary] seed group', gid, e.message || e);
      }
    }
  }
  _seededAt = Date.now();
}

/** 从该源素材里抽几张预览（fileID 或 http），供入口卡展示 */
async function sampleSourcePreviewRefs(sourceId, limit = 4) {
  const id = String(sourceId || '').trim();
  if (!id || limit <= 0) return [];
  const fetchLimit = Math.max(40, limit * 10);
  let rows = [];
  try {
    const res = await db
      .collection('lib_items')
      .where({ sourceId: id, status: 'published' })
      .orderBy('sort', 'asc')
      .limit(fetchLimit)
      .get();
    rows = res.data || [];
  } catch (e) {
    try {
      const res = await db
        .collection('lib_items')
        .where({ sourceId: id, status: 'published' })
        .limit(fetchLimit)
        .get();
      rows = res.data || [];
    } catch (e2) {
      console.warn('[listLibrary] sample previews', id, e2.message || e2);
      return [];
    }
  }
  // 均匀抽：避免永远只拿最前面几个
  const step = Math.max(1, Math.floor(rows.length / Math.max(limit, 1)));
  const picked = [];
  const seenIdx = new Set();
  for (let i = 0; i < limit && i * step < rows.length; i += 1) {
    const idx = Math.min(rows.length - 1, i * step);
    if (seenIdx.has(idx)) continue;
    seenIdx.add(idx);
    picked.push(rows[idx]);
  }
  // 不够再顺序补
  for (let i = 0; i < rows.length && picked.length < limit; i += 1) {
    if (seenIdx.has(i)) continue;
    seenIdx.add(i);
    picked.push(rows[i]);
  }
  const refs = [];
  const seen = new Set();
  picked.forEach((row) => {
    if (refs.length >= limit) return;
    const ref = String(pickPreviewRef(row) || '').trim();
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    refs.push(ref);
  });
  return refs;
}

async function listSources() {
  // 有数据时跳过 seed，首屏少几十次 DB
  let res;
  try {
    res = await db
      .collection('lib_sources')
      .where({ enabled: true, status: 'published' })
      .orderBy('sort', 'asc')
      .limit(50)
      .get();
  } catch (e) {
    res = { data: [] };
  }
  if (!(res.data && res.data.length)) {
    await ensureLibSources({ force: true });
    res = await db
      .collection('lib_sources')
      .where({ enabled: true, status: 'published' })
      .orderBy('sort', 'asc')
      .limit(50)
      .get();
  } else {
    _seededAt = Date.now();
  }
  const list = (res.data || []).map((s) => ({
    id: s.id || s._id,
    title: s.title || '',
    subtitle: s.subtitle || '',
    desc: s.desc || '',
    uiTemplate: s.uiTemplate || 'generic_grid',
    formatsDefault: Array.isArray(s.formatsDefault) ? s.formatsDefault : [],
    itemCount: Number(s.itemCount) || 0,
    groupCount: Number(s.groupCount) || 0,
    coverFileID: s.coverFileID || '',
    previewFileIDs: Array.isArray(s.previewFileIDs)
      ? s.previewFileIDs.map((x) => String(x || '').trim()).filter(Boolean)
      : [],
    sort: Number(s.sort) || 0,
    costs:
      s.costs && typeof s.costs === 'object'
        ? {
            anim: Number(s.costs.anim),
            static: Number(s.costs.static),
          }
        : null,
  }));

  // 缺预览时从该源素材抽 4 张，并尽量回写 lib_sources 供下次直出
  const sampledHttpBySource = Object.create(null);
  await Promise.all(
    list.map(async (s) => {
      if ((s.previewFileIDs || []).length >= 4) return;
      const need = 4 - (s.previewFileIDs || []).length;
      const refs = await sampleSourcePreviewRefs(s.id, Math.max(need, 4));
      if (!refs.length) return;
      const cloudIds = [];
      const https = [];
      refs.forEach((ref) => {
        if (isHttpUrl(ref)) https.push(ref);
        else if (ref) cloudIds.push(ref);
      });
      const prevKey = (s.previewFileIDs || []).join('|');
      const mergedIds = Array.from(
        new Set([...(s.previewFileIDs || []), ...cloudIds]),
      ).slice(0, 4);
      s.previewFileIDs = mergedIds;
      if (https.length) {
        sampledHttpBySource[s.id] = https.slice(0, 4);
      }
      if (mergedIds.length && mergedIds.join('|') !== prevKey) {
        try {
          await db.collection('lib_sources').doc(s.id).update({
            previewFileIDs: mergedIds,
            updatedAt: db.serverDate(),
          });
        } catch (e) {
          /* 回写失败不影响本次展示 */
        }
      }
    }),
  );

  const fileIds = [];
  list.forEach((s) => {
    if (s.coverFileID) fileIds.push(s.coverFileID);
    (s.previewFileIDs || []).forEach((id) => {
      if (id) fileIds.push(id);
    });
  });
  const urlMap = await resolveTempUrls(cloud, fileIds);
  return list.map((s) => {
    const slots = [];
    const seen = new Set();
    (s.previewFileIDs || []).forEach((id) => {
      const fileId = String(id || '').trim();
      if (!fileId || seen.has(fileId)) return;
      const url = String(urlMap[fileId] || '').trim();
      if (!url) return;
      seen.add(fileId);
      slots.push({ url, fileId });
    });
    (sampledHttpBySource[s.id] || []).forEach((u) => {
      const url = String(u || '').trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      slots.push({ url, fileId: '' });
    });
    const previewSlots = slots.slice(0, 4);
    return {
      ...s,
      coverUrl: urlMap[s.coverFileID] || '',
      previewSlots,
      previewUrls: previewSlots.map((x) => x.url),
      previewFileIDs: previewSlots.map((x) => x.fileId).filter(Boolean),
    };
  });
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * 首页「发现更多有趣素材」右侧：每次打开随机抽几张素材预览
 * @param {{ limit?: number }} event
 */
async function randomPreviews(event = {}) {
  const limit = Math.max(1, Math.min(6, Math.floor(Number(event.limit) || 3)));
  const fetchLimit = Math.max(48, limit * 24);
  let rows = [];
  try {
    const res = await db
      .collection('lib_items')
      .where({ status: 'published' })
      .limit(fetchLimit)
      .get();
    rows = res.data || [];
  } catch (e) {
    console.warn('[listLibrary] randomPreviews', e.message || e);
    return { urls: [] };
  }
  shuffleInPlace(rows);
  const cloudIds = [];
  const https = [];
  const seen = new Set();
  for (let i = 0; i < rows.length && cloudIds.length + https.length < limit * 2; i += 1) {
    const ref = String(pickPreviewRef(rows[i]) || '').trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    if (isHttpUrl(ref)) https.push(ref);
    else cloudIds.push(ref);
  }
  const urlMap = await resolveTempUrls(cloud, cloudIds);
  const slots = [];
  const pushSlot = (url, fileId) => {
    const u = String(url || '').trim();
    if (!u || slots.length >= limit) return;
    if (slots.some((s) => s.url === u)) return;
    slots.push({ url: u, fileId: String(fileId || '').trim() });
  };
  cloudIds.forEach((id) => pushSlot(urlMap[id], id));
  https.forEach((u) => pushSlot(u, ''));
  return {
    urls: slots.map((s) => s.url),
    slots,
  };
}

async function listGroups(event) {
  const sourceId = String(event.sourceId || SOURCE_ANIMATE).trim() || SOURCE_ANIMATE;
  let res;
  try {
    res = await db
      .collection('lib_groups')
      .where({ sourceId, status: 'published' })
      .orderBy('sort', 'asc')
      .limit(100)
      .get();
  } catch (e) {
    res = { data: [] };
  }
  if (!(res.data && res.data.length)) {
    await ensureLibSources({ force: true });
    res = await db
      .collection('lib_groups')
      .where({ sourceId, status: 'published' })
      .orderBy('sort', 'asc')
      .limit(100)
      .get();
  }
  return (res.data || []).map((g) => ({
    id: g._id,
    sourceId: g.sourceId,
    externalKey: g.externalKey || '',
    title: g.title || '',
    emoji: g.emoji || '',
    itemCount: Number(g.itemCount) || 0,
    sort: Number(g.sort) || 0,
  }));
}

async function listItems(event) {
  const sourceId = String(event.sourceId || SOURCE_ANIMATE).trim() || SOURCE_ANIMATE;
  const groupId = String(event.groupId || '').trim();
  const groupKey = String(event.groupKey || '').trim();
  const keyword = String(event.keyword || '')
    .trim()
    .slice(0, 40);
  const page = Math.max(1, Math.floor(Number(event.page) || 1));
  const pageSize = Math.min(60, Math.max(1, Math.floor(Number(event.pageSize) || 40)));
  const skip = (page - 1) * pageSize;

  const conds = [{ sourceId }, { status: 'published' }];
  if (groupId) {
    conds.push({ groupId });
  } else if (groupKey) {
    conds.push({ groupKey });
  }
  if (keyword) {
    const reg = db.RegExp({
      regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      options: 'i',
    });
    conds.push(
      _.or([{ name: reg }, { externalKey: reg }, { tags: reg }]),
    );
  }

  const where = conds.length === 1 ? conds[0] : _.and(conds);
  const skipCount = !!event.skipCount;
  let total = 0;
  if (!skipCount) {
    try {
      const countRes = await db.collection('lib_items').where(where).count();
      total = countRes.total || 0;
    } catch (e) {
      total = 0;
    }
  }

  let rows = [];
  try {
    const res = await db
      .collection('lib_items')
      .where(where)
      .orderBy('sort', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get();
    rows = res.data || [];
  } catch (e) {
    // 无 sort 索引时回退
    try {
      const res = await db.collection('lib_items').where(where).skip(skip).limit(pageSize).get();
      rows = res.data || [];
    } catch (e2) {
      console.warn('[listLibrary] listItems', e2.message || e2);
      rows = [];
    }
  }

  // 列表只换缩略图链（优先静图）；点开预览再换各格式
  const previewIds = [];
  rows.forEach((row) => {
    const ref = pickListThumbRef(row);
    if (ref && !isHttpUrl(ref)) previewIds.push(ref);
  });
  const urlMap = await resolveTempUrls(cloud, [...new Set(previewIds)]);

  const list = rows.map((row) => {
    const filesRaw = row.files || {};
    const files = {};
    const fileUrls = {};
    ['gif', 'webp', 'lottie', 'png', 'svg'].forEach((f) => {
      const ref = String(filesRaw[f] || '').trim();
      if (!ref) return;
      files[f] = ref;
      if (isHttpUrl(ref)) fileUrls[f] = ref;
    });
    const formats = Object.keys(files);
    const previewRef = pickListThumbRef(row);
    let previewUrl = '';
    if (isHttpUrl(previewRef)) previewUrl = previewRef;
    else if (previewRef) previewUrl = urlMap[previewRef] || '';
    if (!previewUrl) {
      previewUrl =
        fileUrls.webp || fileUrls.png || fileUrls.gif || fileUrls.lottie || '';
    }
    // 预览链回填到对应格式，点开时可直接用
    if (previewUrl && previewRef && files.webp === previewRef) {
      fileUrls.webp = previewUrl;
    } else if (previewUrl && previewRef && files.gif === previewRef) {
      fileUrls.gif = previewUrl;
    } else if (previewUrl && previewRef && files.png === previewRef) {
      fileUrls.png = previewUrl;
    }
    return {
      _id: row._id,
      sourceId: row.sourceId,
      groupId: row.groupId || '',
      groupKey: row.groupKey || '',
      name: row.name || (row.meta && row.meta.zhName) || row.externalKey || '',
      externalKey: row.externalKey || '',
      tags: Array.isArray(row.tags) ? row.tags : [],
      formats,
      files,
      fileUrls,
      previewUrl,
      meta: row.meta || {},
      downloadCount: Number(row.downloadCount) || 0,
    };
  });

  return {
    list,
    total: skipCount ? skip + list.length + (list.length >= pageSize ? 1 : 0) : total,
    page,
    pageSize,
    hasMore: skipCount
      ? list.length >= pageSize
      : skip + list.length < total,
  };
}

function mapItemRow(row, urlMap = {}) {
  const filesRaw = row.files || {};
  const files = {};
  const fileUrls = {};
  ['gif', 'webp', 'lottie', 'png', 'svg'].forEach((f) => {
    const ref = String(filesRaw[f] || '').trim();
    if (!ref) return;
    files[f] = ref;
    if (isHttpUrl(ref)) fileUrls[f] = ref;
  });
  const formats = Object.keys(files);
  const previewRef = pickPreviewRef(row);
  let previewUrl = '';
  if (isHttpUrl(previewRef)) previewUrl = previewRef;
  else if (previewRef) previewUrl = urlMap[previewRef] || '';
  if (!previewUrl) {
    previewUrl =
      fileUrls.webp || fileUrls.gif || fileUrls.png || fileUrls.lottie || '';
  }
  return {
    _id: row._id,
    sourceId: row.sourceId || '',
    groupId: row.groupId || '',
    groupKey: row.groupKey || '',
    name: row.name || '',
    externalKey: row.externalKey || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    formats,
    files,
    fileUrls,
    previewUrl,
    previewFileID: previewRef && !isHttpUrl(previewRef) ? previewRef : '',
    meta: row.meta || {},
    downloadCount: Number(row.downloadCount) || 0,
  };
}

/**
 * 首页全局搜素材：跨源、小页、不算 total，减轻 RegExp 压力
 */
async function searchItems(event = {}) {
  const keyword = String(event.keyword || '')
    .trim()
    .slice(0, 24);
  if (!keyword) return { list: [] };
  const pageSize = Math.min(
    20,
    Math.max(1, Math.floor(Number(event.pageSize) || 12)),
  );
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reg = db.RegExp({ regexp: escaped, options: 'i' });
  // 只搜 name / externalKey，不扫 tags，控制扫描量
  const where = _.and([
    { status: 'published' },
    _.or([{ name: reg }, { externalKey: reg }]),
  ]);

  let rows = [];
  try {
    const res = await db.collection('lib_items').where(where).limit(pageSize).get();
    rows = res.data || [];
  } catch (e) {
    console.warn('[listLibrary] search', e.message || e);
    return { list: [] };
  }

  const previewIds = [];
  rows.forEach((row) => {
    const ref = pickPreviewRef(row);
    if (ref && !isHttpUrl(ref)) previewIds.push(ref);
  });
  const urlMap = await resolveTempUrls(cloud, [...new Set(previewIds)]);

  // 源标题：种子表 + 一次批量（失败则空）
  const sourceTitleMap = Object.create(null);
  SOURCE_SEEDS.forEach((s) => {
    if (s && s.id) sourceTitleMap[s.id] = s.title || s.id;
  });
  const needIds = [
    ...new Set(
      rows
        .map((r) => String(r.sourceId || '').trim())
        .filter((id) => id && !sourceTitleMap[id]),
    ),
  ].slice(0, 20);
  if (needIds.length) {
    try {
      const snap = await db
        .collection('lib_sources')
        .where({ _id: _.in(needIds) })
        .limit(20)
        .get();
      (snap.data || []).forEach((s) => {
        const id = s._id || s.id;
        if (id) sourceTitleMap[id] = s.title || id;
      });
    } catch (e) {
      /* ignore */
    }
  }

  const list = rows.map((row) => {
    const item = mapItemRow(row, urlMap);
    const sid = item.sourceId;
    return {
      ...item,
      sourceTitle: sourceTitleMap[sid] || sid || '素材',
    };
  });
  return { list };
}

async function getItem(event = {}) {
  const itemId = String(event.itemId || event.id || '').trim();
  if (!itemId) return { item: null };
  let row = null;
  try {
    const snap = await db.collection('lib_items').doc(itemId).get();
    row = snap.data || null;
    if (row && !row._id) row._id = itemId;
  } catch (e) {
    return { item: null };
  }
  if (!row || row.status !== 'published') return { item: null };
  const ref = pickPreviewRef(row);
  const urlMap =
    ref && !isHttpUrl(ref)
      ? await resolveTempUrls(cloud, [ref])
      : {};
  return { item: mapItemRow(row, urlMap) };
}

exports.main = async (event = {}) => {
  const action = String(event.action || 'sources').trim();
  try {
    if (action === 'sources') {
      const list = await listSources();
      return { ok: true, data: { list } };
    }
    if (action === 'groups') {
      const list = await listGroups(event);
      return { ok: true, data: { list } };
    }
    if (action === 'items') {
      // 翻页列表可跳过 count（首页/二次加载），源页首屏仍算 total
      if (event.skipCount) {
        const data = await listItems({ ...event, skipCount: true });
        return { ok: true, data };
      }
      const data = await listItems(event);
      return { ok: true, data };
    }
    if (action === 'search') {
      const data = await searchItems(event);
      return { ok: true, data };
    }
    if (action === 'item') {
      const data = await getItem(event);
      return { ok: true, data };
    }
    if (action === 'randomPreviews') {
      const data = await randomPreviews(event);
      return { ok: true, data };
    }
    if (action === 'ensureSeed') {
      await ensureLibSources();
      return { ok: true, data: { seeded: true } };
    }
    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'LIST_FAIL', message: e.message || '加载失败' };
  }
};
