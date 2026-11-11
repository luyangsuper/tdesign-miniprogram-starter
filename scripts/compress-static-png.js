/**
 * 压缩 static 下 PNG，降低主包体积
 * 运行：node scripts/compress-static-png.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'static');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.png$/i.test(e.name)) out.push(p);
  }
  return out;
}

function maxEdgeFor(file) {
  const rel = file.split(path.sep).join('/');
  if (rel.includes('/particles/')) return 96;
  if (rel.includes('/tab/')) return 81;
  if (rel.includes('/pricing/')) return 128;
  if (rel.includes('/lottery/')) return 160;
  return 160;
}

async function main() {
  const files = walk(ROOT);
  let before = 0;
  let after = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f);
    before += buf.length;
    const meta = await sharp(buf).metadata();
    const max = maxEdgeFor(f);
    let pipeline = sharp(buf).ensureAlpha();
    if ((meta.width || 0) > max || (meta.height || 0) > max) {
      pipeline = pipeline.resize(max, max, { fit: 'inside', withoutEnlargement: true });
    }
    const out = await pipeline
      .png({ compressionLevel: 9, palette: true, quality: 78, effort: 10 })
      .toBuffer();
    if (out.length < buf.length) {
      fs.writeFileSync(f, out);
      after += out.length;
      console.log('OK', path.relative(ROOT, f), buf.length, '→', out.length);
    } else {
      after += buf.length;
    }
  }
  console.log(
    `Done ${files.length} files: ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB (saved ${((before - after) / 1048576).toFixed(2)}MB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
