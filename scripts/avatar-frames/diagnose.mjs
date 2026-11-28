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

try {
  const c = await db.collection('avatar_frames').count();
  console.log('avatar_frames.count', c.total);
} catch (e) {
  console.log('avatar_frames.count ERR', e.message);
}

let frames = [];
try {
  const r = await db.collection('avatar_frames').limit(5).get();
  frames = r.data || [];
  console.log('sample_ids', frames.map((f) => f._id || f.key));
  console.log('sample0', JSON.stringify(frames[0] || null, null, 2));
} catch (e) {
  console.log('list ERR', e.message);
}

try {
  const a = await db.collection('app_config').doc('achievements').get();
  const defs = (a.data && a.data.defs) || [];
  console.log('achievements.defs', defs.length);
  console.log('bound', defs.filter((d) => d && d.frameId).length);
  console.log(
    'first5',
    defs.slice(0, 5).map((d) => ({ id: d.id, frameId: d.frameId })),
  );
} catch (e) {
  console.log('achievements ERR', e.message);
}

if (frames[0] && frames[0].fileID) {
  try {
    const u = await app.getTempFileURL({
      fileList: [frames[0].fileID, frames[0].thumbFileID].filter(Boolean),
    });
    console.log(
      'tempUrls',
      (u.fileList || []).map((x) => ({
        fileID: x.fileID,
        code: x.code,
        status: x.status,
        url: String(x.tempFileURL || '').slice(0, 80),
      })),
    );
  } catch (e) {
    console.log('temp ERR', e.message);
  }
}
