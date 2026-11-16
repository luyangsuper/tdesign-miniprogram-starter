/**
 * 静态 PNG → 高质量透明 GIF（对齐 videoToEmoji / gif_export.py）
 * - 硬化 alpha：近白抗锯齿保留，贴轮廓半透明收成实色，外圈清零
 * - gifenc rgb565 量化 + 透明槽钉在 index 0
 * - 色盘强制保留不透明黑，避免描边变洞
 */

const { PNG } = require('pngjs');
const { GIFEncoder, applyPalette, quantize } = require('gifenc');

const GIF_ALPHA_THRESHOLD = 128;
const GIF_NEAR_WHITE_ALPHA_KEEP = 16;
const GIF_PIXEL_FORMAT = 'rgb565';
/** 静态表情单帧 delay（毫秒）；微信表情导入不依赖动画，取稳妥值 */
const STATIC_GIF_DELAY_MS = 100;

function isPngBuffer(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

function isNearWhiteRgb(r, g, b) {
  const minC = Math.min(r, g, b);
  const maxC = Math.max(r, g, b);
  return minC >= 200 && maxC - minC <= 48;
}

/**
 * 对齐 gif_export.prepare_frame_for_gif：
 * 硬透明前救近白 AA，并把贴着实心轮廓的半透明像素收成不透明。
 */
function prepareFrameForGif(rgba, width, height, alphaThreshold = GIF_ALPHA_THRESHOLD) {
  const threshold = Math.max(0, Math.min(255, Number(alphaThreshold) || GIF_ALPHA_THRESHOLD));
  const keepFloor = Math.max(24, Math.floor(threshold / 4));
  const out = Buffer.alloc(rgba.length);
  const opaque = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;
      const a = rgba[i + 3];
      opaque[p] = a >= threshold ? 1 : 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];

      let keep = opaque[p] === 1;
      if (!keep && a >= GIF_NEAR_WHITE_ALPHA_KEEP && isNearWhiteRgb(r, g, b)) {
        keep = true;
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = 255;
      } else if (!keep && a >= keepFloor) {
        const neighbor =
          (y > 0 && opaque[p - width]) ||
          (y + 1 < height && opaque[p + width]) ||
          (x > 0 && opaque[p - 1]) ||
          (x + 1 < width && opaque[p + 1]);
        if (neighbor) {
          keep = true;
          out[i] = r;
          out[i + 1] = g;
          out[i + 2] = b;
          out[i + 3] = 255;
        }
      } else if (keep) {
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
      }

      if (!keep) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      }
    }
  }

  return out;
}

function ensureOpaqueBlack(palette, transparentIndex) {
  for (let i = 0; i < palette.length; i += 1) {
    if (i === transparentIndex) continue;
    const c = palette[i];
    if (c && c[0] === 0 && c[1] === 0 && c[2] === 0) return palette;
  }
  if (palette.length >= 256) {
    const replaceAt = transparentIndex === palette.length - 1 ? palette.length - 2 : palette.length - 1;
    if (replaceAt >= 0 && replaceAt !== transparentIndex) {
      palette[replaceAt] = [0, 0, 0, 255];
    }
  } else {
    palette.push([0, 0, 0, 255]);
  }
  return palette;
}

function createTransparentGifPalette(data, maxColors = 256) {
  const palette = quantize(data, maxColors, {
    format: GIF_PIXEL_FORMAT,
    oneBitAlpha: GIF_ALPHA_THRESHOLD,
    clearAlpha: true,
    clearAlphaThreshold: GIF_ALPHA_THRESHOLD,
    clearAlphaColor: 0x00,
  });

  let transparentIndex = palette.findIndex(
    (color) => color.length > 3 && color[3] < GIF_ALPHA_THRESHOLD,
  );
  if (transparentIndex < 0) {
    if (palette.length >= maxColors) palette.pop();
    palette.unshift([0, 0, 0, 0]);
    transparentIndex = 0;
  }

  ensureOpaqueBlack(palette, transparentIndex);
  return { palette, transparentIndex };
}

function nearestOpaquePaletteIndex(r, g, b, palette, transparentIndex) {
  let best = transparentIndex === 0 ? 1 : 0;
  if (best >= palette.length) best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    if (i === transparentIndex) continue;
    const color = palette[i];
    if ((color[3] ?? 255) < GIF_ALPHA_THRESHOLD) continue;
    const dr = color[0] - r;
    const dg = color[1] - g;
    const db = color[2] - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function writeTransparentGifFrame(encoder, data, width, height, palette, transparentIndex) {
  const index = applyPalette(data, palette, GIF_PIXEL_FORMAT);
  const pixelCount = width * height;
  for (let p = 0, i = 0; p < pixelCount; p += 1, i += 4) {
    if (data[i + 3] < GIF_ALPHA_THRESHOLD) {
      index[p] = transparentIndex;
      continue;
    }
    if (index[p] === transparentIndex) {
      index[p] = nearestOpaquePaletteIndex(
        data[i],
        data[i + 1],
        data[i + 2],
        palette,
        transparentIndex,
      );
    }
  }
  encoder.writeFrame(index, width, height, {
    palette,
    delay: STATIC_GIF_DELAY_MS,
    transparent: true,
    transparentIndex,
    dispose: 2,
    repeat: 0,
  });
}

/**
 * @param {Buffer} pngBuffer
 * @param {{ alphaThreshold?: number }} [options]
 * @returns {Buffer} gifBuffer
 */
function convertPngBufferToGif(pngBuffer, options = {}) {
  if (!isPngBuffer(pngBuffer)) {
    throw new Error('不是 PNG 文件');
  }

  const png = PNG.sync.read(pngBuffer);
  const width = png.width;
  const height = png.height;
  if (!width || !height) {
    throw new Error('PNG 尺寸无效');
  }

  const alphaThreshold =
    options.alphaThreshold != null ? options.alphaThreshold : GIF_ALPHA_THRESHOLD;
  const prepared = prepareFrameForGif(png.data, width, height, alphaThreshold);
  // gifenc quantize 需要 Uint8ClampedArray / Uint8Array
  const data = new Uint8ClampedArray(
    prepared.buffer,
    prepared.byteOffset,
    prepared.byteLength,
  );

  const { palette, transparentIndex } = createTransparentGifPalette(data);
  const encoder = GIFEncoder();
  writeTransparentGifFrame(encoder, data, width, height, palette, transparentIndex);
  encoder.finish();

  const bytes = encoder.bytes();
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

module.exports = {
  GIF_ALPHA_THRESHOLD,
  isPngBuffer,
  convertPngBufferToGif,
};
