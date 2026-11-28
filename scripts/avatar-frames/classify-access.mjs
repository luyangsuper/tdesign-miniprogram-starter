/**
 * 给未绑成就的头像框打标：
 * - 成就已绑框 → access=achievement
 * - 其后约 24 个 → vip（会员期可戴）
 * - 其余全部 → paid（¥3 永久，全部进衣橱「选购」）
 *
 *   npm run avatar-frames:classify
 *   npm run avatar-frames:classify -- --dry
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const VIP_COUNT = 24;
const PAID_FEN = 300;

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
  if (row.data && typeof row.data === 'object' && (row.data.fileID || row.data.defs)) {
    return { ...row.data, _id: row._id || row.data._id };
  }
  return row;
}

loadDotEnv();
const dry = process.argv.includes('--dry');
const tcb = await import('@cloudbase/node-sdk');
const app = tcb.default.init({
  env: process.env.TCB_ENV,
  secretId: process.env.TCB_SECRET_ID,
  secretKey: process.env.TCB_SECRET_KEY,
});
const db = app.database();

const frames = [];
let skip = 0;
while (frames.length < 500) {
  const res = await db.collection('avatar_frames').skip(skip).limit(100).get();
  const batch = res.data || [];
  if (!batch.length) break;
  frames.push(...batch.map(unwrap));
  skip += batch.length;
  if (batch.length < 100) break;
}

frames.sort(
  (a, b) =>
    (Number(a.sort) || 0) - (Number(b.sort) || 0) ||
    String(a._id || a.key || '').localeCompare(String(b._id || b.key || '')),
);

let bound = new Set();
try {
  const snap = await db.collection('app_config').doc('achievements').get();
  let raw = snap.data;
  if (Array.isArray(raw)) raw = raw[0] || {};
  const row = unwrap(raw || {});
  const defs = Array.isArray(row.defs)
    ? row.defs
    : Array.isArray(row.data && row.data.defs)
      ? row.data.defs
      : [];
  defs.forEach((d) => {
    const id = String((d && d.frameId) || '').trim();
    if (id) bound.add(id);
  });
} catch (_) {
  /* ignore */
}
// 兜底：成就表若未绑框，按排序前 19 个留给成就
if (!bound.size) {
  frames.slice(0, 19).forEach((f) => {
    const id = String(f._id || f.key || '').trim();
    if (id) bound.add(id);
  });
  console.log('[classify] achievements 无 frameId，兜底前 19 个为成就池');
}

const rest = [];
const counts = { achievement: 0, vip: 0, paid: 0 };

for (const f of frames) {
  const id = String(f._id || f.key || '').trim();
  if (!id || !f.fileID) continue;
  if (bound.has(id)) {
    counts.achievement += 1;
    if (!dry) {
      // eslint-disable-next-line no-await-in-loop
      await db.collection('avatar_frames').doc(id).update({
        access: 'achievement',
        priceFen: 0,
        updatedAt: Date.now(),
      });
    }
  } else {
    rest.push(f);
  }
}

rest.forEach((f, i) => {
  const access = i < VIP_COUNT ? 'vip' : 'paid';
  counts[access] += 1;
});

console.log('[classify]', { bound: bound.size, rest: rest.length, counts, dry });

if (!dry) {
  for (let i = 0; i < rest.length; i += 1) {
    const f = rest[i];
    const id = String(f._id || f.key || '').trim();
    const access = i < VIP_COUNT ? 'vip' : 'paid';
    const priceFen = access === 'paid' ? PAID_FEN : 0;
    // eslint-disable-next-line no-await-in-loop
    await db.collection('avatar_frames').doc(id).update({
      access,
      priceFen,
      updatedAt: Date.now(),
    });
    if ((i + 1) % 20 === 0) console.log(`[classify] ${i + 1}/${rest.length}`);
  }
  console.log('[classify] done');
}

process.exit(0);
