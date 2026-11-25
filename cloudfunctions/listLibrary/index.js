const cloud = require('wx-server-sdk');
const { resolveTempUrls } = require('./tempUrlCache');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const SOURCE_ANIMATE = 'animatemojis';
const SOURCE_FLUENT = 'fluent-emoji';
const SOURCE_COMMUNITY = 'animatemojis-community';

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
    desc: '圆润笑脸与日常表情，动作轻快好用',
    formatsDefault: ['gif', 'webp', 'lottie'],
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

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 已存在会报错，忽略
  }
}

async function ensureLibCollections() {
  await ensureCollection('lib_sources');
  await ensureCollection('lib_groups');
  await ensureCollection('lib_items');
}

async function ensureLibSources() {
  await ensureLibCollections();
  const groupCol = db.collection('lib_groups');

  // eslint-disable-next-line no-restricted-syntax
  for (const seed of SOURCE_SEEDS) {
    const ref = db.collection('lib_sources').doc(seed.id);
    let exists = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      const snap = await ref.get();
      exists = !!(snap && snap.data);
      if (exists) {
        // 同步展示文案（Google / Fluent 分卡）
        // eslint-disable-next-line no-await-in-loop
        await ref.update({
          data: {
            title: seed.title,
            subtitle: seed.subtitle,
            desc: seed.desc,
            formatsDefault: seed.formatsDefault,
            sort: seed.sort,
            updatedAt: db.serverDate(),
          },
        });
      }
    } catch (e) {
      exists = false;
    }

    if (!exists) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await ref.set({
          data: {
            id: seed.id,
            title: seed.title,
            subtitle: seed.subtitle,
            desc: seed.desc,
            uiTemplate: 'animated_multiformat',
            formatsDefault: seed.formatsDefault,
            coverFileID: '',
            previewFileIDs: [],
            itemCount: 0,
            groupCount: ANIMATE_GROUPS.length,
            status: 'published',
            enabled: true,
            sort: seed.sort,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        console.warn('[listLibrary] seed source', seed.id, e.message || e);
      }
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
}

async function listSources() {
  await ensureLibSources();
  const res = await db
    .collection('lib_sources')
    .where({ enabled: true, status: 'published' })
    .orderBy('sort', 'asc')
    .limit(50)
    .get();
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
    previewFileIDs: Array.isArray(s.previewFileIDs) ? s.previewFileIDs : [],
    sort: Number(s.sort) || 0,
  }));

  const fileIds = [];
  list.forEach((s) => {
    if (s.coverFileID) fileIds.push(s.coverFileID);
    (s.previewFileIDs || []).forEach((id) => {
      if (id) fileIds.push(id);
    });
  });
  const urlMap = await resolveTempUrls(cloud, fileIds);
  return list.map((s) => ({
    ...s,
    coverUrl: urlMap[s.coverFileID] || '',
    previewUrls: (s.previewFileIDs || []).map((id) => urlMap[id] || '').filter(Boolean),
  }));
}

async function listGroups(event) {
  const sourceId = String(event.sourceId || SOURCE_ANIMATE).trim() || SOURCE_ANIMATE;
  await ensureLibSources();
  const res = await db
    .collection('lib_groups')
    .where({ sourceId, status: 'published' })
    .orderBy('sort', 'asc')
    .limit(100)
    .get();
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
  let total = 0;
  try {
    const countRes = await db.collection('lib_items').where(where).count();
    total = countRes.total || 0;
  } catch (e) {
    total = 0;
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

  const fileIds = [];
  rows.forEach((row) => {
    const ref = pickPreviewRef(row);
    if (ref && !isHttpUrl(ref)) fileIds.push(ref);
  });
  const urlMap = await resolveTempUrls(cloud, fileIds);

  const list = rows.map((row) => {
    const previewRef = pickPreviewRef(row);
    let previewUrl = '';
    if (isHttpUrl(previewRef)) previewUrl = previewRef;
    else if (previewRef) previewUrl = urlMap[previewRef] || '';
    const files = row.files || {};
    const formats = ['gif', 'webp', 'lottie', 'png', 'svg'].filter(
      (f) => files[f] && String(files[f]).trim(),
    );
    return {
      _id: row._id,
      sourceId: row.sourceId,
      groupId: row.groupId || '',
      groupKey: row.groupKey || '',
      name: row.name || (row.meta && row.meta.zhName) || row.externalKey || '',
      externalKey: row.externalKey || '',
      tags: Array.isArray(row.tags) ? row.tags : [],
      formats,
      previewUrl,
      meta: row.meta || {},
      downloadCount: Number(row.downloadCount) || 0,
    };
  });

  return {
    list,
    total,
    page,
    pageSize,
    hasMore: skip + list.length < total,
  };
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
      const data = await listItems(event);
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
