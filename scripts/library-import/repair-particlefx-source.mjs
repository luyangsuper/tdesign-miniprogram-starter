/**
 * 确保 particlefx 源可见：enabled + published，并刷新 itemCount / 预览。
 *   node scripts/library-import/repair-particlefx-source.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

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
const tcb = await import('@cloudbase/node-sdk');
const app = tcb.default.init({
  env: process.env.TCB_ENV,
  secretId: process.env.TCB_SECRET_ID,
  secretKey: process.env.TCB_SECRET_KEY,
});
const db = app.database();

const SOURCE_ID = 'particlefx';

let itemCount = 0;
try {
  const c = await db
    .collection('lib_items')
    .where({ sourceId: SOURCE_ID, status: 'published' })
    .count();
  itemCount = c.total || 0;
} catch (e) {
  console.warn('count fail', e.message);
}

let previewFileIDs = [];
try {
  const snap = await db
    .collection('lib_items')
    .where({ sourceId: SOURCE_ID, status: 'published' })
    .limit(4)
    .get();
  previewFileIDs = (snap.data || [])
    .map((r) => String((r && r.previewFileID) || '').trim())
    .filter(Boolean)
    .slice(0, 4);
} catch (e) {
  console.warn('preview fail', e.message);
}

let groupCount = 0;
try {
  const g = await db
    .collection('lib_groups')
    .where({ sourceId: SOURCE_ID, status: 'published' })
    .count();
  groupCount = g.total || 0;
} catch (e) {
  /* ignore */
}

const patch = {
  id: SOURCE_ID,
  title: '粒子特效素材',
  subtitle: '动图',
  desc: '氛围粒子动图，点开可选颜色 · ParticleFX',
  formatsDefault: ['gif'],
  sort: 60,
  costs: { anim: 4, static: 4 },
  status: 'published',
  enabled: true,
  itemCount,
  groupCount,
  previewFileIDs,
  updatedAt: Date.now(),
};

await db.collection('lib_sources').doc(SOURCE_ID).set(patch);
console.log('[repair] particlefx source', {
  itemCount,
  groupCount,
  previews: previewFileIDs.length,
  enabled: true,
});
process.exit(0);
