import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadDotEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
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

loadDotEnv();

const env = process.env.TCB_ENV || '';
console.log('TCB_ENV', env);
console.log('hasSecret', !!(process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY));

const tcb = await import('@cloudbase/node-sdk');
const app = tcb.default.init({
  env,
  secretId: process.env.TCB_SECRET_ID,
  secretKey: process.env.TCB_SECRET_KEY,
});
const db = app.database();

try {
  const sources = await db.collection('lib_sources').limit(20).get();
  const list = Array.isArray(sources.data)
    ? sources.data
    : sources.data
      ? [sources.data]
      : [];
  console.log(
    'sources',
    list.map((s) => ({
      id: s._id || s.id,
      title: s.title,
      itemCount: s.itemCount,
      costs: s.costs || null,
    })),
  );
} catch (e) {
  console.log('sources err', e.code || e.message);
}

try {
  const cnt = await db
    .collection('lib_items')
    .where({ sourceId: 'meme-api' })
    .count();
  console.log('meme-api items', cnt.total);
} catch (e) {
  console.log('meme count err', e.code || e.message);
}

try {
  const sample = await db
    .collection('lib_items')
    .where({ sourceId: 'meme-api' })
    .limit(2)
    .get();
  const rows = Array.isArray(sample.data)
    ? sample.data
    : sample.data
      ? [sample.data]
      : [];
  console.log(
    'meme sample',
    rows.map((r) => ({
      id: r._id,
      name: r.name,
      files: Object.keys(r.files || {}),
    })),
  );
} catch (e) {
  console.log('meme sample err', e.code || e.message);
}

try {
  const g = await db
    .collection('lib_groups')
    .where({ sourceId: 'meme-api' })
    .count();
  console.log('meme groups', g.total);
} catch (e) {
  console.log('meme groups err', e.code || e.message);
}

try {
  const any = await db.collection('lib_items').limit(1).get();
  const row = Array.isArray(any.data) ? any.data[0] : any.data;
  console.log('any item', row && { id: row._id, sourceId: row.sourceId, name: row.name });
} catch (e) {
  console.log('any item err', e.code || e.message);
}
