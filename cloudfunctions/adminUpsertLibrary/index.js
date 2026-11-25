const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

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

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    /* 已存在 */
  }
}

async function ensureLibCollections() {
  await ensureCollection('lib_sources');
  await ensureCollection('lib_groups');
  await ensureCollection('lib_items');
  await ensureCollection('lib_import_jobs');
}

function cleanFiles(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach((k) => {
    const key = String(k || '')
      .trim()
      .toLowerCase();
    const fmt = key === 'json' || key === 'lottie.json' ? 'lottie' : key;
    const v = String(raw[k] || '').trim();
    if (fmt && v) out[fmt] = v;
  });
  return out;
}

async function upsertSource(payload = {}) {
  const id = String(payload.id || payload.sourceId || '').trim();
  if (!id) throw new Error('缺少 sourceId');
  const patch = {
    id,
    title: String(payload.title || id).trim().slice(0, 40),
    subtitle: String(payload.subtitle || '').trim().slice(0, 40),
    desc: String(payload.desc || '').trim().slice(0, 120),
    uiTemplate: String(payload.uiTemplate || 'generic_grid').trim(),
    formatsDefault: Array.isArray(payload.formatsDefault)
      ? payload.formatsDefault.map((x) => String(x).toLowerCase())
      : ['gif', 'webp', 'lottie'],
    coverFileID: String(payload.coverFileID || '').trim(),
    previewFileIDs: Array.isArray(payload.previewFileIDs)
      ? payload.previewFileIDs.filter(Boolean).slice(0, 8)
      : [],
    enabled: payload.enabled !== false,
    status: payload.status === 'draft' ? 'draft' : 'published',
    sort: Math.max(0, Number(payload.sort) || 0),
    updatedAt: db.serverDate(),
  };
  if (payload.itemCount != null) patch.itemCount = Math.max(0, Number(payload.itemCount) || 0);
  if (payload.groupCount != null) patch.groupCount = Math.max(0, Number(payload.groupCount) || 0);

  const ref = db.collection('lib_sources').doc(id);
  try {
    await ref.get();
    await ref.update({ data: patch });
  } catch (e) {
    await ref.set({
      data: {
        ...patch,
        itemCount: patch.itemCount || 0,
        groupCount: patch.groupCount || 0,
        downloadCount: 0,
        createdAt: db.serverDate(),
      },
    });
  }
  return { id };
}

async function upsertGroups(sourceId, groups = []) {
  const results = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const g of groups) {
    const key = String((g && (g.externalKey || g.key)) || '').trim();
    if (!key) continue;
    const gid = String((g && g.id) || `${sourceId}_${key}`).trim();
    const data = {
      sourceId,
      externalKey: key,
      title: String((g && g.title) || key).trim().slice(0, 40),
      emoji: String((g && g.emoji) || '').trim().slice(0, 8),
      coverFileID: String((g && g.coverFileID) || '').trim(),
      itemCount: Math.max(0, Number((g && g.itemCount) || 0)),
      sort: Math.max(0, Number((g && g.sort) || 0)),
      status: (g && g.status) === 'draft' ? 'draft' : 'published',
      updatedAt: db.serverDate(),
    };
    const ref = db.collection('lib_groups').doc(gid);
    try {
      // eslint-disable-next-line no-await-in-loop
      await ref.get();
      // eslint-disable-next-line no-await-in-loop
      await ref.update({ data });
    } catch (e) {
      // eslint-disable-next-line no-await-in-loop
      await ref.set({
        data: {
          ...data,
          createdAt: db.serverDate(),
        },
      });
    }
    results.push({ id: gid, externalKey: key });
  }
  return results;
}

async function upsertItems(sourceId, items = []) {
  const results = [];
  let ok = 0;
  let fail = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const raw of items) {
    try {
      const externalKey = String((raw && (raw.externalKey || raw.slug)) || '').trim();
      if (!externalKey) {
        fail += 1;
        continue;
      }
      const docId = String((raw && raw._id) || `${sourceId}_${externalKey}`).trim();
      const files = cleanFiles(raw && raw.files);
      const groupKey = String((raw && (raw.groupKey || raw.category)) || '').trim();
      const groupId = String((raw && raw.groupId) || (groupKey ? `${sourceId}_${groupKey}` : '')).trim();
      const name = String(
        (raw && raw.name) ||
          (raw && raw.meta && raw.meta.zhName) ||
          externalKey,
      )
        .trim()
        .slice(0, 80);
      const data = {
        sourceId,
        groupId,
        groupKey,
        externalKey,
        name,
        tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
        previewFileID: String((raw && raw.previewFileID) || '').trim(),
        previewUrl: String((raw && raw.previewUrl) || '').trim(),
        files,
        meta: raw && raw.meta && typeof raw.meta === 'object' ? raw.meta : { slug: externalKey },
        sort: Math.max(0, Number((raw && raw.sort) || 0)),
        status: (raw && raw.status) === 'draft' ? 'draft' : 'published',
        updatedAt: db.serverDate(),
      };
      if (!data.previewFileID && !data.previewUrl) {
        data.previewFileID = files.webp || files.gif || files.png || '';
      }
      const ref = db.collection('lib_items').doc(docId);
      try {
        // eslint-disable-next-line no-await-in-loop
        await ref.get();
        // eslint-disable-next-line no-await-in-loop
        await ref.update({ data });
      } catch (e) {
        // eslint-disable-next-line no-await-in-loop
        await ref.set({
          data: {
            ...data,
            downloadCount: 0,
            createdAt: db.serverDate(),
          },
        });
      }
      results.push({ id: docId, externalKey });
      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn('[adminUpsertLibrary] item', e.message || e);
    }
  }
  return { ok, fail, results };
}

const ANIMATE_SOURCE = {
  id: 'animatemojis',
  title: '经典动态表情',
  subtitle: '多格式',
  desc: '圆润笑脸与日常表情，动作轻快好用',
  uiTemplate: 'animated_multiformat',
  formatsDefault: ['gif', 'webp', 'lottie'],
  sort: 10,
  enabled: true,
  status: 'published',
};

const FLUENT_SOURCE = {
  id: 'fluent-emoji',
  title: '立体动态表情',
  subtitle: '立体',
  desc: '偏写实立体风格，人物动作更生动',
  uiTemplate: 'animated_multiformat',
  formatsDefault: ['gif', 'webp'],
  sort: 20,
  enabled: true,
  status: 'published',
};

const COMMUNITY_SOURCE = {
  id: 'animatemojis-community',
  title: '趣味反应表情',
  subtitle: '梗图',
  desc: '派对、Blob 等聊天反应，发梗更有气氛',
  uiTemplate: 'animated_multiformat',
  formatsDefault: ['gif', 'webp'],
  sort: 30,
  enabled: true,
  status: 'published',
};

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

const CATEGORY_MAP = {
  'smileys-and-emotions': 'smileys',
  smileys: 'smileys',
  people: 'people',
  'animals-and-nature': 'animals',
  animals: 'animals',
  'food-and-drink': 'food',
  food: 'food',
  'travel-and-places': 'travel',
  travel: 'travel',
  'activities-and-events': 'activities',
  activities: 'activities',
  objects: 'objects',
  symbols: 'symbols',
  flags: 'flags',
  reactions: 'social',
  social: 'social',
  'rainbow-rave': 'activities',
  'party-parrot': 'activities',
  'nerd-life': 'objects',
  random: 'objects',
};

function mapCategory(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return CATEGORY_MAP[key] || 'smileys';
}

let _zhNameMap = null;
function getZhNameMap() {
  if (_zhNameMap) return _zhNameMap;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    _zhNameMap = require('./zhEmojiNames.json');
  } catch (e) {
    _zhNameMap = {};
  }
  return _zhNameMap;
}

/** 从 fonts.gstatic …/1f602/512.gif 解析 codepoint key */
function codepointKeyFromUrl(url) {
  const m = String(url || '').match(/\/notoemoji\/latest\/([0-9a-f_]+)\//i);
  return m ? m[1].toLowerCase() : '';
}

function zhNameFromUrls(urls = {}, fallback = '') {
  const sample = urls.webp || urls.gif || urls.lottie || '';
  const key = codepointKeyFromUrl(sample);
  if (!key) return fallback;
  const map = getZhNameMap();
  return map[key] || fallback;
}

function httpGetBuffer(url, redirectLeft = 3) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const lib = /^http:\/\//i.test(url) ? http : https;
    const req = lib.get(
      url,
      {
        headers: { 'User-Agent': 'emojiShare-library-import/1.0' },
        timeout: 12000,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectLeft > 0
        ) {
          res.resume();
          httpGetBuffer(res.headers.location, redirectLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

function httpGetJson(url) {
  return httpGetBuffer(url).then((buf) => JSON.parse(buf.toString('utf8')));
}

async function mirrorUrlToCloud(url, cloudPath) {
  const buf = await httpGetBuffer(url);
  if (!buf || !buf.length) throw new Error('空文件');
  const up = await cloud.uploadFile({
    cloudPath,
    fileContent: buf,
  });
  return up.fileID || up.fileId || '';
}

/**
 * 从 AnimateMojis 公开 API 拉一页：
 * - 中文名：Unicode CLDR 简体（笑哭了 / 嘿嘿…）
 * - 文件：下载后上传到云存储（不再只存外链）
 * 公开 API 目前约 720 条（Google Noto）；站点宣传的 2000+ 含 Fluent/社区，API 未开放。
 */
let _otherCatalog = null;
function getOtherCatalog() {
  if (_otherCatalog) return _otherCatalog;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    _otherCatalog = require('./otherCatalog.json');
  } catch (e) {
    _otherCatalog = [];
  }
  return Array.isArray(_otherCatalog) ? _otherCatalog : [];
}

let _fluentZhMap = null;
function getFluentZhMap() {
  if (_fluentZhMap) return _fluentZhMap;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    _fluentZhMap = require('./fluentZhNames.json');
  } catch (e) {
    _fluentZhMap = {};
  }
  return _fluentZhMap;
}

function sourceMetaForKind(kind) {
  if (kind === 'fluent') return FLUENT_SOURCE;
  if (kind === 'community') return COMMUNITY_SOURCE;
  return null;
}

/** 后台导入任务（可离开小程序页面，进度落库） */
const JOB_MODE = {
  other: 'import_other',
  google: 'import_google',
};

function jobIdForMode(mode) {
  const m = String(mode || '').trim();
  return JOB_MODE[m] || '';
}

function newJobToken() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readImportJob(jobId) {
  try {
    const snap = await db.collection('lib_import_jobs').doc(jobId).get();
    return snap.data || null;
  } catch (e) {
    return null;
  }
}

async function writeImportJob(jobId, patch) {
  const ref = db.collection('lib_import_jobs').doc(jobId);
  const prev = (await readImportJob(jobId)) || {};
  const data = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
    createdAt: Number(prev.createdAt) || Date.now(),
  };
  // 云数据库禁止在 set/update 的 data 里带 _id（-501007）
  delete data._id;
  delete data._openid;
  await ref.set({ data });
  return { ...data, _id: jobId };
}

function publicJob(job) {
  if (!job) return null;
  return {
    mode: job.mode,
    status: job.status,
    offset: Number(job.offset) || 0,
    page: Number(job.page) || 1,
    total: Number(job.total) || 0,
    imported: Number(job.imported) || 0,
    skipped: Number(job.skipped) || 0,
    fail: Number(job.fail) || 0,
    mirrorFail: Number(job.mirrorFail) || 0,
    message: String(job.message || ''),
    updatedAt: Number(job.updatedAt) || 0,
    startedAt: Number(job.startedAt) || 0,
  };
}

async function getExistingItemFiles(sourceId, externalKey) {
  try {
    const snap = await db
      .collection('lib_items')
      .doc(`${sourceId}_${externalKey}`)
      .get();
    return (snap.data && snap.data.files) || {};
  } catch (e) {
    return {};
  }
}

function filesComplete(files, needFormats) {
  const f = files || {};
  return needFormats.every((fmt) => !!String(f[fmt] || '').trim());
}

/** 排队下一拍：只等请求发出，不等整段跑完，避免父子互相拖死超时 */
async function scheduleJobTick(mode, token) {
  const p = cloud.callFunction({
    name: 'adminUpsertLibrary',
    data: {
      action: 'importJobTick',
      mode,
      _chain: true,
      _token: token,
    },
  });
  await Promise.race([
    p.then(() => null).catch((e) => {
      console.warn('[importJob] chain', e.message || e);
    }),
    new Promise((r) => setTimeout(r, 500)),
  ]);
}

/**
 * 立体+反应：每拍少做一点，边做边写进度，避免 60s 超时后永远停在 0%。
 * - 先快扫跳过已入库（最多 50）
 * - 本拍最多新镜像 1 条（gif+webp）
 */
async function runOtherJobTick(job) {
  const catalog = getOtherCatalog();
  const total = catalog.length;
  let offset = Math.max(0, Math.floor(Number(job.offset) || 0));
  let imported = Number(job.imported) || 0;
  let skipped = Number(job.skipped) || 0;
  let fail = Number(job.fail) || 0;
  let mirrorFail = Number(job.mirrorFail) || 0;

  if (!total) {
    const errJob = await writeImportJob(JOB_MODE.other, {
      ...job,
      status: 'error',
      total: 0,
      lockAt: 0,
      message: '云端缺少 otherCatalog.json，请重新「上传并部署」adminUpsertLibrary',
    });
    return publicJob(errJob);
  }

  if (offset === 0) {
    await upsertSource(FLUENT_SOURCE);
    await upsertGroups(FLUENT_SOURCE.id, ANIMATE_GROUPS);
    await upsertSource(COMMUNITY_SOURCE);
    await upsertGroups(COMMUNITY_SOURCE.id, ANIMATE_GROUPS);
  }

  // 心跳：一进拍就写一次，前端马上离开 0%
  await writeImportJob(JOB_MODE.other, {
    ...job,
    total,
    offset,
    status: 'running',
    lockAt: Date.now(),
    message: `处理中 ${offset}/${total}…`,
  });

  const fluentZh = getFluentZhMap();
  const deadline = Date.now() + 50000;
  const maxSkipScan = 50;
  let scanned = 0;
  let mirrored = 0;
  let lastSlug = '';

  while (offset < total && Date.now() < deadline && mirrored < 1 && scanned < maxSkipScan + 1) {
    const row = catalog[offset];
    const sortIndex = offset + 1;
    offset += 1;
    scanned += 1;
    const slug = String((row && row.s) || '')
      .trim()
      .toLowerCase();
    const kind = String((row && row.k) || '').trim();
    const srcMeta = sourceMetaForKind(kind);
    if (!slug || !srcMeta) {
      skipped += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const existing = await getExistingItemFiles(srcMeta.id, slug);
    const need = ['gif', 'webp'].filter((fmt) => row[fmt]);
    if (filesComplete(existing, need)) {
      skipped += 1;
      continue;
    }

    const enName = String((row && row.n) || slug).trim();
    const zhName = (kind === 'fluent' && fluentZh[slug]) || enName;
    const groupKey = mapCategory(row.g);
    const files = { ...existing };
    const cloudBase = `library/${srcMeta.id}/${slug}`;
    lastSlug = slug;

    // eslint-disable-next-line no-restricted-syntax
    for (const fmt of need) {
      if (files[fmt]) continue;
      const url = row[fmt];
      if (!url) continue;
      if (Date.now() >= deadline) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        const fileID = await mirrorUrlToCloud(url, `${cloudBase}/${slug}.${fmt}`);
        if (fileID) files[fmt] = fileID;
      } catch (e) {
        mirrorFail += 1;
        console.warn('[importOther] mirror', slug, fmt, e.message || e);
      }
    }

    if (!Object.keys(files).length) {
      fail += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const data = await upsertItems(srcMeta.id, [
      {
        externalKey: slug,
        name: zhName,
        groupKey,
        tags: Array.from(
          new Set(
            [zhName, enName, kind]
              .map((t) => String(t || '').trim())
              .filter(Boolean),
          ),
        ).slice(0, 12),
        previewFileID: files.webp || files.gif || '',
        previewUrl: '',
        files,
        meta: { slug, zhName, enName, kind, mirrored: true },
        sort: sortIndex,
      },
    ]);
    imported += data.ok || 0;
    fail += data.fail || 0;
    mirrored += 1;
  }

  const done = offset >= total;
  const next = {
    mode: 'other',
    status: done ? 'done' : 'running',
    token: job.token,
    offset,
    total,
    imported,
    skipped,
    fail,
    mirrorFail,
    startedBy: job.startedBy || '',
    startedAt: job.startedAt || Date.now(),
    lockAt: 0,
    message: done
      ? `立体+反应完成：入库 ${imported}，跳过 ${skipped}`
      : lastSlug
        ? `已处理到 ${offset}/${total}（刚写入 ${lastSlug}）`
        : `已扫描 ${offset}/${total}（本拍跳过 ${scanned}）`,
  };

  if (done) {
    await refreshCounts(FLUENT_SOURCE.id);
    await refreshCounts(COMMUNITY_SOURCE.id);
  }

  return publicJob(await writeImportJob(JOB_MODE.other, next));
}

/**
 * 经典 Google：每拍 1 页、每页最多 3 条；先写心跳再镜像，避免超时停在 0%。
 */
async function runGoogleJobTick(job) {
  const page = Math.max(1, Math.floor(Number(job.page) || 1));
  const limit = 3;
  // Lottie 体积大、易超时；导入阶段先 gif+webp，够用
  const includeLottie = false;
  let imported = Number(job.imported) || 0;
  let skipped = Number(job.skipped) || 0;
  let fail = Number(job.fail) || 0;
  let mirrorFail = Number(job.mirrorFail) || 0;

  if (page === 1) {
    await upsertSource(ANIMATE_SOURCE);
    await upsertGroups(ANIMATE_SOURCE.id, ANIMATE_GROUPS);
  }

  await writeImportJob(JOB_MODE.google, {
    ...job,
    status: 'running',
    page,
    lockAt: Date.now(),
    message: `拉取第 ${page} 页…`,
  });

  let json;
  try {
    const url = `https://animatemojis.com/api/emojis?page=${page}&limit=${limit}`;
    json = await httpGetJson(url);
  } catch (e) {
    const errJob = await writeImportJob(JOB_MODE.google, {
      ...job,
      status: 'running',
      lockAt: 0,
      message: `拉列表失败：${e.message || e}（将重试）`,
    });
    return publicJob(errJob);
  }

  const rows = Array.isArray(json.emojis) ? json.emojis : [];
  const total = Number(json.total) || Number(job.total) || 720;
  const totalPages = Number(json.totalPages) || Math.ceil(total / limit) || 1;
  const deadline = Date.now() + 50000;
  const items = [];

  // eslint-disable-next-line no-restricted-syntax
  for (let idx = 0; idx < rows.length; idx += 1) {
    if (Date.now() >= deadline) break;
    const row = rows[idx];
    const slug = String((row && row.slug) || '')
      .trim()
      .toLowerCase();
    if (!slug) continue;
    const urls = (row && row.download_urls) || {};
    const need = ['gif', 'webp'].concat(includeLottie && urls.lottie ? ['lottie'] : []);
    // eslint-disable-next-line no-await-in-loop
    const existing = await getExistingItemFiles(ANIMATE_SOURCE.id, slug);
    if (filesComplete(existing, need.filter((f) => urls[f]))) {
      skipped += 1;
      continue;
    }

    const enName = String((row && row.name) || slug).trim();
    const zhName = zhNameFromUrls(urls, enName);
    const groupKey = mapCategory(row.category);
    const files = { ...existing };

    // eslint-disable-next-line no-restricted-syntax
    for (const fmt of need) {
      if (files[fmt]) continue;
      const src = urls[fmt];
      if (!src) continue;
      const ext = fmt === 'lottie' ? 'json' : fmt;
      const cloudPath = `library/animatemojis/${slug}/${slug}.${ext}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        const fileID = await mirrorUrlToCloud(src, cloudPath);
        if (fileID) files[fmt] = fileID;
      } catch (e) {
        mirrorFail += 1;
        console.warn('[importAnimate] mirror', slug, fmt, e.message || e);
      }
    }

    if (!Object.keys(files).length) {
      fail += 1;
      continue;
    }

    items.push({
      externalKey: slug,
      name: zhName,
      groupKey,
      tags: Array.from(
        new Set(
          [zhName, enName]
            .concat(Array.isArray(row.keywords) ? row.keywords : [])
            .map((t) => String(t || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 12),
      previewFileID: files.webp || files.gif || '',
      previewUrl: '',
      files,
      meta: {
        slug,
        zhName,
        enName,
        codepoint: codepointKeyFromUrl(urls.webp || urls.gif || ''),
        author: String((row && row.author) || '').trim(),
        mirrored: true,
      },
      sort: (page - 1) * limit + idx + 1,
    });
  }

  if (items.length) {
    const data = await upsertItems(ANIMATE_SOURCE.id, items);
    imported += data.ok || 0;
    fail += data.fail || 0;
  }

  const done = page >= totalPages || rows.length === 0;
  const nextPage = done ? page : page + 1;
  const next = {
    mode: 'google',
    status: done ? 'done' : 'running',
    token: job.token,
    page: nextPage,
    total,
    totalPages,
    includeLottie: false,
    imported,
    skipped,
    fail,
    mirrorFail,
    startedBy: job.startedBy || '',
    startedAt: job.startedAt || Date.now(),
    lockAt: 0,
    message: done
      ? `经典动态完成：入库 ${imported}，跳过 ${skipped}`
      : `第 ${page}/${totalPages} 页完成（入库 ${imported}）`,
  };

  if (done) {
    await refreshCounts(ANIMATE_SOURCE.id);
  }

  return publicJob(await writeImportJob(JOB_MODE.google, next));
}

async function importJobTick(mode, event = {}) {
  const jobId = jobIdForMode(mode);
  if (!jobId) throw new Error('未知导入类型');
  const job = await readImportJob(jobId);
  if (!job || job.status !== 'running') {
    return publicJob(job);
  }
  if (event._chain && event._token && job.token !== event._token) {
    return publicJob(job);
  }
  // 防并发双跑：同一 token 若刚被别的实例更新过，稍后再说
  const lockAt = Number(job.lockAt) || 0;
  if (lockAt && Date.now() - lockAt < 8000 && !event._force) {
    return publicJob(job);
  }
  await writeImportJob(jobId, { ...job, lockAt: Date.now() });

  try {
    if (mode === 'other') return await runOtherJobTick(job);
    if (mode === 'google') return await runGoogleJobTick(job);
    throw new Error('未知导入类型');
  } catch (e) {
    const failed = await writeImportJob(jobId, {
      ...job,
      lockAt: 0,
      status: 'running',
      message: `本拍出错：${(e && e.message) || e}（将自动重试）`,
    });
    return publicJob(failed);
  }
}

async function importJobStart(mode, openid, opts = {}) {
  const jobId = jobIdForMode(mode);
  if (!jobId) throw new Error('未知导入类型');
  const restart = !!opts.restart;
  const existing = await readImportJob(jobId);

  if (existing && existing.status === 'running' && !restart) {
    // 旧任务 total=0（未带上 catalog）视为坏任务，自动重建
    const brokenOther =
      mode === 'other' && !(Number(existing.total) > 0) && getOtherCatalog().length > 0;
    if (!brokenOther) {
      return publicJob(existing);
    }
  }

  const token = newJobToken();
  let seed;
  if (mode === 'other') {
    const total = getOtherCatalog().length;
    if (!total) {
      throw new Error(
        '云端缺少 otherCatalog.json（目录为 0）。请对 adminUpsertLibrary 使用「上传并部署：云端安装依赖」',
      );
    }
    seed = {
      mode: 'other',
      status: 'running',
      token,
      offset: restart || !existing || existing.status === 'done' ? 0 : Number(existing.offset) || 0,
      total,
      imported: restart || !existing || existing.status === 'done' ? 0 : Number(existing.imported) || 0,
      skipped: restart || !existing || existing.status === 'done' ? 0 : Number(existing.skipped) || 0,
      fail: restart || !existing || existing.status === 'done' ? 0 : Number(existing.fail) || 0,
      mirrorFail:
        restart || !existing || existing.status === 'done' ? 0 : Number(existing.mirrorFail) || 0,
      startedBy: openid,
      startedAt: Date.now(),
      message: `已启动，目录 ${total} 条，可离开页面`,
      lockAt: 0,
    };
  } else {
    seed = {
      mode: 'google',
      status: 'running',
      token,
      page: restart || !existing || existing.status === 'done' ? 1 : Number(existing.page) || 1,
      total: Number((existing && existing.total) || 720),
      includeLottie: false,
      imported: restart || !existing || existing.status === 'done' ? 0 : Number(existing.imported) || 0,
      skipped: restart || !existing || existing.status === 'done' ? 0 : Number(existing.skipped) || 0,
      fail: restart || !existing || existing.status === 'done' ? 0 : Number(existing.fail) || 0,
      mirrorFail:
        restart || !existing || existing.status === 'done' ? 0 : Number(existing.mirrorFail) || 0,
      startedBy: openid,
      startedAt: Date.now(),
      message: '已启动经典动态导入（约 720 条），可离开页面',
      lockAt: 0,
    };
  }

  await writeImportJob(jobId, seed);
  // 立刻回进度；首拍由小程序 pullAndDrive → importJobTick 执行
  return publicJob({ ...seed, _id: jobId, updatedAt: Date.now() });
}

async function importJobCancel(mode) {
  const jobId = jobIdForMode(mode);
  if (!jobId) throw new Error('未知导入类型');
  const job = await readImportJob(jobId);
  if (!job) return null;
  const next = {
    ...job,
    status: 'cancelled',
    token: newJobToken(),
    message: `已停止。进度 ${
      mode === 'other' ? `${job.offset || 0}/${job.total || 0}` : `第 ${job.page || 1} 页`
    }，入库 ${job.imported || 0}，跳过 ${job.skipped || 0}`,
  };
  return publicJob(await writeImportJob(jobId, next));
}

async function importJobStatus() {
  const [other, google] = await Promise.all([
    readImportJob(JOB_MODE.other),
    readImportJob(JOB_MODE.google),
  ]);
  return {
    other: publicJob(other),
    google: publicJob(google),
  };
}

/** 兼容旧前端分页调用 */
async function importOtherCatalogPage(event = {}) {
  const catalog = getOtherCatalog();
  const total = catalog.length;
  const offset = Math.max(0, Math.floor(Number(event.offset) || 0));
  const limit = Math.min(6, Math.max(2, Math.floor(Number(event.limit) || 4)));
  const kindFilter = String(event.kind || '').trim().toLowerCase();
  const rows = catalog
    .filter((row) => !kindFilter || String(row.k || '') === kindFilter)
    .slice(offset, offset + limit);

  if (offset === 0 || event.ensureMeta) {
    await upsertSource(FLUENT_SOURCE);
    await upsertGroups(FLUENT_SOURCE.id, ANIMATE_GROUPS);
    await upsertSource(COMMUNITY_SOURCE);
    await upsertGroups(COMMUNITY_SOURCE.id, ANIMATE_GROUPS);
  }

  const fluentZh = getFluentZhMap();
  const bySource = new Map();
  let mirrorFail = 0;
  let skipped = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const slug = String((row && row.s) || '')
      .trim()
      .toLowerCase();
    const kind = String((row && row.k) || '').trim();
    const srcMeta = sourceMetaForKind(kind);
    if (!slug || !srcMeta) continue;

    // eslint-disable-next-line no-await-in-loop
    const existing = await getExistingItemFiles(srcMeta.id, slug);
    const need = ['gif', 'webp'].filter((fmt) => row[fmt]);
    if (filesComplete(existing, need)) {
      skipped += 1;
      continue;
    }

    const enName = String((row && row.n) || slug).trim();
    const zhName = (kind === 'fluent' && fluentZh[slug]) || enName;
    const groupKey = mapCategory(row.g);
    const files = { ...existing };
    const cloudBase = `library/${srcMeta.id}/${slug}`;

    // eslint-disable-next-line no-restricted-syntax
    for (const fmt of need) {
      if (files[fmt]) continue;
      const u = row[fmt];
      if (!u) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const fileID = await mirrorUrlToCloud(u, `${cloudBase}/${slug}.${fmt}`);
        if (fileID) files[fmt] = fileID;
      } catch (e) {
        mirrorFail += 1;
        console.warn('[importOther] mirror', slug, fmt, e.message || e);
      }
    }

    if (!Object.keys(files).length) {
      mirrorFail += 1;
      continue;
    }

    if (!bySource.has(srcMeta.id)) bySource.set(srcMeta.id, []);
    bySource.get(srcMeta.id).push({
      externalKey: slug,
      name: zhName,
      groupKey,
      tags: Array.from(
        new Set(
          [zhName, enName, kind]
            .map((t) => String(t || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 12),
      previewFileID: files.webp || files.gif || '',
      previewUrl: '',
      files,
      meta: { slug, zhName, enName, kind, mirrored: true },
      sort: offset + idx + 1,
    });
  }

  let imported = 0;
  let fail = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const [sourceId, items] of bySource.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const data = await upsertItems(sourceId, items);
    imported += data.ok || 0;
    fail += data.fail || 0;
  }

  const filteredTotal = kindFilter
    ? catalog.filter((r) => String(r.k || '') === kindFilter).length
    : total;
  const nextOffset = offset + limit;
  const done = nextOffset >= filteredTotal || rows.length === 0;

  if (done || event.refreshCounts) {
    await refreshCounts(FLUENT_SOURCE.id);
    await refreshCounts(COMMUNITY_SOURCE.id);
  }

  return {
    offset,
    limit,
    nextOffset: done ? -1 : nextOffset,
    imported,
    skipped,
    fail: fail + mirrorFail,
    mirrorFail,
    total: filteredTotal,
    done,
    kind: kindFilter || 'all',
  };
}

async function importAnimateApiPage(event = {}) {
  const page = Math.max(1, Math.floor(Number(event.page) || 1));
  const limit = Math.min(10, Math.max(4, Math.floor(Number(event.limit) || 6)));
  const includeLottie = event.includeLottie !== false;

  if (page === 1 || event.ensureMeta) {
    await upsertSource(ANIMATE_SOURCE);
    await upsertGroups(ANIMATE_SOURCE.id, ANIMATE_GROUPS);
  }

  const url = `https://animatemojis.com/api/emojis?page=${page}&limit=${limit}`;
  const json = await httpGetJson(url);
  const rows = Array.isArray(json.emojis) ? json.emojis : [];
  const total = Number(json.total) || 0;
  const totalPages = Number(json.totalPages) || Math.ceil(total / limit) || 1;

  const items = [];
  let mirrorFail = 0;
  let skipped = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const slug = String((row && row.slug) || '')
      .trim()
      .toLowerCase();
    if (!slug) continue;
    const urls = (row && row.download_urls) || {};
    const need = ['gif', 'webp'].concat(includeLottie && urls.lottie ? ['lottie'] : []);
    // eslint-disable-next-line no-await-in-loop
    const existing = await getExistingItemFiles(ANIMATE_SOURCE.id, slug);
    if (filesComplete(existing, need.filter((f) => urls[f]))) {
      skipped += 1;
      continue;
    }

    const enName = String((row && row.name) || slug).trim();
    const zhName = zhNameFromUrls(urls, enName);
    const groupKey = mapCategory(row.category);
    const files = { ...existing };

    // eslint-disable-next-line no-restricted-syntax
    for (const fmt of need) {
      if (files[fmt]) continue;
      const src = urls[fmt];
      if (!src) continue;
      const ext = fmt === 'lottie' ? 'json' : fmt;
      const cloudPath = `library/animatemojis/${slug}/${slug}.${ext}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        const fileID = await mirrorUrlToCloud(src, cloudPath);
        if (fileID) files[fmt] = fileID;
      } catch (e) {
        mirrorFail += 1;
        console.warn('[importAnimate] mirror', slug, fmt, e.message || e);
      }
    }

    if (!Object.keys(files).length) {
      mirrorFail += 1;
      continue;
    }

    items.push({
      externalKey: slug,
      name: zhName,
      groupKey,
      tags: Array.from(
        new Set(
          [zhName, enName]
            .concat(Array.isArray(row.keywords) ? row.keywords : [])
            .map((t) => String(t || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 12),
      previewFileID: files.webp || files.gif || '',
      previewUrl: '',
      files,
      meta: {
        slug,
        zhName,
        enName,
        codepoint: codepointKeyFromUrl(urls.webp || urls.gif || ''),
        author: String((row && row.author) || '').trim(),
        mirrored: true,
      },
      sort: (page - 1) * limit + idx + 1,
    });
  }

  const data = await upsertItems(ANIMATE_SOURCE.id, items);
  const done = page >= totalPages || rows.length === 0;
  let counts = null;
  if (done || event.refreshCounts) {
    counts = await refreshCounts(ANIMATE_SOURCE.id);
  }

  return {
    page,
    limit,
    imported: data.ok || 0,
    skipped,
    fail: (data.fail || 0) + mirrorFail,
    mirrorFail,
    total,
    totalPages,
    done,
    nextPage: done ? 0 : page + 1,
    counts,
    note:
      total <= 720
        ? '公开 API 目前约 720 条（Google Noto）；站点 2000+ 含 Fluent/社区暂未进 API'
        : '',
  };
}

async function refreshCounts(sourceId) {
  const itemsCount = await db
    .collection('lib_items')
    .where({ sourceId, status: 'published' })
    .count();
  const groupsCount = await db
    .collection('lib_groups')
    .where({ sourceId, status: 'published' })
    .count();
  try {
    await db.collection('lib_sources').doc(sourceId).update({
      data: {
        itemCount: itemsCount.total || 0,
        groupCount: groupsCount.total || 0,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    /* ignore */
  }

  const groups = await db
    .collection('lib_groups')
    .where({ sourceId })
    .limit(100)
    .get();
  // eslint-disable-next-line no-restricted-syntax
  for (const g of groups.data || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const c = await db
        .collection('lib_items')
        .where({ sourceId, groupId: g._id, status: 'published' })
        .count();
      // eslint-disable-next-line no-await-in-loop
      await db.collection('lib_groups').doc(g._id).update({
        data: { itemCount: c.total || 0, updatedAt: db.serverDate() },
      });
    } catch (e) {
      /* ignore */
    }
  }
  return {
    itemCount: itemsCount.total || 0,
    groupCount: groupsCount.total || 0,
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = String(event.action || 'upsertItems').trim();
  const sourceId = String(event.sourceId || '').trim();
  const isChain =
    !!event._chain &&
    !!event._token &&
    (action === 'importJobTick' || action === 'importJobStatus');

  if (!OPENID && !isChain) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (OPENID && !assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }
  if (!OPENID && isChain) {
    const mode = String(event.mode || '').trim();
    const job = await readImportJob(jobIdForMode(mode));
    if (!job || job.status !== 'running' || job.token !== event._token) {
      return { ok: false, code: 'FORBIDDEN', message: '无效的后台续跑令牌' };
    }
  }

  try {
    await ensureLibCollections();
    if (action === 'upsertSource') {
      const data = await upsertSource(event.source || event);
      return { ok: true, data };
    }
    if (action === 'upsertGroups') {
      if (!sourceId) return { ok: false, code: 'BAD_PARAM', message: '缺少 sourceId' };
      const list = await upsertGroups(sourceId, event.groups || []);
      return { ok: true, data: { list } };
    }
    if (action === 'upsertItems') {
      if (!sourceId) return { ok: false, code: 'BAD_PARAM', message: '缺少 sourceId' };
      const items = Array.isArray(event.items) ? event.items : [];
      if (items.length > 80) {
        return { ok: false, code: 'TOO_MANY', message: '单次最多 80 条，请分批' };
      }
      const data = await upsertItems(sourceId, items);
      if (event.refreshCounts) {
        data.counts = await refreshCounts(sourceId);
      }
      return { ok: true, data };
    }
    if (action === 'refreshCounts') {
      if (!sourceId) return { ok: false, code: 'BAD_PARAM', message: '缺少 sourceId' };
      const counts = await refreshCounts(sourceId);
      return { ok: true, data: counts };
    }
    if (action === 'importJobStart') {
      const mode = String(event.mode || '').trim();
      const data = await importJobStart(mode, OPENID, {
        restart: !!event.restart,
      });
      return { ok: true, data };
    }
    if (action === 'importJobTick') {
      const mode = String(event.mode || '').trim();
      const data = await importJobTick(mode, event);
      return { ok: true, data };
    }
    if (action === 'importJobStatus') {
      const data = await importJobStatus();
      return { ok: true, data };
    }
    if (action === 'importJobCancel') {
      const mode = String(event.mode || '').trim();
      const data = await importJobCancel(mode);
      return { ok: true, data };
    }
    if (action === 'importAnimateApi') {
      const data = await importAnimateApiPage(event);
      return { ok: true, data };
    }
    if (action === 'importOtherCatalog') {
      const data = await importOtherCatalogPage(event);
      return { ok: true, data };
    }
    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'UPSERT_FAIL', message: e.message || '写入失败' };
  }
};
