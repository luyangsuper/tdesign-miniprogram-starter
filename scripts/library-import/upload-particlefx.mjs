/**
 * ParticleFX 全量入库：每个效果一条 lib_items，颜色进 meta.variants。
 *
 * 用法：
 *   node scripts/library-import/upload-particlefx.mjs --limit 2
 *   node scripts/library-import/upload-particlefx.mjs --resume
 *   node scripts/library-import/upload-particlefx.mjs --only-slug drifting-embers-overlay
 *   node scripts/library-import/upload-particlefx.mjs --only-category "Tileable Backgrounds"
 *   node scripts/library-import/upload-particlefx.mjs --skip-download   # 只用本地已下好的
 *   node scripts/library-import/upload-particlefx.mjs --dry
 *
 * 需要：.env 里 TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(__dirname, 'out', 'particlefx');
const CATALOG_PATH = path.join(OUT_DIR, 'catalog.json');
const PROGRESS_PATH = path.join(OUT_DIR, 'progress.json');

const SOURCE = {
  id: 'particlefx',
  title: '粒子特效素材',
  subtitle: '动图',
  desc: '氛围粒子动图，点开可选颜色 · ParticleFX',
  formatsDefault: ['gif'],
  sort: 60,
  costs: { anim: 4, static: 4 },
  status: 'published',
  enabled: true,
};

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
    resume: true,
    skipDownload: false,
    skipUpload: false,
    dry: false,
    onlySlug: '',
    onlyCategory: '',
    refreshCatalog: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--resume') out.resume = true;
    else if (a === '--no-resume') out.resume = false;
    else if (a === '--skip-download') out.skipDownload = true;
    else if (a === '--skip-upload') out.skipUpload = true;
    else if (a === '--dry') out.dry = true;
    else if (a === '--only-slug') out.onlySlug = String(argv[++i] || '').trim();
    else if (a === '--only-category')
      out.onlyCategory = String(argv[++i] || '').trim();
    else if (a === '--refresh-catalog') out.refreshCatalog = true;
  }
  return out;
}

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function cleanCategoryTitle(raw) {
  return String(raw || '')
    .replace(/\s+\d+\s*$/, '')
    .trim();
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

async function ensurePlaywright() {
  try {
    await import('playwright');
    return;
  } catch (_) {
    /* install */
  }
  console.log('[pfx] installing playwright + chromium…');
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

async function scrapeCatalog(page) {
  await page.goto('https://particlefx.studio/effects', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForTimeout(4500);
  const items = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/effects/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/effects\/([a-z0-9-]+)\/?$/i);
      if (!m) return;
      const slug = m[1].toLowerCase();
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      let cat = '';
      let el = a.parentElement;
      for (let i = 0; i < 14 && el; i += 1) {
        const h =
          el.querySelector && el.querySelector(':scope > h2, :scope > h3');
        if (h) {
          cat = (h.textContent || '').trim();
          break;
        }
        const prev = el.previousElementSibling;
        if (prev && /^H[23]$/.test(prev.tagName)) {
          cat = (prev.textContent || '').trim();
          break;
        }
        el = el.parentElement;
      }
      const name = (a.getAttribute('title') || a.textContent || slug)
        .replace(/\s*particle effect\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({ slug, name, categoryRaw: cat });
    });
    return out;
  });

  // 去掉分类页自身（标题 slug 与分类名相同、且不是真正效果）
  const catSlugs = new Set(
    items
      .map((it) => slugify(cleanCategoryTitle(it.categoryRaw)))
      .filter(Boolean),
  );
  return items
    .filter((it) => !catSlugs.has(it.slug) || it.slug.includes('-'))
    .map((it) => {
      const category = cleanCategoryTitle(it.categoryRaw) || 'Other';
      return {
        slug: it.slug,
        name: it.name || it.slug,
        category,
        groupKey: slugify(category) || 'other',
      };
    });
}

async function waitGifReady(page, timeoutMs = 90000) {
  const btn = page.locator('button.btn-px[data-format="gif"]');
  await btn.waitFor({ state: 'visible', timeout: timeoutMs });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const disabled = await btn.isDisabled().catch(() => true);
    if (!disabled) return btn;
    await page.waitForTimeout(800);
  }
  throw new Error('GIF button still disabled');
}

async function listColours(page) {
  const colours = await page
    .locator('button.fx-swatch[data-colour]')
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const key = String(n.getAttribute('data-colour') || '')
          .trim()
          .toLowerCase();
        const hex =
          (n.querySelector('i') && n.querySelector('i').style.background) ||
          '';
        const label = (n.textContent || key).trim();
        return { key, label, hex };
      }),
    );
  const uniq = [];
  const seen = new Set();
  for (const c of colours) {
    if (!c.key || seen.has(c.key)) continue;
    seen.add(c.key);
    uniq.push(c);
  }
  if (!uniq.length) uniq.push({ key: 'original', label: 'Original', hex: '' });
  return uniq;
}

async function downloadColourGif(page, colourKey, destPath) {
  const swatch = page.locator(
    `button.fx-swatch[data-colour="${colourKey}"]`,
  );
  if ((await swatch.count()) > 0) {
    const pressed = await swatch.getAttribute('aria-pressed');
    if (pressed !== 'true') {
      await swatch.click();
      await page.waitForTimeout(600);
    }
  }
  const btn = await waitGifReady(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    btn.click(),
  ]);
  await download.saveAs(destPath);
  const size = fs.statSync(destPath).size;
  if (size < 1024) throw new Error(`GIF too small (${size}B)`);
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
  } catch (_) {
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

async function ensureSourceAndGroups(db, groups) {
  const now = Date.now();
  await upsertDoc(
    db,
    'lib_sources',
    SOURCE.id,
    {
      ...SOURCE,
      groupCount: groups.length,
      updatedAt: now,
    },
    {
      itemCount: 0,
      downloadCount: 0,
      createdAt: now,
      previewFileIDs: [],
    },
  );
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    const gid = `${SOURCE.id}_${g.key}`;
    // eslint-disable-next-line no-await-in-loop
    await upsertDoc(
      db,
      'lib_groups',
      gid,
      {
        sourceId: SOURCE.id,
        externalKey: g.key,
        title: g.title,
        emoji: '',
        sort: (i + 1) * 10,
        status: 'published',
        updatedAt: now,
      },
      { itemCount: 0, createdAt: now },
    );
  }
}

async function refreshCounts(db, groupCount, itemCount) {
  await db
    .collection('lib_sources')
    .doc(SOURCE.id)
    .update({
      itemCount: Math.max(0, Number(itemCount) || 0),
      groupCount: Math.max(0, Number(groupCount) || 0),
      status: 'published',
      enabled: true,
      updatedAt: Date.now(),
    });
}

async function samplePreviews(db, limit = 4) {
  try {
    const snap = await db
      .collection('lib_items')
      .where({ sourceId: SOURCE.id, status: 'published' })
      .limit(limit)
      .get();
    const rows = (snap && snap.data) || [];
    const list = Array.isArray(rows) ? rows : [];
    const ids = list
      .map((r) => String((r && r.previewFileID) || '').trim())
      .filter(Boolean)
      .slice(0, limit);
    if (!ids.length) return;
    await db.collection('lib_sources').doc(SOURCE.id).update({
      previewFileIDs: ids,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[pfx] sample previews fail', e.message || e);
  }
}

async function uploadGif(app, localPath, slug, color) {
  const safeSlug = String(slug)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 64);
  const safeColor = String(color)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 24);
  const cloudPath = `library/particlefx/${safeSlug}/${safeColor}.gif`;
  const buf = fs.readFileSync(localPath);
  const result = await app.uploadFile({ cloudPath, fileContent: buf });
  const fileID = result.fileID || result.fileId || '';
  if (!fileID) throw new Error(`upload failed: ${cloudPath}`);
  return { cloudPath, fileID, bytes: buf.length };
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await ensurePlaywright();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  let catalog = loadJson(CATALOG_PATH, null);
  if (!catalog || !Array.isArray(catalog.items) || args.refreshCatalog) {
    console.log('[pfx] scrape catalog…');
    const items = await scrapeCatalog(page);
    catalog = { scrapedAt: Date.now(), items };
    saveJson(CATALOG_PATH, catalog);
    console.log(`[pfx] catalog ${items.length} effects`);
  } else {
    console.log(`[pfx] catalog cache ${catalog.items.length} effects`);
  }

  let list = catalog.items.slice();
  if (args.onlySlug) {
    list = list.filter((x) => x.slug === args.onlySlug);
  }
  if (args.onlyCategory) {
    const needle = args.onlyCategory.toLowerCase();
    list = list.filter(
      (x) =>
        String(x.category || '')
          .toLowerCase()
          .includes(needle) ||
        String(x.groupKey || '')
          .toLowerCase()
          .includes(slugify(needle)),
    );
  }
  if (args.limit > 0) list = list.slice(0, args.limit);
  if (!list.length) {
    await browser.close();
    throw new Error('没有匹配的效果');
  }

  const groupMap = new Map();
  for (const it of catalog.items) {
    const key = it.groupKey || 'other';
    if (!groupMap.has(key)) {
      groupMap.set(key, { key, title: it.category || key });
    }
  }
  const groups = Array.from(groupMap.values());

  const progress = loadJson(PROGRESS_PATH, { effects: {} });
  let app = null;
  let db = null;
  if (!args.skipUpload && !args.dry) {
    const cloud = await createCloudApp();
    app = cloud.app;
    db = app.database();
    console.log(`[pfx] upload → env=${cloud.env}`);
    await ensureSourceAndGroups(db, groups);
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;

  try {
    for (let i = 0; i < list.length; i += 1) {
      const effect = list[i];
      const slug = effect.slug;
      const prev = (progress.effects && progress.effects[slug]) || {};
      console.log(`[pfx] (${i + 1}/${list.length}) ${slug}`);

      try {
        const effectDir = path.join(OUT_DIR, slug);
        fs.mkdirSync(effectDir, { recursive: true });

        let colours = Array.isArray(prev.colours) ? prev.colours.slice() : [];
        const variants = { ...(prev.variants || {}) };

        if (!args.skipDownload) {
          const url = `https://particlefx.studio/effects/${slug}`;
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 90000,
          });
          // 分类页没有下载按钮则跳过
          const hasGif = await page
            .locator('button.btn-px[data-format="gif"]')
            .count();
          if (!hasGif) {
            console.warn(`[pfx] skip (no GIF btn): ${slug}`);
            skip += 1;
            continue;
          }
          await waitGifReady(page).catch(() => null);
          colours = await listColours(page);
          for (const c of colours) {
            const dest = path.join(effectDir, `${c.key}.gif`);
            if (
              args.resume &&
              fs.existsSync(dest) &&
              fs.statSync(dest).size > 1024 &&
              variants[c.key] &&
              variants[c.key].gif
            ) {
              console.log(`[pfx]   skip colour ${c.key} (resume)`);
              continue;
            }
            if (
              args.resume &&
              fs.existsSync(dest) &&
              fs.statSync(dest).size > 1024 &&
              args.skipUpload
            ) {
              console.log(`[pfx]   local ok ${c.key}`);
              continue;
            }
            // eslint-disable-next-line no-await-in-loop
            const bytes = await downloadColourGif(page, c.key, dest);
            console.log(`[pfx]   gif ${c.key} (${bytes}B)`);
          }
        } else {
          // 从本地文件推断颜色
          if (fs.existsSync(effectDir)) {
            colours = fs
              .readdirSync(effectDir)
              .filter((f) => f.endsWith('.gif'))
              .map((f) => {
                const key = f.replace(/\.gif$/i, '');
                return { key, label: key, hex: '' };
              });
          }
        }

        if (!colours.length) {
          console.warn(`[pfx] no colours: ${slug}`);
          skip += 1;
          continue;
        }

        if (!args.skipUpload && !args.dry && app && db) {
          for (const c of colours) {
            const dest = path.join(effectDir, `${c.key}.gif`);
            if (!fs.existsSync(dest)) continue;
            if (args.resume && variants[c.key] && variants[c.key].gif) {
              continue;
            }
            // eslint-disable-next-line no-await-in-loop
            const up = await uploadGif(app, dest, slug, c.key);
            variants[c.key] = {
              gif: up.fileID,
              hex: c.hex || '',
              label: c.label || c.key,
            };
            console.log(`[pfx]   cloud ${c.key}`);
          }

          const colorKeys = colours.map((c) => c.key);
          const defaultColor = colorKeys.includes('original')
            ? 'original'
            : colorKeys[0];
          const defaultGif =
            (variants[defaultColor] && variants[defaultColor].gif) ||
            Object.values(variants).map((v) => v && v.gif).find(Boolean) ||
            '';
          if (!defaultGif) {
            console.warn(`[pfx] no uploaded gif: ${slug}`);
            fail += 1;
            continue;
          }

          const docId = `${SOURCE.id}_${slug}`
            .replace(/[^\w.-]/g, '_')
            .slice(0, 120);
          const now = Date.now();
          const meta = {
            kind: 'particlefx',
            category: effect.category,
            colors: colorKeys,
            defaultColor,
            variants,
            sourceUrl: `https://particlefx.studio/effects/${slug}`,
          };
          // eslint-disable-next-line no-await-in-loop
          await upsertDoc(
            db,
            'lib_items',
            docId,
            {
              sourceId: SOURCE.id,
              groupId: `${SOURCE.id}_${effect.groupKey}`,
              groupKey: effect.groupKey,
              externalKey: slug,
              name: effect.name || slug,
              tags: [effect.category, 'particlefx'].filter(Boolean),
              formats: ['gif'],
              previewFileID: defaultGif,
              previewUrl: '',
              files: { gif: defaultGif },
              meta,
              sort: i,
              status: 'published',
              updatedAt: now,
            },
            { downloadCount: 0, createdAt: now },
          );
        }

        progress.effects[slug] = {
          colours,
          variants,
          groupKey: effect.groupKey,
          name: effect.name,
          updatedAt: Date.now(),
        };
        saveJson(PROGRESS_PATH, progress);
        ok += 1;
      } catch (e) {
        fail += 1;
        console.error(`[pfx] fail ${slug}:`, e.message || e);
        progress.effects[slug] = {
          ...(progress.effects[slug] || {}),
          lastError: String(e.message || e),
          updatedAt: Date.now(),
        };
        saveJson(PROGRESS_PATH, progress);
      }
    }
  } finally {
    await browser.close();
  }

  if (!args.skipUpload && !args.dry && db) {
    const doneCount = Object.keys(progress.effects || {}).filter((k) => {
      const v = progress.effects[k];
      return v && v.variants && Object.keys(v.variants).length;
    }).length;
    await refreshCounts(db, groups.length, doneCount);
    await samplePreviews(db, 4);
  }

  console.log(`[pfx] done ok=${ok} skip=${skip} fail=${fail}`);
  // Playwright / Chromium 偶发不退出，强制结束
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[pfx] fatal', e);
  process.exit(1);
});
