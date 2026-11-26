/**
 * 单帧 GIF89a 编码（素材库静图→GIF，便于导入微信少压缩）
 * 输入：RGBA ImageData；输出：ArrayBuffer
 */

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
}

/** 简单均匀量化到 256 色（4×4×4 立方 + 近邻映射） */
function buildPalette(rgba, width, height) {
  const hist = new Map();
  const n = width * height;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const a = rgba[o + 3];
    const r = a < 16 ? 0 : rgba[o];
    const g = a < 16 ? 0 : rgba[o + 1];
    const b = a < 16 ? 0 : rgba[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const entries = Array.from(hist.entries()).sort((a, b) => b[1] - a[1]);
  const palette = new Uint8Array(256 * 3);
  const used = Math.min(256, Math.max(1, entries.length));
  for (let i = 0; i < used; i += 1) {
    const key = entries[i][0];
    const r = ((key >> 10) & 31) << 3;
    const g = ((key >> 5) & 31) << 3;
    const b = (key & 31) << 3;
    palette[i * 3] = r;
    palette[i * 3 + 1] = g;
    palette[i * 3 + 2] = b;
  }
  // 填满剩余槽，避免未定义色
  for (let i = used; i < 256; i += 1) {
    palette[i * 3] = palette[(i % used) * 3];
    palette[i * 3 + 1] = palette[(i % used) * 3 + 1];
    palette[i * 3 + 2] = palette[(i % used) * 3 + 2];
  }
  return { palette, colorCount: used };
}

function nearestIndex(palette, colorCount, r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < colorCount; i += 1) {
    const pr = palette[i * 3];
    const pg = palette[i * 3 + 1];
    const pb = palette[i * 3 + 2];
    const d = (pr - r) * (pr - r) + (pg - g) * (pg - g) + (pb - b) * (pb - b);
    if (d < bestD) {
      bestD = d;
      best = i;
      if (d === 0) break;
    }
  }
  return best;
}

function indexPixels(rgba, width, height, palette, colorCount) {
  const n = width * height;
  const indexed = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const a = rgba[o + 3];
    if (a < 16) {
      indexed[i] = 0;
      continue;
    }
    indexed[i] = nearestIndex(
      palette,
      colorCount,
      rgba[o],
      rgba[o + 1],
      rgba[o + 2],
    );
  }
  return indexed;
}

/** LZW（GIF） */
function lzwEncode(minCodeSize, indexStream) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  const maxCode = 4095;

  const out = [];
  let cur = 0;
  let curBits = 0;

  function writeBits(code, size) {
    cur |= code << curBits;
    curBits += size;
    while (curBits >= 8) {
      out.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  }

  const table = new Map();
  function resetTable() {
    table.clear();
    for (let i = 0; i < clearCode; i += 1) table.set(String(i), i);
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  }

  resetTable();
  writeBits(clearCode, codeSize);

  let w = String(indexStream[0]);
  for (let i = 1; i < indexStream.length; i += 1) {
    const k = String(indexStream[i]);
    const wk = `${w},${k}`;
    if (table.has(wk)) {
      w = wk;
    } else {
      writeBits(table.get(w), codeSize);
      if (nextCode <= maxCode) {
        table.set(wk, nextCode);
        if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
        nextCode += 1;
      } else {
        writeBits(clearCode, codeSize);
        resetTable();
      }
      w = k;
    }
  }
  writeBits(table.get(w), codeSize);
  writeBits(endCode, codeSize);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

/**
 * @param {ImageData|{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} imageData
 * @returns {ArrayBuffer}
 */
export function encodeGifFromImageData(imageData) {
  const width = Math.max(1, Number(imageData.width) || 1);
  const height = Math.max(1, Number(imageData.height) || 1);
  const rgba = imageData.data;
  const { palette, colorCount } = buildPalette(rgba, width, height);
  const indexed = indexPixels(rgba, width, height, palette, colorCount);

  const minCodeSize = 8; // 256 色表
  const lzw = lzwEncode(minCodeSize, indexed);

  // 头 + GCT + GCE + 图像描述 + LZW 分块（每 255 字节多 1 字节长度）
  const size =
    6 +
    7 +
    768 +
    8 +
    10 +
    1 +
    lzw.length +
    Math.ceil(lzw.length / 255) +
    2 +
    64;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let o = 0;

  writeString(view, o, 'GIF89a');
  o += 6;
  view.setUint16(o, width, true);
  o += 2;
  view.setUint16(o, height, true);
  o += 2;
  // GCT flag | color res | sort | GCT size (8 → 256)
  view.setUint8(o, 0xf7);
  o += 1;
  view.setUint8(o, 0); // bg
  o += 1;
  view.setUint8(o, 0); // aspect
  o += 1;

  bytes.set(palette.subarray(0, 256 * 3), o);
  o += 768;

  // Graphic Control Extension：透明色索引 0
  view.setUint8(o, 0x21);
  o += 1;
  view.setUint8(o, 0xf9);
  o += 1;
  view.setUint8(o, 4);
  o += 1;
  view.setUint8(o, 0x01); // transparent
  o += 1;
  view.setUint16(o, 0, true);
  o += 2;
  view.setUint8(o, 0); // transparent index
  o += 1;
  view.setUint8(o, 0);
  o += 1;

  // Image Descriptor
  view.setUint8(o, 0x2c);
  o += 1;
  view.setUint16(o, 0, true);
  o += 2;
  view.setUint16(o, 0, true);
  o += 2;
  view.setUint16(o, width, true);
  o += 2;
  view.setUint16(o, height, true);
  o += 2;
  view.setUint8(o, 0);
  o += 1; // no local table

  view.setUint8(o, minCodeSize);
  o += 1;

  let i = 0;
  while (i < lzw.length) {
    const chunk = Math.min(255, lzw.length - i);
    view.setUint8(o, chunk);
    o += 1;
    for (let j = 0; j < chunk; j += 1) bytes[o + j] = lzw[i + j];
    o += chunk;
    i += chunk;
  }
  view.setUint8(o, 0);
  o += 1;
  view.setUint8(o, 0x3b);
  o += 1;

  return bytes.buffer.slice(0, o);
}
