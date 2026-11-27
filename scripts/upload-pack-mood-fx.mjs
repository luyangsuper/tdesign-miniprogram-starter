/**
 * 从 ParticleFX 效果页免费下载 GIF，上传到云存储，写出 fileID 清单。
 *
 * 用法：
 *   node scripts/upload-pack-mood-fx.mjs
 *   node scripts/upload-pack-mood-fx.mjs --skip-download   # 只用本地已下好的 gif
 *   node scripts/upload-pack-mood-fx.mjs --skip-upload     # 只下载不上传
 *
 * 需要：.env 里 TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY
 * 依赖：npx playwright（首次会装 chromium）
 *
 * @see https://particlefx.studio/effects
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'scripts', 'library-import', 'out', 'pack-mood');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const CLIENT_ASSETS_PATH = path.join(ROOT, 'utils', 'packMoodAssets.js');

/**
 * moodId → ParticleFX 效果页 slug（公开页 DOWNLOAD GIF 免登录）
 * bg: 素材原生底色倾向 —— dark 适合黑底（卡片上用 screen 混色去黑）；
 *     light 适合白底（normal / 略降透明）。
 */
/**
 * 选材原则（白卡片融合，勿用独立舞台）：
 * - 优先黑底亮色粒子 / 彩色光效，客户端 screen 混入白卡
 * - 避免纯白雪、角色状态圈等与白底融掉或跳戏的素材
 */
const MOOD_FX = [
  {
    id: 'viral',
    label: '爆火',
    slug: 'drifting-embers-overlay',
    file: 'viral.gif',
    bg: 'dark',
  },
  {
    id: 'rising',
    label: '飙升',
    // 流星雨可平铺，整卡氛围比小火花更自然
    slug: 'tileable-meteor-shower',
    file: 'rising.gif',
    bg: 'dark',
  },
  {
    id: 'revived',
    label: '复活',
    // 绿意蔓延，比 bloom-burst 更贴「🌱 复活」且铺满卡片更自然
    slug: 'wild-growth',
    file: 'revived.gif',
    bg: 'dark',
  },
  {
    id: 'fresh',
    label: '新发布',
    slug: 'twinkling-stars',
    file: 'fresh.gif',
    bg: 'dark',
  },
  {
    id: 'popular',
    label: '人气',
    slug: 'valentine-hearts-loop',
    file: 'popular.gif',
    bg: 'dark',
  },
  {
    id: 'sleeping',
    label: '沉睡',
    slug: 'drifting-clouds-loop',
    file: 'sleeping.gif',
    bg: 'dark',
  },
  {
    id: 'cold',
    label: '冷门',
    // 可平铺淡蓝雪，比 frost-screen-edge 轻量且 screen 后可见
    slug: 'seamless-snowfall-loop',
    file: 'cold.gif',
    bg: 'dark',
  },
];

function loadDotEnv() {
  for (const p of [path.join(ROOT, '.env'), path.join(__dirname, 'library-import', '.env.tcb')]) {
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
  return {
    skipDownload: argv.includes('--skip-download'),
    skipUpload: argv.includes('--skip-upload'),
    only: (() => {
      const i = argv.indexOf('--only');
      return i >= 0
        ? String(argv[i + 1] || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    })(),
  };
}

async function ensurePlaywright() {
  try {
    await import('playwright');
    return;
  } catch (_) {
    /* install */
  }
  console.log('[mood-fx] installing playwright + chromium…');
  const r = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '-D', 'playwright@1.65.1', '--no-save'],
    { cwd: ROOT, stdio: 'inherit', shell: true },
  );
  if (r.status !== 0) throw new Error('npm install playwright failed');
  const r2 = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'install', 'chromium'],
    { cwd: ROOT, stdio: 'inherit', shell: true },
  );
  if (r2.status !== 0) throw new Error('playwright install chromium failed');
}

async function downloadGif(page, item, destPath) {
  const url = `https://particlefx.studio/effects/${item.slug}`;
  console.log(`[mood-fx] open ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // 等「DOWNLOAD GIF」可点（引擎暖机后会去掉 disabled）
  const btn = page.locator('button.btn-px[data-format="gif"]');
  await btn.waitFor({ state: 'visible', timeout: 60000 });
  for (let i = 0; i < 90; i += 1) {
    const disabled = await btn.isDisabled().catch(() => true);
    if (!disabled) break;
    await page.waitForTimeout(1000);
    if (i === 89) throw new Error(`GIF button still disabled: ${item.slug}`);
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    btn.click(),
  ]);
  await download.saveAs(destPath);
  const size = fs.statSync(destPath).size;
  if (size < 1024) throw new Error(`GIF too small (${size}B): ${item.slug}`);
  console.log(`[mood-fx] saved ${item.file} (${size} bytes)`);
  return size;
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
  return { app: tcb.default.init({ env, secretId, secretKey }), env };
}

/** 读 GIF 逻辑屏幕宽高（避免展示时乱拉伸） */
function readGifSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 10) return { w: 512, h: 512 };
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { w: buf[6] | (buf[7] << 8), h: buf[8] | (buf[9] << 8) };
    }
  } catch (_) {
    /* ignore */
  }
  return { w: 512, h: 512 };
}

async function uploadGif(app, localPath, moodId, slug = '') {
  // 路径带 slug，避免同名覆盖后 CDN/临时链仍打旧图
  const safeSlug = String(slug || moodId)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const cloudPath = `assets/pack-mood/v2/${moodId}-${safeSlug}.gif`;
  const buf = fs.readFileSync(localPath);
  const result = await app.uploadFile({ cloudPath, fileContent: buf });
  const fileID = result.fileID || result.fileId || '';
  if (!fileID) throw new Error(`upload failed: ${cloudPath}`);
  return { cloudPath, fileID, bytes: buf.length };
}

function writeClientAssets(entries) {
  const map = {};
  const meta = {};
  for (const e of entries) {
    if (!e || !e.fileID) continue;
    map[e.id] = e.fileID;
    meta[e.id] = {
      bg: e.bg === 'light' ? 'light' : 'dark',
      slug: e.slug || '',
      w: Math.max(1, Number(e.w) || 512),
      h: Math.max(1, Number(e.h) || 512),
    };
  }
  const body = `/**
 * 合集氛围 GIF 云资源（由 scripts/upload-pack-mood-fx.mjs 生成）。
 * - fileID：小程序 getTempFileURL 换临时链，勿打进包体
 * - bg：dark=黑底粒子（卡片上 screen 去黑）；light=白底友好
 * 素材：https://particlefx.studio/effects （免费商用、无需署名）
 */
export const PACK_MOOD_FILE_IDS = ${JSON.stringify(map, null, 2)};

export const PACK_MOOD_META = ${JSON.stringify(meta, null, 2)};

export const PACK_MOOD_DISPLAY_MAX_RPX = 240;

export function packMoodFileId(moodId) {
  const id = String(moodId || '').trim();
  return PACK_MOOD_FILE_IDS[id] || '';
}

export function packMoodBg(moodId) {
  const id = String(moodId || '').trim();
  const hit = PACK_MOOD_META[id];
  return hit && hit.bg === 'light' ? 'light' : 'dark';
}

export function packMoodBoxStyle(moodId) {
  const id = String(moodId || '').trim();
  const hit = PACK_MOOD_META[id] || {};
  const w = Math.max(1, Number(hit.w) || 512);
  const h = Math.max(1, Number(hit.h) || 512);
  const max = PACK_MOOD_DISPLAY_MAX_RPX;
  const scale = max / Math.max(w, h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  return \`width:\${dw}rpx;height:\${dh}rpx;\`;
}
`;
  fs.writeFileSync(CLIENT_ASSETS_PATH, body, 'utf8');
  console.log(`[mood-fx] wrote ${path.relative(ROOT, CLIENT_ASSETS_PATH)}`);
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const only = Array.isArray(args.only) ? args.only : [];
  const list = only.length
    ? MOOD_FX.filter(
        (x) => only.includes(x.id) || only.includes(x.slug),
      )
    : MOOD_FX;
  if (!list.length) {
    throw new Error(`--only 未匹配到 mood：${only.join(',')}`);
  }

  if (!args.skipDownload) {
    await ensurePlaywright();
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    try {
      for (const item of list) {
        const dest = path.join(OUT_DIR, item.file);
        try {
          await downloadGif(page, item, dest);
        } catch (e) {
          console.error(`[mood-fx] download fail ${item.id}:`, e.message || e);
          throw e;
        }
      }
    } finally {
      await browser.close();
    }
  } else {
    for (const item of list) {
      const dest = path.join(OUT_DIR, item.file);
      if (!fs.existsSync(dest)) {
        throw new Error(`缺少本地文件：${dest}（去掉 --skip-download 重新拉）`);
      }
    }
  }

  /** @type {Array<{id:string,label:string,slug:string,file:string,bytes:number,cloudPath?:string,fileID?:string}>} */
  const manifest = [];

  if (!args.skipUpload) {
    const { app, env } = await createCloudApp();
    console.log(`[mood-fx] upload → env=${env}`);
    for (const item of list) {
      const dest = path.join(OUT_DIR, item.file);
      const up = await uploadGif(app, dest, item.id, item.slug);
      const size = readGifSize(dest);
      console.log(
        `[mood-fx] cloud ${item.id} → ${up.fileID} (${size.w}x${size.h})`,
      );
      manifest.push({
        id: item.id,
        label: item.label,
        slug: item.slug,
        bg: item.bg || 'dark',
        w: size.w,
        h: size.h,
        file: item.file,
        bytes: up.bytes,
        cloudPath: up.cloudPath,
        fileID: up.fileID,
        source: `https://particlefx.studio/effects/${item.slug}`,
      });
    }
  } else {
    for (const item of list) {
      const dest = path.join(OUT_DIR, item.file);
      const size = readGifSize(dest);
      manifest.push({
        id: item.id,
        label: item.label,
        slug: item.slug,
        bg: item.bg || 'dark',
        w: size.w,
        h: size.h,
        file: item.file,
        bytes: fs.statSync(dest).size,
        source: `https://particlefx.studio/effects/${item.slug}`,
      });
    }
  }

  // 合并旧 manifest（--only 时保留其它 mood），并回填 MOOD_FX 里的 bg/slug
  let prev = [];
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).items || [];
    } catch (_) {
      prev = [];
    }
  }
  const byId = new Map(prev.map((x) => [x.id, x]));
  for (const row of manifest) byId.set(row.id, row);
  const merged = MOOD_FX.map((m) => {
    const hit = byId.get(m.id);
    if (!hit) return null;
    return {
      ...hit,
      slug: m.slug,
      bg: m.bg || hit.bg || 'dark',
      label: m.label,
    };
  }).filter(Boolean);

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        license: 'ParticleFX Studio free commercial use, no credit required',
        items: merged,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`[mood-fx] manifest → ${path.relative(ROOT, MANIFEST_PATH)}`);

  if (!args.skipUpload) {
    writeClientAssets(merged);
  }

  console.log('[mood-fx] done');
}

main().catch((e) => {
  console.error('[mood-fx] FAIL', e.message || e);
  process.exit(1);
});
