/**
 * 全量拉取装扮素材 → 云存储 + avatar_frames + seed 成就绑定
 *
 * 用法：
 *   node scripts/avatar-frames/import-upload.mjs
 *   node scripts/avatar-frames/import-upload.mjs --dry
 *   node scripts/avatar-frames/import-upload.mjs --limit 5
 *   node scripts/avatar-frames/import-upload.mjs --skip-download   # 只用本地 out/
 *   node scripts/avatar-frames/import-upload.mjs --seed-only      # 只按已有框 seed 成就
 *
 * 需要根目录 .env：TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { ACHIEVEMENT_DEFS } = require('./achievements.seed.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(__dirname, 'out');
const PROGRESS_PATH = path.join(OUT_DIR, 'progress.json');
const CATALOG_PATH = path.join(OUT_DIR, 'catalog.json');

const REPO = 'uhidontkno/DiscordAvatarDecorations';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;

const EXT_RANK = { '.gif': 3, '.webp': 2, '.png': 1, '.apng': 2 };

function loadDotEnv() {
  for (const p of [path.join(ROOT, '.env'), path.join(__dirname, '.env.tcb')]) {
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .forEach((line) => {
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

function parseArgs(argv) {
  const out = {
    limit: 0,
    concurrency: 6,
    dry: false,
    skipDownload: false,
    seedOnly: false,
    forceSeed: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--concurrency')
      out.concurrency = Math.max(1, Math.min(12, Number(argv[++i]) || 6));
    else if (a === '--dry') out.dry = true;
    else if (a === '--skip-download') out.skipDownload = true;
    else if (a === '--seed-only') out.seedOnly = true;
    else if (a === '--force-seed') out.forceSeed = true;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function titleFromStem(stem) {
  return String(stem || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
    .slice(0, 40);
}

function makeKey(relPath) {
  const parts = String(relPath || '')
    .replace(/\\/g, '/')
    .split('/');
  const file = parts[parts.length - 1] || '';
  const stem = file.replace(/\.[^.]+$/, '');
  const folder = parts.slice(0, -1).join('_') || 'root';
  return `${folder}_${stem}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

async function httpGetJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'emojiShare-avatar-frames/1.0',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function httpGetBuffer(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'emojiShare-avatar-frames/1.0',
      Accept: '*/*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function httpGetBufferRetry(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await httpGetBuffer(url);
    } catch (e) {
      last = e;
      // eslint-disable-next-line no-await-in-loop
      await sleep(500 * (i + 1) * (i + 1));
    }
  }
  throw last;
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
      '缺少 TCB_SECRET_ID / TCB_SECRET_KEY。请在项目根目录配置 .env',
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

/** 从 GitHub tree 收集媒体，同 stem 优先动图 */
function collectDecorations(treePaths) {
  const byStem = new Map();
  for (const rel of treePaths) {
    const lower = rel.toLowerCase();
    if (!/\.(png|gif|webp|apng)$/i.test(lower)) continue;
    if (!/^(shop|archive|etc)\//i.test(rel)) continue;
    const ext = path.extname(lower);
    const stemPath = rel.slice(0, -ext.length).replace(/\\/g, '/');
    const rank = EXT_RANK[ext] || 0;
    const prev = byStem.get(stemPath);
    if (!prev || rank > prev.rank) {
      byStem.set(stemPath, { rel, ext, rank, stemPath });
    }
  }

  // 同名装饰若在 shop 与 archive 都有，优先 shop
  const byName = new Map();
  for (const item of byStem.values()) {
    const stem = path.basename(item.stemPath);
    const preferShop = /^shop\//i.test(item.rel) ? 2 : 1;
    const prev = byName.get(stem);
    if (
      !prev ||
      preferShop > prev.preferShop ||
      (preferShop === prev.preferShop && item.rank > prev.rank)
    ) {
      byName.set(stem, { ...item, preferShop, stem });
    }
  }

  // 静图配对（同 stem 的 png 作 thumb）
  const pngByStem = new Map();
  for (const rel of treePaths) {
    if (!/\.png$/i.test(rel)) continue;
    if (!/^(shop|archive|etc)\//i.test(rel)) continue;
    const stemPath = rel.replace(/\.png$/i, '').replace(/\\/g, '/');
    const stem = path.basename(stemPath);
    if (!pngByStem.has(stem)) pngByStem.set(stem, rel);
  }

  return Array.from(byName.values())
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((item, index) => ({
      key: makeKey(item.rel),
      title: titleFromStem(item.stem),
      rel: item.rel,
      thumbRel: pngByStem.get(item.stem) || '',
      animated: /\.(gif|webp|apng)$/i.test(item.ext),
      sort: (index + 1) * 10,
    }));
}

async function fetchTreePaths() {
  const data = await httpGetJson(TREE_URL);
  const tree = Array.isArray(data.tree) ? data.tree : [];
  return tree.filter((t) => t && t.type === 'blob' && t.path).map((t) => t.path);
}

async function ensureLocalFile(rel, skipDownload) {
  const local = path.join(OUT_DIR, rel);
  if (fs.existsSync(local) && fs.statSync(local).size > 0) return local;
  if (skipDownload) {
    throw new Error(`本地缺失 ${rel}（可去掉 --skip-download）`);
  }
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const buf = await httpGetBufferRetry(`${RAW_BASE}/${rel}`);
  fs.writeFileSync(local, buf);
  return local;
}

async function upsertFrame(db, doc) {
  const id = doc._id;
  const payload = { ...doc };
  delete payload._id;
  const ref = db.collection('avatar_frames').doc(id);
  try {
    // @cloudbase/node-sdk：直接 set 文档字段，不要套 { data: ... }（那是小程序 API）
    await ref.set(payload);
  } catch (e) {
    try {
      await db.createCollection('avatar_frames');
      await ref.set(payload);
    } catch (err) {
      throw err;
    }
  }
}

function unwrapConfig(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.data && Array.isArray(row.data.defs)) return row.data;
  if (Array.isArray(row.defs)) return row;
  return row;
}

/** 列出已发布头像框 id（where 失败时回退全表扫描） */
async function listPublishedFrameIds(db) {
  const rows = [];
  let skip = 0;
  while (rows.length < 500) {
    let batch = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await db.collection('avatar_frames').skip(skip).limit(100).get();
      batch = res.data || [];
    } catch (e) {
      console.warn('[seed] list frames fail', e.message || e);
      break;
    }
    if (!batch.length) break;
    rows.push(...batch);
    skip += batch.length;
    if (batch.length < 100) break;
  }
  return rows
    .map((f) => {
      // 兼容早期误写成 { data: {...} }
      const row =
        f && f.data && typeof f.data === 'object' && (f.data.fileID || f.data.key)
          ? { ...f.data, _id: f._id }
          : f;
      if (!row) return null;
      if (row.status && row.status !== 'published') return null;
      const id = String(row._id || row.key || '').trim();
      if (!id || !row.fileID) return null;
      return { id, sort: Number(row.sort) || 0 };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.sort - b.sort || String(a.id).localeCompare(String(b.id)),
    )
    .map((x) => x.id);
}

async function seedAchievements(db, frameIds, { force = false } = {}) {
  const ref = db.collection('app_config').doc('achievements');
  let existing = null;
  try {
    const snap = await ref.get();
    existing = unwrapConfig(snap.data || null);
  } catch (_) {
    existing = null;
  }
  if (existing && Array.isArray(existing.defs) && existing.defs.length && !force) {
    // 已有成就但缺 frameId：只补绑，不覆盖文案阈值
    const idSet = new Set(frameIds);
    let filled = 0;
    const defs = existing.defs.map((d, i) => {
      const cur = String((d && d.frameId) || '').trim();
      if (cur && idSet.has(cur)) return d;
      const nextId = frameIds[i] || '';
      if (!nextId) return d;
      filled += 1;
      return { ...d, frameId: nextId };
    });
    if (filled) {
      const payload = { ...existing, defs, updatedAt: Date.now() };
      await ref.set(payload);
      console.log(`[seed] 已有成就，补绑 ${filled} 个空 frameId`);
      return payload;
    }
    console.log('[seed] app_config/achievements 已存在且已绑框，跳过（可用 --force-seed）');
    return existing;
  }
  const defs = ACHIEVEMENT_DEFS.map((def, i) => ({
    ...def,
    frameId: frameIds[i] || '',
    sort: (i + 1) * 10,
  }));
  const payload = {
    defs,
    updatedAt: Date.now(),
  };
  try {
    await ref.set(payload);
  } catch (e) {
    await db.createCollection('app_config');
    await ref.set(payload);
  }
  console.log(`[seed] 写入 ${defs.length} 条成就，已绑框 ${defs.filter((d) => d.frameId).length}`);
  return payload;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const needCloud = !args.dry || args.seedOnly;
  const app = needCloud ? await createCloudApp() : null;
  const db = app ? app.database() : null;

  if (args.seedOnly) {
    const ids = await listPublishedFrameIds(db);
    if (!ids.length) {
      console.warn('[seed] avatar_frames 为空，无法绑定');
      return;
    }
    await seedAchievements(db, ids, { force: args.forceSeed });
    return;
  }

  console.log('[tree] 拉取文件列表…');
  const treePaths = await fetchTreePaths();
  let decorations = collectDecorations(treePaths);
  console.log(`[tree] 去重后装饰 ${decorations.length} 个（原始 blob ${treePaths.length}）`);
  if (args.limit > 0) decorations = decorations.slice(0, args.limit);

  saveJson(CATALOG_PATH, { at: Date.now(), count: decorations.length, items: decorations });
  const progress = loadJson(PROGRESS_PATH, { uploaded: {} });

  const results = await mapPool(decorations, args.concurrency, async (item) => {
    if (progress.uploaded[item.key] && progress.uploaded[item.key].fileID) {
      return { ...item, ...progress.uploaded[item.key], skipped: true };
    }
    const localMain = await ensureLocalFile(item.rel, args.skipDownload);
    let thumbLocal = '';
    if (item.thumbRel && item.thumbRel !== item.rel) {
      try {
        thumbLocal = await ensureLocalFile(item.thumbRel, args.skipDownload);
      } catch (_) {
        thumbLocal = '';
      }
    }

    if (args.dry) {
      return { ...item, dry: true, localMain, thumbLocal };
    }

    const ext = path.extname(item.rel).toLowerCase() || '.png';
    const fileID = await uploadBuffer(
      app,
      fs.readFileSync(localMain),
      `avatar_frames/${item.key}${ext}`,
    );
    let thumbFileID = '';
    if (thumbLocal) {
      thumbFileID = await uploadBuffer(
        app,
        fs.readFileSync(thumbLocal),
        `avatar_frames/${item.key}_thumb.png`,
      );
    } else if (!item.animated) {
      thumbFileID = fileID;
    }

    const doc = {
      _id: item.key,
      key: item.key,
      title: item.title,
      fileID,
      thumbFileID: thumbFileID || fileID,
      animated: !!item.animated,
      status: 'published',
      sort: item.sort,
      sourcePath: item.rel,
      updatedAt: Date.now(),
    };
    await upsertFrame(db, doc);
    progress.uploaded[item.key] = {
      fileID,
      thumbFileID: doc.thumbFileID,
      animated: doc.animated,
    };
    saveJson(PROGRESS_PATH, progress);
    console.log(`[ok] ${item.key}`);
    return doc;
  });

  const ok = results.filter((r) => r && (r.fileID || r.skipped || r.dry));
  console.log(`[done] 处理 ${ok.length}/${decorations.length}`);

  if (!args.dry) {
    // 优先用本轮上传结果；where 查询偶发空（无索引/延迟）时不能写成「已绑框 0」
    let ids = ok
      .map((r) => {
        const id = String((r && (r._id || r.key)) || '').trim();
        if (!id || !(r.fileID || r.skipped)) return null;
        return { id, sort: Number(r.sort) || 0 };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          a.sort - b.sort || String(a.id).localeCompare(String(b.id)),
      )
      .map((x) => x.id);
    if (!ids.length) {
      ids = await listPublishedFrameIds(db);
    }
    if (!ids.length) {
      console.warn('[seed] 未拿到任何 frameId，跳过成就绑定（可稍后 --seed-only）');
    } else {
      await seedAchievements(db, ids, { force: args.forceSeed });
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
