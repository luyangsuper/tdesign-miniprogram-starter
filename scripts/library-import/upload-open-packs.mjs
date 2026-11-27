/**
 * 开源表情包导入：sticker-ext 全量 + AstrBot 广场选定包
 *
 * 用法：
 *   node scripts/library-import/upload-open-packs.mjs --mode selected
 *   node scripts/library-import/upload-open-packs.mjs --mode sticker-ext
 *   node scripts/library-import/upload-open-packs.mjs --mode astrbot --pack seio-stickers
 *   node scripts/library-import/upload-open-packs.mjs --mode selected --limit 20 --concurrency 6
 *
 * 需要 .env：TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out');
const CACHE = path.join(OUT, 'open-packs');

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

loadDotEnv();

/** 用户选定：A2 + B2–B16（排除官方1号 / ChineseBQB） */
const SELECTED_ASTRBOT_IDS = [
  'seio-stickers',
  'atri-meme-pack',
  'congyu-meme-pack',
  'juxueli-meme-pack',
  'laffey2-meme-pack',
  'clover-days-meme-pack',
  'blue-fat-fish-meme-pack',
  'deepseek-fanart-meme-pack',
  'ddzs987-semantic-001',
  'yctf-taffy',
  'kipfel',
  'emilia-chibi-meme-pack',
  'steins-gate-0',
  'marisa-meme-pack',
  'izumi-hiyori-meme-pack',
];

/** 分类短名：只用于标签，绝不用长描述 */
const CAT_ZH = {
  work: '工作',
  angry: '生气',
  confused: '疑惑',
  happy: '开心',
  sad: '难过',
  shy: '害羞',
  surprised: '惊讶',
  sleep: '睡觉',
  like: '喜欢',
  food: '吃喝',
  money: '金钱',
  greeting: '打招呼',
  entertainment: '娱乐',
  comfort: '安慰',
  mischief: '调皮',
  apology: '道歉',
  approval: '认可',
  attack: '吐槽',
  interaction: '互动',
  question: '疑问',
  reply: '回复',
  sigh: '无奈',
  see: '偷瞄',
  morning: '早安',
  meow: '卖萌',
  fool: '自嘲',
  baka: '笨蛋',
  color: '暧昧',
  cpu: '加载中',
  givemoney: '要钱',
  wave: '挥手',
  bye: '再见',
  love: '爱心',
  cry: '哭泣',
  laugh: '大笑',
  think: '思考',
  ok: 'OK',
  no: '拒绝',
  yes: '同意',
  dance: '跳舞',
  sing: '唱歌',
  game: '游戏',
  drink: '喝东西',
  eat: '吃饭',
  tired: '疲惫',
  cool: '酷',
  cute: '可爱',
  panic: '慌张',
  smug: '得意',
  speechless: '无语',
  action: '动作',
  teasing: '调侃',
  busy: '忙碌',
  run: '奔跑',
  fight: '战斗',
  weapon: '武器',
  escape: '逃跑',
  wait: '等待',
  loading: '加载',
  praise: '夸奖',
  thanks: '感谢',
  goodbye: '再见',
  hello: '你好',
  yesno: '是否',
  other: '其他',
  affection: '亲昵',
  eating: '吃东西',
  refusal: '拒绝',
  surrender: '认输',
  thinking: '思考',
  celebrate: '庆祝',

  gif: '动图 GIF',
  png: 'PNG',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  webp: 'WebP',
};

function parseArgs(argv) {
  const out = {
    mode: 'selected', // selected | sticker-ext | astrbot
    pack: '',
    limit: 0,
    concurrency: 6,
    skipExisting: true,
    dry: false,
    fresh: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') out.mode = String(argv[++i] || 'selected');
    else if (a === '--pack') out.pack = String(argv[++i] || '').trim();
    else if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--concurrency')
      out.concurrency = Math.max(1, Math.min(16, Number(argv[++i]) || 6));
    else if (a === '--no-skip') out.skipExisting = false;
    else if (a === '--dry') out.dry = true;
    else if (a === '--fresh') out.fresh = true;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function fileFmt(name) {
  const ext = path.extname(String(name || '')).toLowerCase().replace(/^\./, '');
  if (ext === 'jpeg') return 'jpg';
  if (['gif', 'webp', 'png', 'jpg', 'svg'].includes(ext)) return ext;
  return '';
}

function catTitle(key) {
  const k = String(key || '').trim();
  if (!k) return '未分类';
  if (CAT_ZH[k]) return CAT_ZH[k];
  const lower = k.toLowerCase();
  if (CAT_ZH[lower]) return CAT_ZH[lower];
  // 已是短中文
  if (/^[\u4e00-\u9fffA-Za-z0-9]{1,8}$/.test(k)) return k;
  // 英文 key 直接短展示，绝不吞长描述
  if (/^[a-z][a-z0-9_-]{0,20}$/i.test(k)) return k;
  return k.slice(0, 8);
}

async function httpGetBufferFetch(url, timeoutMs = 120000) {
  if (typeof fetch !== 'function') throw new Error('no fetch');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'emojiShare-library-import/1.0',
        Accept: '*/*',
      },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
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
        timeout: 120000,
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
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
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
  if (typeof fetch === 'function') return httpGetBufferFetch(url);
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
    throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（写在项目根 .env）');
  }
  const tcb = await import('@cloudbase/node-sdk');
  return tcb.default.init({ env, secretId, secretKey });
}

async function uploadBuffer(app, buf, cloudPath) {
  const result = await app.uploadFile({ cloudPath, fileContent: buf });
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
  await ref.set({ ...data, ...createExtra });
  return 'set';
}

async function ensureSource(db, source, groupCount) {
  const now = Date.now();
  await upsertDoc(
    db,
    'lib_sources',
    source.id,
    { ...source, updatedAt: now },
    {
      itemCount: 0,
      groupCount: Number(groupCount) || 0,
      downloadCount: 0,
      createdAt: now,
    },
  );
}

async function ensureGroups(db, sourceId, groups) {
  const now = Date.now();
  for (const g of groups) {
    const key = String((g && g.key) || '').trim();
    if (!key) continue;
    // eslint-disable-next-line no-await-in-loop
    await upsertDoc(
      db,
      'lib_groups',
      `${sourceId}_${key}`,
      {
        sourceId,
        externalKey: key,
        title: String((g && g.title) || key),
        emoji: '',
        sort: Number((g && g.sort) || 0),
        status: 'published',
        updatedAt: now,
      },
      { itemCount: 0, createdAt: now },
    );
  }
}

async function refreshCounts(db, sourceId, groupCount, itemCountHint) {
  try {
    let itemCount = Number(itemCountHint);
    if (!Number.isFinite(itemCount) || itemCount < 0) {
      const c = await db
        .collection('lib_items')
        .where({ sourceId, status: 'published' })
        .count();
      itemCount = c.total;
    }
    await db.collection('lib_sources').doc(sourceId).update({
      itemCount,
      groupCount: Math.max(0, Number(groupCount) || 0),
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn(`[refreshCounts] ${sourceId}`, (e && e.message) || e);
  }
}

async function loadAstrbotIndex(force = false) {
  ensureDir(OUT);
  const cachePath = path.join(OUT, 'astrbot-community-index.json');
  if (!force && fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
      /* fetch */
    }
  }
  const buf = await httpGetBufferRetry(
    'https://raw.githubusercontent.com/anka-afk/astrbot-meme-pack-index/main/community-index.json',
  );
  fs.writeFileSync(cachePath, buf);
  return JSON.parse(buf.toString('utf8'));
}

function zipUrls(repo, ref) {
  const r = String(ref || 'main').trim();
  const urls = [];
  const push = (u) => {
    if (u && !urls.includes(u)) urls.push(u);
  };
  // codeload + github archive 双通道
  push(`https://codeload.github.com/${repo}/zip/refs/tags/${r}`);
  push(`https://codeload.github.com/${repo}/zip/refs/heads/${r}`);
  push(`https://github.com/${repo}/archive/refs/tags/${r}.zip`);
  push(`https://github.com/${repo}/archive/refs/heads/${r}.zip`);
  push(`https://codeload.github.com/${repo}/zip/${r}`);
  return urls;
}

function curlDownload(url, destZip) {
  const tmp = `${destZip}.part`;
  fs.rmSync(tmp, { force: true });
  const r = spawnSync(
    'curl.exe',
    [
      '-L',
      '--fail',
      '--retry',
      '4',
      '--retry-delay',
      '2',
      '--connect-timeout',
      '30',
      '--max-time',
      '900',
      '-A',
      'emojiShare-library-import/1.0',
      '-o',
      tmp,
      url,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`curl exit ${r.status}: ${(r.stderr || '').slice(0, 160)}`);
  }
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) {
    fs.rmSync(tmp, { force: true });
    throw new Error('zip too small');
  }
  const fd = fs.openSync(tmp, 'r');
  const magic = Buffer.alloc(2);
  fs.readSync(fd, magic, 0, 2, 0);
  fs.closeSync(fd);
  if (magic.toString() !== 'PK') {
    fs.rmSync(tmp, { force: true });
    throw new Error('不是 zip（可能是 HTML 错误页）');
  }
  fs.renameSync(tmp, destZip);
  return destZip;
}

async function downloadZipTo(repo, ref, destZip) {
  ensureDir(path.dirname(destZip));
  if (fs.existsSync(destZip) && fs.statSync(destZip).size > 1000) {
    console.log(`[zip] reuse ${destZip}`);
    return destZip;
  }
  let lastErr;
  for (const url of zipUrls(repo, ref)) {
    try {
      console.log(`[zip] GET ${url}`);
      // 大包用 curl 落盘，避免整包进内存 / fetch 超时
      curlDownload(url, destZip);
      const size = fs.statSync(destZip).size;
      console.log(`[zip] saved ${(size / 1048576).toFixed(1)}MB → ${destZip}`);
      return destZip;
    } catch (e) {
      lastErr = e;
      console.warn(`[zip] miss ${url}`, e.message || e);
      fs.rmSync(destZip, { force: true });
      fs.rmSync(`${destZip}.part`, { force: true });
    }
  }
  throw lastErr || new Error(`无法下载 ${repo}@${ref}`);
}

/** zip 失败时浅克隆仓库 */
function gitClonePack(repo, ref, destDir) {
  ensureDir(path.dirname(destDir));
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  console.log(`[git] clone ${repo}@${ref} → ${destDir}`);
  const r = spawnSync(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      String(ref || 'main'),
      `https://github.com/${repo}.git`,
      destDir,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    // 某些 tag 需要先 clone 再 checkout
    const r2 = spawnSync(
      'git',
      ['clone', '--depth', '1', `https://github.com/${repo}.git`, destDir],
      { encoding: 'utf8' },
    );
    if (r2.status !== 0) {
      throw new Error(
        `git clone 失败: ${(r.stderr || r2.stderr || '').slice(0, 300)}`,
      );
    }
  }
  return destDir;
}

function extractZip(zipPath, destDir) {
  ensureDir(destDir);
  const marker = path.join(destDir, '.extracted');
  if (fs.existsSync(marker)) return destDir;
  const mb = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  console.log(`[unzip] start ${path.basename(zipPath)} (${mb}MB) → ${destDir}`);
  // 清空残留
  if (fs.existsSync(destDir)) {
    for (const name of fs.readdirSync(destDir)) {
      fs.rmSync(path.join(destDir, name), { recursive: true, force: true });
    }
  }
  ensureDir(destDir);
  const started = Date.now();
  // Windows tar 对超大 zip 可能很慢；stdio inherit 方便看是否卡死
  const r = spawnSync('tar.exe', ['-xf', zipPath, '-C', destDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.status !== 0) {
    const r2 = spawnSync('tar', ['-xf', zipPath, '-C', destDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (r2.status !== 0) {
      throw new Error(
        `解压失败: status=${r.status}/${r2.status}`,
      );
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[unzip] done ${secs}s`);
  fs.writeFileSync(marker, String(Date.now()));
  return destDir;
}

function findPackRoot(extractDir, subpath = '.') {
  const entries = fs.readdirSync(extractDir).filter((n) => n !== '.extracted');
  let base = extractDir;
  if (entries.length === 1) {
    const only = path.join(extractDir, entries[0]);
    if (fs.statSync(only).isDirectory()) base = only;
  }
  const sp = String(subpath || '.').replace(/^\.\//, '');
  const root = sp && sp !== '.' ? path.join(base, sp) : base;
  if (!fs.existsSync(root)) throw new Error(`pack root 不存在: ${root}`);
  return root;
}

function walkMemes(packRoot) {
  const memesDir = path.join(packRoot, 'memes');
  if (!fs.existsSync(memesDir)) {
    throw new Error(`缺少 memes/：${packRoot}`);
  }
  const rows = [];
  const cats = fs.readdirSync(memesDir).filter((n) => {
    try {
      return fs.statSync(path.join(memesDir, n)).isDirectory();
    } catch (e) {
      return false;
    }
  });
  cats.sort();
  cats.forEach((cat, ci) => {
    const dir = path.join(memesDir, cat);
    const files = fs
      .readdirSync(dir)
      .filter((f) => !!fileFmt(f))
      .sort();
    files.forEach((file, fi) => {
      const abs = path.join(dir, file);
      const fmt = fileFmt(file);
      const stem = path.basename(file, path.extname(file));
      rows.push({
        categoryKey: slugify(cat) || `cat${ci}`,
        categoryRaw: cat,
        file,
        stem,
        fmt,
        abs,
        sort: ci * 10000 + fi + 1,
      });
    });
  });
  return rows;
}

function readLocalManifest(packRoot) {
  const p = path.join(packRoot, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function uploadRows(app, args, source, groups, rows) {
  const db = app.database();
  const limited = args.limit > 0 ? rows.slice(0, args.limit) : rows;
  console.log(
    `[${source.id}] items=${limited.length}/${rows.length} groups=${groups.length} concurrency=${args.concurrency}`,
  );

  if (!args.dry) {
    await ensureSource(db, source, groups.length);
    await ensureGroups(db, source.id, groups);
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;
  let done = 0;

  await mapPool(limited, args.concurrency, async (row) => {
    const externalKey = `${row.categoryKey}_${row.stem}`.slice(0, 96);
    const docId = `${source.id}_${externalKey}`.replace(/[^\w.-]/g, '_').slice(0, 120);
    try {
      const existing = args.dry ? null : await readDoc(db, 'lib_items', docId);
      const prevFiles = (existing && existing.files) || {};
      const needUpload = !prevFiles[row.fmt] || !args.skipExisting;
      if (!needUpload) {
        skip += 1;
        return;
      }
      if (args.dry) {
        console.log(`[dry] ${source.id}/${row.categoryRaw}/${row.file}`);
        return;
      }
      const buf = fs.readFileSync(row.abs);
      const cloudPath = `library/${source.id}/${row.categoryKey}/${row.file}`;
      const fileID = await uploadBuffer(app, buf, cloudPath);
      if (!fileID) {
        fail += 1;
        return;
      }
      const files = { ...prevFiles, [row.fmt]: fileID };
      const titleBase =
        row.caption ||
        `${catTitle(row.categoryRaw)} ${row.stem}`.trim();
      const now = Date.now();
      await upsertDoc(
        db,
        'lib_items',
        docId,
        {
          sourceId: source.id,
          groupId: `${source.id}_${row.categoryKey}`,
          groupKey: row.categoryKey,
          externalKey,
          name: String(titleBase).slice(0, 80),
          tags: [row.categoryRaw, row.stem, source.id]
            .filter(Boolean)
            .slice(0, 12),
          previewFileID: files.gif || files.webp || files.png || files.jpg || '',
          previewUrl: '',
          files,
          meta: {
            category: row.categoryRaw,
            file: row.file,
            fmt: row.fmt,
            caption: row.caption || '',
            kind: source.meta && source.meta.kind,
            license: source.meta && source.meta.license,
            attribution: source.meta && source.meta.attribution,
            mirrored: true,
          },
          sort: row.sort,
          status: 'published',
          updatedAt: now,
        },
        { downloadCount: 0, createdAt: now },
      );
      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(
        `[fail] ${source.id}/${row.categoryRaw}/${row.file}`,
        e.message || e,
      );
    } finally {
      done += 1;
      if (done % 20 === 0 || done === limited.length) {
        console.log(
          `[${source.id}] ${done}/${limited.length} ok=${ok} skip=${skip} fail=${fail}`,
        );
      }
    }
  });

  if (!args.dry) {
    await refreshCounts(db, source.id, groups.length, ok + skip);
  }
  console.log(`[${source.id}] done ok=${ok} skip=${skip} fail=${fail}`);
  return { ok, skip, fail };
}

async function runAstrbotPack(app, args, packMeta, sortBase) {
  const id = packMeta.id;
  const src = packMeta.source || {};
  const repo = src.repo;
  const ref = src.ref || 'main';
  const subpath = src.subpath || '.';
  if (!repo) throw new Error(`pack ${id} 缺少 source.repo`);

  ensureDir(CACHE);
  const safe = id.replace(/[^\w.-]+/g, '_');
  const zipPath = path.join(CACHE, `${safe}.zip`);
  const extractDir = path.join(CACHE, `${safe}-extract`);

  if (args.fresh) {
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  let packRoot;
  try {
    await downloadZipTo(repo, ref, zipPath);
    extractZip(zipPath, extractDir);
    packRoot = findPackRoot(extractDir, subpath);
  } catch (e) {
    console.warn(`[pack] zip 失败，改 git clone：`, e.message || e);
    const cloneDir = path.join(CACHE, `${safe}-clone`);
    if (args.fresh) fs.rmSync(cloneDir, { recursive: true, force: true });
    if (!fs.existsSync(path.join(cloneDir, 'memes')) && !fs.existsSync(path.join(cloneDir, 'manifest.json'))) {
      gitClonePack(repo, ref, cloneDir);
    }
    packRoot = findPackRoot(cloneDir, subpath);
  }
  const localManifest = readLocalManifest(packRoot) || {};
  const rows = walkMemes(packRoot);
  if (!rows.length) throw new Error(`${id} 无可用图片`);

  const catKeys = [...new Set(rows.map((r) => r.categoryKey))];
  const groups = catKeys.map((key, i) => {
    const raw = rows.find((r) => r.categoryKey === key)?.categoryRaw || key;
    return {
      key,
      title: catTitle(raw),
      sort: (i + 1) * 10,
    };
  });

  const fmts = [...new Set(rows.map((r) => r.fmt))];
  const source = {
    id: `astrbot-${id}`.slice(0, 64),
    title: String(packMeta.name || localManifest.name || id).slice(0, 40),
    subtitle: '表情包',
    desc: String(
      packMeta.description || localManifest.description || '',
    ).slice(0, 120),
    uiTemplate: 'animated_multiformat',
    formatsDefault: fmts.includes('gif')
      ? ['gif', ...fmts.filter((f) => f !== 'gif')].slice(0, 4)
      : fmts.slice(0, 4),
    sort: sortBase,
    enabled: true,
    status: 'published',
    costs: { anim: 0, static: 0 },
    meta: {
      kind: 'astrbot-pack',
      packId: id,
      license: packMeta.license || localManifest.license || '',
      attribution: `${packMeta.maintainer || ''} · ${repo}`,
      homepage: `https://github.com/${repo}`,
      ref,
    },
  };

  // 统一 groupKey 已在 rows 里；groupId 用 source.id
  return uploadRows(app, args, source, groups, rows);
}

async function ensureStickerExtLocal(force = false) {
  const dir = path.join(OUT, 'sticker-ext');
  if (!force && fs.existsSync(path.join(dir, 'manifest.json'))) {
    console.log(`[sticker-ext] reuse ${dir}`);
    return dir;
  }
  // 也识别已解压的 archive 目录
  const archiveDir = path.join(OUT, 'sticker-ext-main');
  if (!force && fs.existsSync(path.join(archiveDir, 'manifest.json'))) {
    console.log(`[sticker-ext] reuse ${archiveDir}`);
    return archiveDir;
  }
  ensureDir(OUT);

  const zipPath = path.join(OUT, 'sticker-ext-main.zip');
  const extractDir = path.join(OUT, 'sticker-ext-extract');

  // 优先用已下好的 zip（git clone 大仓易断）
  if (force || !fs.existsSync(zipPath) || fs.statSync(zipPath).size < 1000000) {
    console.log('[sticker-ext] curl zip …');
    curlDownload(
      'https://github.com/9Ashwin/sticker-ext/archive/refs/heads/main.zip',
      zipPath,
    );
  } else {
    console.log(`[sticker-ext] reuse zip ${(fs.statSync(zipPath).size / 1048576).toFixed(0)}MB`);
  }

  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  extractZip(zipPath, extractDir);
  const root = findPackRoot(extractDir, '.');
  if (!fs.existsSync(path.join(root, 'manifest.json'))) {
    throw new Error('sticker-ext 解压后缺少 manifest.json');
  }
  return root;
}

async function runStickerExt(app, args) {
  const dir = await ensureStickerExtLocal(!!args.fresh);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  );
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const rows = [];
  items.forEach((it, i) => {
    const rel = String(it.filename || '').replace(/\\/g, '/');
    if (!rel) return;
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return;
    let fmt = String(it.format || fileFmt(rel) || '').toLowerCase();
    if (fmt === 'jpeg') fmt = 'jpg';
    if (!fmt) return;
    const md5 = String(it.md5 || path.basename(rel, path.extname(rel)));
    rows.push({
      categoryKey: fmt,
      categoryRaw: fmt,
      file: path.basename(rel),
      stem: md5.slice(0, 16),
      fmt,
      abs,
      caption: String(it.caption || '').slice(0, 60),
      sort: i + 1,
    });
  });

  const fmtOrder = ['gif', 'png', 'jpg', 'webp'];
  const present = fmtOrder.filter((f) => rows.some((r) => r.fmt === f));
  const groups = present.map((f, i) => ({
    key: f,
    title: catTitle(f),
    sort: (i + 1) * 10,
  }));

  const source = {
    id: 'sticker-ext',
    title: '精选聊天表情',
    subtitle: '全量',
    desc: '2588 张带描述的聊天表情 · sticker-ext · 本地原图合集',
    uiTemplate: 'animated_multiformat',
    formatsDefault: present,
    sort: 50,
    enabled: true,
    status: 'published',
    costs: { anim: 0, static: 0 },
    meta: {
      kind: 'sticker-ext',
      license: '原作者版权；仓库整理不授予商业再分发权',
      attribution: '9Ashwin/sticker-ext',
      homepage: 'https://github.com/9Ashwin/sticker-ext',
    },
  };

  return uploadRows(app, args, source, groups, rows);
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('[upload-open-packs]', args);
  ensureDir(OUT);
  ensureDir(CACHE);

  const app = args.dry ? { database: () => null } : await createCloudApp();

  if (args.mode === 'sticker-ext') {
    await runStickerExt(app, args);
    return;
  }

  if (args.mode === 'astrbot') {
    const index = await loadAstrbotIndex(!!args.fresh);
    const packs = index.packs || [];
    const id = args.pack;
    if (!id) throw new Error('astrbot 模式需要 --pack <id>');
    const meta = packs.find((p) => p.id === id);
    if (!meta) throw new Error(`索引中无包 ${id}`);
    await runAstrbotPack(app, args, meta, 60);
    return;
  }

  if (args.mode === 'selected') {
    // 先 AstrBot（zip 小），再 sticker-ext（约 1GB clone）
    const index = await loadAstrbotIndex(!!args.fresh);
    const byId = new Map((index.packs || []).map((p) => [p.id, p]));
    let sortBase = 60;
    const packResults = [];
    for (const id of SELECTED_ASTRBOT_IDS) {
      const meta = byId.get(id);
      if (!meta) {
        console.warn(`[skip] 索引无 ${id}`);
        packResults.push({ id, ok: false, err: 'missing' });
        continue;
      }
      sortBase += 5;
      console.log(`\n==== AstrBot ${meta.name} (${id}) ====`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await runAstrbotPack(app, args, meta, sortBase);
        packResults.push({ id, ...r });
      } catch (e) {
        console.error(`[pack-fail] ${id}`, e.message || e);
        packResults.push({ id, ok: 0, skip: 0, fail: 0, err: String(e.message || e) });
      }
    }
    console.log('\n==== sticker-ext 全量 ====');
    try {
      await runStickerExt(app, args);
    } catch (e) {
      console.error('[sticker-ext-fail]', e.message || e);
    }
    console.log('[selected] summary', packResults);
    return;
  }

  throw new Error(`未知 --mode ${args.mode}（selected|sticker-ext|astrbot）`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n[upload-open-packs] 失败：', e.message || e);
    process.exit(1);
  });
