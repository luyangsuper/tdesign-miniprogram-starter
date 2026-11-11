const sharp = require('sharp');

/**
 * Kubai 图底部常有低透明柔光；若整图画布直接 trim(低阈值)，实心图形会偏上。
 * 做法：按较高 alpha 取出实心包围盒，再用 contain 放进正方形（自动居中）。
 */
async function writeKubaiPng(outPath, input, size, opts = {}) {
  const threshold = opts.threshold == null ? 48 : opts.threshold;
  const target = size;

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    await sharp(input)
      .resize(target, target, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    return;
  }

  // 略扩，避免裁掉描边
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(w - 1, maxX + 1);
  maxY = Math.min(h - 1, maxY + 1);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;

  await sharp(input)
    .ensureAlpha()
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .resize(target, target, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

module.exports = { writeKubaiPng };
