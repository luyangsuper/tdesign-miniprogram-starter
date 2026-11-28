/**
 * 修复错误写入的嵌套 data 字段，并重新 seed 成就绑定。
 *   node scripts/avatar-frames/repair-flatten.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { ACHIEVEMENT_DEFS } = require('./achievements.seed.js');

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

function unwrap(row) {
  if (!row || typeof row !== 'object') return row;
  if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
    const inner = row.data;
    // 典型误写：{ _id, data: { _id, fileID, ... } }
    if (inner.fileID || inner.key || inner.defs || inner.status) {
      return { ...inner, _id: row._id || inner._id };
    }
  }
  return row;
}

loadDotEnv();
const tcb = await import('@cloudbase/node-sdk');
const app = tcb.default.init({
  env: process.env.TCB_ENV,
  secretId: process.env.TCB_SECRET_ID,
  secretKey: process.env.TCB_SECRET_KEY,
});
const db = app.database();

async function loadAll(collection) {
  const rows = [];
  let skip = 0;
  for (;;) {
    const res = await db.collection(collection).skip(skip).limit(100).get();
    const batch = res.data || [];
    if (!batch.length) break;
    rows.push(...batch);
    skip += batch.length;
    if (batch.length < 100) break;
  }
  return rows;
}

console.log('[repair] flatten avatar_frames…');
const framesRaw = await loadAll('avatar_frames');
let fixed = 0;
for (const row of framesRaw) {
  const flat = unwrap(row);
  const id = String(flat._id || flat.key || '').trim();
  if (!id) continue;
  const nested = row.data && typeof row.data === 'object' && row.data.fileID;
  if (!nested && flat.fileID && flat.status) continue;
  const doc = {
    key: flat.key || id,
    title: flat.title || id,
    fileID: flat.fileID || '',
    thumbFileID: flat.thumbFileID || flat.fileID || '',
    animated: !!flat.animated,
    status: flat.status || 'published',
    sort: Number(flat.sort) || 0,
    sourcePath: flat.sourcePath || '',
    updatedAt: Date.now(),
  };
  // eslint-disable-next-line no-await-in-loop
  await db.collection('avatar_frames').doc(id).set(doc);
  fixed += 1;
  if (fixed % 20 === 0) console.log(`  fixed ${fixed}/${framesRaw.length}`);
}
console.log(`[repair] frames fixed ${fixed}/${framesRaw.length}`);

const frames = (await loadAll('avatar_frames'))
  .map(unwrap)
  .filter((f) => f && f.status === 'published' && f.fileID)
  .sort(
    (a, b) =>
      (Number(a.sort) || 0) - (Number(b.sort) || 0) ||
      String(a._id || '').localeCompare(String(b._id || '')),
  );
const frameIds = frames.map((f) => f._id || f.key).filter(Boolean);
console.log('[repair] published frames', frameIds.length);

const defs = ACHIEVEMENT_DEFS.map((def, i) => ({
  ...def,
  frameId: frameIds[i] || '',
  sort: (i + 1) * 10,
}));
await db.collection('app_config').doc('achievements').set({
  defs,
  updatedAt: Date.now(),
  repairedAt: Date.now(),
});
console.log(
  `[repair] achievements seed ${defs.length}, bound ${defs.filter((d) => d.frameId).length}`,
);

const sample = frames[0];
if (sample && sample.fileID) {
  const u = await app.getTempFileURL({ fileList: [sample.fileID] });
  console.log(
    '[repair] sample temp',
    (u.fileList || []).map((x) => ({
      code: x.code,
      url: String(x.tempFileURL || '').slice(0, 70),
    })),
  );
}

console.log('[repair] done');
process.exit(0);
