/**
 * 本机高速抓取 + 上传到云开发（绕过小程序一拍一拍）
 *
 * 需要环境变量（可写在项目根 .env）：
 *   TCB_ENV=cloud1-xxxx
 *   TCB_SECRET_ID=AKIDxxxx
 *   TCB_SECRET_KEY=xxxx
 *
 * 用法：
 *   node scripts/library-import/upload-remote.mjs --mode noto
 *   node scripts/library-import/upload-remote.mjs --mode noto --only-3d
 *   node scripts/library-import/upload-remote.mjs --mode other
 *   node scripts/library-import/upload-remote.mjs --mode meme
 *   node scripts/library-import/upload-remote.mjs --mode meme --limit 30 --concurrency 8
 *   node scripts/library-import/upload-remote.mjs --mode meme --category 滑稽
 *   node scripts/library-import/upload-remote.mjs --mode noto --limit 20 --concurrency 10
 *
 * 密钥在腾讯云控制台 → 访问管理 → API 密钥；TCB_ENV 与小程序云开发环境 ID 一致。
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadDotEnv() {
  for (const p of [path.join(ROOT, '.env'), path.join(__dirname, '.env.tcb')]) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    text.split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (!s || s.startsWith('#')) return;
      const i = s.indexOf('=');
      if (i <= 0) return;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    });
  }
}

loadDotEnv();

function parseArgs(argv) {
  const out = {
    mode: 'noto', // noto | other | meme | all
    only3d: false,
    limit: 0,
    concurrency: 8,
    skipExisting: true,
    dry: false,
    category: '',
    fresh: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') out.mode = String(argv[++i] || 'noto');
    else if (a === '--only-3d') out.only3d = true;
    else if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--concurrency')
      out.concurrency = Math.max(1, Math.min(20, Number(argv[++i]) || 8));
    else if (a === '--no-skip') out.skipExisting = false;
    else if (a === '--dry') out.dry = true;
    else if (a === '--category') out.category = String(argv[++i] || '').trim();
    else if (a === '--fresh') out.fresh = true;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpGetBufferFetch(url) {
  if (typeof fetch !== 'function') {
    throw new Error('no fetch');
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl
    ? setTimeout(() => ctrl.abort(), 90000)
    : null;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'emojiShare-library-import/1.0',
        Accept: '*/*',
      },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`下载超时 ${url}`);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function httpGetBufferLegacy(url, redirectLeft = 4) {
  return new Promise((resolve, reject) => {
    const lib = /^http:\/\//i.test(url) ? http : https;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'emojiShare-library-import/1.0',
          Accept: '*/*',
        },
        timeout: 90000,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectLeft > 0
        ) {
          res.resume();
          httpGetBufferLegacy(res.headers.location, redirectLeft - 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
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
      reject(new Error(`下载超时 ${url}`));
    });
  });
}

async function httpGetBuffer(url) {
  if (typeof fetch === 'function') {
    return httpGetBufferFetch(url);
  }
  return httpGetBufferLegacy(url);
}

async function httpGetBufferRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await httpGetBuffer(url);
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      const retryable =
        /HTTP 403|HTTP 429|下载超时|ECONNRESET|ETIMEDOUT|fetch failed|AggregateError|AbortError/i.test(
          msg,
        );
      if (!retryable || i === tries - 1) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(600 * (i + 1) * (i + 1));
    }
  }
  throw lastErr;
}

async function createCloudApp() {
  const env =
    process.env.TCB_ENV ||
    process.env.CLOUDBASE_ENV ||
    'cloud1-d4g0731mc55f853ef';
  const secretId =
    process.env.TCB_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || '';
  const secretKey =
    process.env.TCB_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || '';
  if (!secretId || !secretKey) {
    throw new Error(
      '缺少 TCB_SECRET_ID / TCB_SECRET_KEY。\n' +
        '请在项目根目录创建 .env（已 gitignore）：\n' +
        '  TCB_ENV=cloud1-d4g0731mc55f853ef\n' +
        '  TCB_SECRET_ID=你的SecretId\n' +
        '  TCB_SECRET_KEY=你的SecretKey\n' +
        '密钥：腾讯云控制台 → 访问管理 → API密钥',
    );
  }
  let tcb;
  try {
    tcb = await import('@cloudbase/node-sdk');
  } catch (e) {
    throw new Error('请先：npm i @cloudbase/node-sdk -D');
  }
  return tcb.default.init({ env, secretId, secretKey });
}

async function uploadBuffer(app, buf, cloudPath) {
  const result = await app.uploadFile({
    cloudPath,
    fileContent: buf,
  });
  return result.fileID || result.fileId || '';
}

async function mapPool(items, concurrency, worker) {
  const ret = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      ret[i] = await worker(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: n }, () => run()));
  return ret;
}

const ANIMATE_SOURCE = {
  id: 'animatemojis',
  title: '经典动态表情',
  subtitle: '多格式',
  desc: '圆润笑脸与日常表情，含平面动图与 3D 静态图',
  uiTemplate: 'animated_multiformat',
  formatsDefault: ['gif', 'webp', 'lottie', 'png'],
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

/** 萌芽 meme-api（CC BY-NC-SA 4.0，本源免费） */
const MEME_SOURCE = {
  id: 'meme-api',
  title: '萌芽表情包',
  subtitle: '梗图',
  desc: '经典网络梗图表情 · 素材来自 meme-api · CC BY-NC-SA 4.0',
  uiTemplate: 'animated_multiformat',
  formatsDefault: ['webp', 'gif'],
  sort: 40,
  enabled: true,
  status: 'published',
  costs: { anim: 0, static: 0 },
  meta: {
    license: 'CC BY-NC-SA 4.0',
    attribution: 'meme-api (https://github.com/shumengya/meme-api)',
    homepage: 'https://meme.smyhub.com',
  },
};

const MEME_BASE = 'https://meme.smyhub.com';
const MEME_MANIFEST_URL = `${MEME_BASE}/memes.json`;

const GROUPS = [
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

function loadJson(rel) {
  const p = path.join(ROOT, rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function noto2dUrl(cp, file) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/${file}`;
}

function noto3dUrlCandidates(cp) {
  const raw = String(cp || '').toLowerCase();
  const stripped = raw.replace(/_fe0f/g, '');
  const keys = Array.from(new Set([raw, stripped].filter(Boolean)));
  const urls = [];
  for (const key of keys) {
    urls.push(
      `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/3D/png/512/emoji_u${key}.png`,
    );
    urls.push(
      `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/3D/png/512/emoji_u${key}.png`,
    );
  }
  return urls;
}

async function downloadFirstOk(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await httpGetBufferRetry(url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('无可用下载地址');
}

/** node-sdk 对不存在的 doc 做 update 往往不抛错，必须先 get 再决定 set/update */
function unwrapDoc(snap) {
  let data = snap && snap.data;
  if (Array.isArray(data)) data = data[0] || null;
  if (!data || typeof data !== 'object') return null;
  if (!Object.keys(data).length) return null;
  return data;
}

async function readDoc(db, collection, docId) {
  try {
    const snap = await db.collection(collection).doc(docId).get();
    return unwrapDoc(snap);
  } catch (e) {
    return null;
  }
}

async function upsertDoc(db, collection, docId, data, createExtra = {}) {
  const existing = await readDoc(db, collection, docId);
  const ref = db.collection(collection).doc(docId);
  if (existing) {
    await ref.update(data);
    return 'update';
  }
  await ref.set({
    ...data,
    ...createExtra,
  });
  return 'set';
}

async function ensureSource(db, source, groupCount) {
  const now = Date.now();
  const gc =
    groupCount != null
      ? Number(groupCount) || 0
      : Number(source.groupCount) || GROUPS.length;
  const data = {
    ...source,
    updatedAt: now,
  };
  await upsertDoc(db, 'lib_sources', source.id, data, {
    itemCount: 0,
    groupCount: gc,
    downloadCount: 0,
    createdAt: now,
  });
}

async function ensureGroups(db, sourceId, groups = GROUPS) {
  const now = Date.now();
  const list = Array.isArray(groups) ? groups : GROUPS;
  for (const g of list) {
    const key = String((g && g.key) || '').trim();
    if (!key) continue;
    const gid = `${sourceId}_${key}`;
    const data = {
      sourceId,
      externalKey: key,
      title: String((g && g.title) || key),
      emoji: String((g && g.emoji) || ''),
      sort: Number((g && g.sort) || 0),
      status: 'published',
      updatedAt: now,
    };
    // eslint-disable-next-line no-await-in-loop
    await upsertDoc(db, 'lib_groups', gid, data, {
      itemCount: 0,
      createdAt: now,
    });
  }
}

async function refreshCounts(
  db,
  sourceId,
  groupCount = GROUPS.length,
  itemCountHint,
) {
  let itemCount =
    itemCountHint != null ? Math.max(0, Number(itemCountHint) || 0) : null;
  if (itemCount == null) {
    try {
      const countRes = await Promise.race([
        db
          .collection('lib_items')
          .where({ sourceId, status: 'published' })
          .count(),
        sleep(12000).then(() => {
          throw new Error('count timeout');
        }),
      ]);
      itemCount = countRes.total || 0;
    } catch (e) {
      console.warn(`[refreshCounts] ${sourceId}`, (e && e.message) || e);
      itemCount = 0;
    }
  }
  try {
    await db.collection('lib_sources').doc(sourceId).update({
      itemCount,
      groupCount: Math.max(0, Number(groupCount) || 0),
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn(`[refreshCounts] update ${sourceId}`, (e && e.message) || e);
  }
}

/** 分类 slug：纯 ASCII 保留原文，中文用稳定 md5 短码 */
function memeCategorySlug(categoryId) {
  const id = String(categoryId || '').trim();
  if (!id) return 'unknown';
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(id)) return id.toLowerCase();
  return `m${crypto.createHash('md5').update(id, 'utf8').digest('hex').slice(0, 10)}`;
}

function memeFileStem(file) {
  const name = String(file || '').trim();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name || 'item';
}

function memeFileFmt(file) {
  const lower = String(file || '')
    .trim()
    .toLowerCase();
  if (lower.endsWith('.gif')) return 'gif';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg';
  return '';
}

function memeItemUrl(categoryId, file) {
  return `${MEME_BASE}/meme/${encodeURIComponent(categoryId)}/${file}`;
}

async function loadMemeCatalog(forceRefresh = false) {
  const outDir = path.join(__dirname, 'out');
  const cachePath = path.join(outDir, 'meme-catalog.json');
  if (!forceRefresh && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && Array.isArray(cached.categories) && cached.categories.length) {
        return cached;
      }
    } catch (e) {
      /* fetch fresh */
    }
  }
  // memes.json 较大；优先 fetch（比裸 http.get 更稳）
  let json;
  if (typeof fetch === 'function') {
    const res = await fetch(MEME_MANIFEST_URL, {
      headers: { 'User-Agent': 'emojiShare-library-import/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${MEME_MANIFEST_URL}`);
    json = await res.json();
  } else {
    const buf = await httpGetBufferRetry(MEME_MANIFEST_URL);
    json = JSON.parse(buf.toString('utf8'));
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const normalized = {
    generatedAt: json.generatedAt || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    base: MEME_BASE,
    categories: (json.categories || []).map((c, idx) => {
      const id = String((c && (c.id || c.name)) || '').trim();
      const slug = memeCategorySlug(id);
      return {
        id,
        name: String((c && c.name) || id),
        slug,
        sort: (idx + 1) * 10,
        items: Array.isArray(c && c.items) ? c.items : [],
      };
    }),
  };
  fs.writeFileSync(cachePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

async function runMeme(app, args) {
  const db = app.database();
  const catalog = await loadMemeCatalog(!!args.fresh);
  let categories = catalog.categories || [];
  if (args.category) {
    const want = String(args.category).trim();
    categories = categories.filter(
      (c) => c.id === want || c.name === want || c.slug === want,
    );
    if (!categories.length) {
      throw new Error(`未找到分类 --category ${want}`);
    }
  }

  const groups = categories.map((c) => ({
    key: c.slug,
    title: c.name || c.id,
    // 不写装饰 emoji：🖼 等符号在微信端常显示成方框乱码
    emoji: '',
    sort: c.sort,
  }));

  const rows = [];
  for (const cat of categories) {
    const items = cat.items || [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i] || {};
      const file = String(it.file || '').trim();
      const fmt = memeFileFmt(file);
      if (!file || !fmt) continue;
      const stem = memeFileStem(file);
      rows.push({
        categoryId: cat.id,
        categoryName: cat.name || cat.id,
        groupKey: cat.slug,
        file,
        fmt,
        stem,
        externalKey: `${cat.slug}_${stem}`,
        sort: i + 1,
        url: memeItemUrl(cat.id, file),
      });
    }
  }

  const limited = args.limit > 0 ? rows.slice(0, args.limit) : rows;
  console.log(
    `[meme] cats=${categories.length} items=${limited.length}/${rows.length} concurrency=${args.concurrency}`,
  );

  if (!args.dry) {
    await ensureSource(db, MEME_SOURCE, groups.length);
    await ensureGroups(db, MEME_SOURCE.id, groups);
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;
  let done = 0;

  await mapPool(limited, args.concurrency, async (row) => {
    const docId = `${MEME_SOURCE.id}_${row.externalKey}`;
    try {
      const existing = await readDoc(db, 'lib_items', docId);
      const prevFiles = (existing && existing.files) || {};
      const needUpload = !prevFiles[row.fmt] || !args.skipExisting;
      if (!needUpload) {
        skip += 1;
        return;
      }

      if (args.dry) {
        console.log(`[dry] ${row.categoryId}/${row.file}`);
        return;
      }

      const buf = await httpGetBufferRetry(row.url);
      const cloudPath = `library/${MEME_SOURCE.id}/${row.groupKey}/${row.file}`;
      const fileID = await uploadBuffer(app, buf, cloudPath);
      if (!fileID) {
        fail += 1;
        return;
      }

      const files = { ...prevFiles, [row.fmt]: fileID };
      const name = `${row.categoryName} ${row.stem}`;
      const now = Date.now();
      const data = {
        sourceId: MEME_SOURCE.id,
        groupId: `${MEME_SOURCE.id}_${row.groupKey}`,
        groupKey: row.groupKey,
        externalKey: row.externalKey,
        name,
        tags: [row.categoryName, row.stem, 'meme-api'].filter(Boolean).slice(0, 12),
        previewFileID: files.webp || files.gif || files.png || '',
        previewUrl: '',
        files,
        meta: {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          file: row.file,
          fmt: row.fmt,
          kind: 'meme-api',
          license: 'CC BY-NC-SA 4.0',
          attribution: 'meme-api (https://github.com/shumengya/meme-api)',
          mirrored: true,
        },
        sort: row.sort,
        status: 'published',
        updatedAt: now,
      };
      await upsertDoc(db, 'lib_items', docId, data, {
        downloadCount: 0,
        createdAt: now,
      });
      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(`[fail] ${row.categoryId}/${row.file}`, e.message || e);
    } finally {
      done += 1;
      if (done % 20 === 0 || done === limited.length) {
        console.log(
          `[meme] ${done}/${limited.length} ok=${ok} skip=${skip} fail=${fail}`,
        );
      }
    }
  });

  if (!args.dry) {
    await refreshCounts(db, MEME_SOURCE.id, groups.length, ok + skip);
  }
  console.log(`[meme] done ok=${ok} skip=${skip} fail=${fail}`);
}

async function runNoto(app, args) {
  const db = app.database();
  const catalog = loadJson(
    'cloudfunctions/adminUpsertLibrary/notoOfficialCatalog.json',
  );
  let zh = {};
  try {
    zh = loadJson('cloudfunctions/adminUpsertLibrary/zhEmojiNames.json');
  } catch (e) {
    zh = {};
  }

  const rows = args.limit > 0 ? catalog.slice(0, args.limit) : catalog;
  console.log(
    `[noto] items=${rows.length} concurrency=${args.concurrency} only3d=${args.only3d}`,
  );

  if (!args.dry) {
    await ensureSource(db, ANIMATE_SOURCE);
    await ensureGroups(db, ANIMATE_SOURCE.id);
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;
  let done = 0;

  await mapPool(rows, args.concurrency, async (row) => {
    const cp = String(row.c || '').toLowerCase();
    const docId = `${ANIMATE_SOURCE.id}_${cp}`;
    const enName = String(row.n || cp);
    const zhName = zh[cp] || enName;
    const groupKey = String(row.g || 'smileys');

    try {
      let existing = null;
      try {
        const snap = await db.collection('lib_items').doc(docId).get();
        existing = (snap && snap.data && (snap.data[0] || snap.data)) || null;
        // node-sdk get 返回 { data: [...] } 或 { data: {} }
        if (Array.isArray(existing)) existing = existing[0] || null;
      } catch (e) {
        existing = null;
      }

      const prevFiles = (existing && existing.files) || {};
      const prevMeta = (existing && existing.meta) || {};
      const need = [];
      if (!args.only3d) {
        if (!prevFiles.gif) need.push({ fmt: 'gif', url: noto2dUrl(cp, '512.gif') });
        if (!prevFiles.webp)
          need.push({ fmt: 'webp', url: noto2dUrl(cp, '512.webp') });
        if (!prevFiles.lottie)
          need.push({
            fmt: 'lottie',
            url: noto2dUrl(cp, 'lottie.json'),
          });
      }
      if (!prevFiles.png || !prevMeta.noto3d || !args.skipExisting) {
        need.push({
          fmt: 'png',
          urls: noto3dUrlCandidates(cp),
          threeD: true,
        });
      } else if (args.only3d && prevMeta.noto3d && prevFiles.png) {
        skip += 1;
        done += 1;
        return;
      }

      if (!need.length) {
        skip += 1;
        done += 1;
        return;
      }

      if (args.dry) {
        console.log(`[dry] ${cp} need=${need.map((n) => n.fmt).join(',')}`);
        done += 1;
        return;
      }

      const files = { ...prevFiles };
      let got3d = !!prevMeta.noto3d;
      let softFail = 0;
      for (const spec of need) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const buf = await downloadFirstOk(
            spec.urls || (spec.url ? [spec.url] : []),
          );
          const ext =
            spec.fmt === 'lottie' ? 'json' : spec.threeD ? '3d.png' : spec.fmt;
          const cloudPath = `library/${ANIMATE_SOURCE.id}/${cp}/${cp}.${ext}`;
          // eslint-disable-next-line no-await-in-loop
          const fileID = await uploadBuffer(app, buf, cloudPath);
          if (fileID) {
            files[spec.fmt] = fileID;
            if (spec.threeD) got3d = true;
          } else {
            softFail += 1;
          }
        } catch (e) {
          softFail += 1;
          console.warn(`[miss] ${cp}.${spec.fmt}`, e.message || e);
        }
      }

      if (!Object.keys(files).length) {
        fail += 1;
        done += 1;
        return;
      }
      if (softFail) {
        // 部分格式缺失仍入库，后续可再补
      }

      const now = Date.now();
      const data = {
        sourceId: ANIMATE_SOURCE.id,
        groupId: `${ANIMATE_SOURCE.id}_${groupKey}`,
        groupKey,
        externalKey: cp,
        name: zhName,
        tags: [zhName, enName, cp].filter(Boolean).slice(0, 12),
        previewFileID: files.webp || files.gif || files.png || '',
        previewUrl: '',
        files,
        meta: {
          slug: enName,
          zhName,
          enName,
          codepoint: cp,
          kind: 'noto-official',
          has3d: !!files.png,
          noto3d: got3d,
          mirrored: true,
        },
        sort: Number(row.i) || 0,
        status: 'published',
        updatedAt: now,
      };

      await upsertDoc(db, 'lib_items', docId, data, {
        downloadCount: 0,
        createdAt: now,
      });

      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(`[fail] ${cp}`, e.message || e);
    } finally {
      done += 1;
      if (done % 20 === 0 || done === rows.length) {
        console.log(
          `[noto] ${done}/${rows.length} ok=${ok} skip=${skip} fail=${fail}`,
        );
      }
    }
  });

  if (!args.dry) {
    await refreshCounts(db, ANIMATE_SOURCE.id);
  }
  console.log(`[noto] done ok=${ok} skip=${skip} fail=${fail}`);
}

async function runOther(app, args) {
  const db = app.database();
  const catalog = loadJson(
    'cloudfunctions/adminUpsertLibrary/otherCatalog.json',
  );
  let fluentZh = {};
  try {
    fluentZh = loadJson(
      'cloudfunctions/adminUpsertLibrary/fluentZhNames.json',
    );
  } catch (e) {
    fluentZh = {};
  }

  const rows = args.limit > 0 ? catalog.slice(0, args.limit) : catalog;
  console.log(`[other] items=${rows.length} concurrency=${args.concurrency}`);

  if (!args.dry) {
    await ensureSource(db, FLUENT_SOURCE);
    await ensureSource(db, COMMUNITY_SOURCE);
    await ensureGroups(db, FLUENT_SOURCE.id);
    await ensureGroups(db, COMMUNITY_SOURCE.id);
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;
  let done = 0;

  await mapPool(rows, args.concurrency, async (row, idx) => {
    const slug = String(row.s || '').toLowerCase();
    const kind = String(row.k || '');
    const source = kind === 'fluent' ? FLUENT_SOURCE : COMMUNITY_SOURCE;
    if (!slug || !source) {
      skip += 1;
      done += 1;
      return;
    }
    const docId = `${source.id}_${slug}`;
    const enName = String(row.n || slug);
    const zhName =
      (kind === 'fluent' && fluentZh[slug]) || enName;
    const groupKey = String(row.g || 'smileys');

    try {
      let existing = null;
      try {
        const snap = await db.collection('lib_items').doc(docId).get();
        existing = (snap && snap.data && (snap.data[0] || snap.data)) || null;
        if (Array.isArray(existing)) existing = existing[0] || null;
      } catch (e) {
        existing = null;
      }
      const prevFiles = (existing && existing.files) || {};
      const need = [];
      // 社区 hashed webp 大量失效；只强制 gif。Fluent 仍拉双格式
      if (row.gif && !prevFiles.gif) need.push({ fmt: 'gif', url: row.gif });
      if (kind === 'fluent' && row.webp && !prevFiles.webp) {
        need.push({ fmt: 'webp', url: row.webp });
      }
      if (!need.length && args.skipExisting) {
        skip += 1;
        done += 1;
        return;
      }

      if (args.dry) {
        done += 1;
        return;
      }

      const files = { ...prevFiles };
      for (const spec of need) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const buf = await httpGetBufferRetry(spec.url);
          const cloudPath = `library/${source.id}/${slug}/${slug}.${spec.fmt}`;
          // eslint-disable-next-line no-await-in-loop
          const fileID = await uploadBuffer(app, buf, cloudPath);
          if (fileID) files[spec.fmt] = fileID;
        } catch (e) {
          console.warn(`[miss] ${slug}.${spec.fmt}`, e.message || e);
        }
      }

      if (!Object.keys(files).length) {
        fail += 1;
        done += 1;
        return;
      }

      const now = Date.now();
      const data = {
        sourceId: source.id,
        groupId: `${source.id}_${groupKey}`,
        groupKey,
        externalKey: slug,
        name: zhName,
        tags: [zhName, enName, kind].filter(Boolean).slice(0, 12),
        previewFileID: files.webp || files.gif || '',
        previewUrl: '',
        files,
        meta: {
          slug,
          zhName,
          enName,
          kind,
          mirrored: true,
        },
        sort: idx + 1,
        status: 'published',
        updatedAt: now,
      };
      await upsertDoc(db, 'lib_items', docId, data, {
        downloadCount: 0,
        createdAt: now,
      });
      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(`[fail] ${slug}`, e.message || e);
    } finally {
      done += 1;
      if (done % 20 === 0 || done === rows.length) {
        console.log(
          `[other] ${done}/${rows.length} ok=${ok} skip=${skip} fail=${fail}`,
        );
      }
    }
  });

  if (!args.dry) {
    await refreshCounts(db, FLUENT_SOURCE.id);
    await refreshCounts(db, COMMUNITY_SOURCE.id);
  }
  console.log(`[other] done ok=${ok} skip=${skip} fail=${fail}`);
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('[upload-remote]', args);

  if (args.dry) {
    console.log('[dry] 不连云，只演练逻辑');
  }

  const app = args.dry
    ? null
    : await createCloudApp();

  if (args.mode === 'noto') {
    await runNoto(app || { database: () => null }, args);
  } else if (args.mode === 'other') {
    await runOther(app || { database: () => null }, args);
  } else if (args.mode === 'meme') {
    await runMeme(app || { database: () => null }, args);
  } else if (args.mode === 'all') {
    await runNoto(app, args);
    await runOther(app, args);
    await runMeme(app, args);
  } else {
    throw new Error(`未知 --mode ${args.mode}（noto|other|meme|all）`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\n[upload-remote] 失败：', e.message || e);
  process.exit(1);
});
