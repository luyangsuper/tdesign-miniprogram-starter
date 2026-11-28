/**
 * JPEG EXIF / ICC 段提取、回写与常用标签解析（对齐 hahaimage/src/lib/exif.ts）。
 * Canvas 重编码会丢掉元数据，压缩后需插回。
 */

const SOI = 0xffd8;
const APP1 = 0xffe1;
const APP2 = 0xffe2;
const SOS = 0xffda;

const IFD0_TAGS = {
  0x010f: '相机制造商',
  0x0110: '相机型号',
  0x0112: '方向',
  0x0131: '软件',
  0x0132: '拍摄时间',
  0x0100: '图像宽度',
  0x0101: '图像高度',
  0x010e: '图像描述',
  0x013b: '作者',
  0x8298: '版权',
};

const EXIF_TAGS = {
  0x829a: '曝光时间',
  0x829d: '光圈',
  0x8827: 'ISO',
  0x9003: '原始拍摄时间',
  0x9004: '数字化时间',
  0x9201: '快门速度',
  0x9202: '光圈值',
  0x920a: '焦距',
  0xa002: '有效宽度',
  0xa003: '有效高度',
  0xa405: '等效焦距',
};

const GPS_TAGS = {
  0x0001: 'GPS纬度参考',
  0x0002: 'GPS纬度',
  0x0003: 'GPS经度参考',
  0x0004: 'GPS经度',
  0x0005: 'GPS海拔参考',
  0x0006: 'GPS海拔',
};

function isJpeg(view) {
  return view.byteLength > 4 && view.getUint16(0) === SOI;
}

export function extractJpegMetaSegments(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const segments = [];
  if (!isJpeg(view)) return segments;
  let off = 2;
  while (off + 4 <= view.byteLength) {
    if (view.getUint8(off) !== 0xff) break;
    const marker = view.getUint16(off);
    if (marker === SOS) break;
    const size = view.getUint16(off + 2);
    if (size < 2 || off + 2 + size > view.byteLength) break;
    if (marker === APP1 || marker === APP2) {
      const sig = String.fromCharCode(
        bytes[off + 4] || 0,
        bytes[off + 5] || 0,
        bytes[off + 6] || 0,
        bytes[off + 7] || 0,
      );
      if (
        (marker === APP1 && sig === 'Exif') ||
        (marker === APP2 && sig === 'ICC_')
      ) {
        segments.push(bytes.slice(off, off + 2 + size));
      }
    }
    off += 2 + size;
  }
  return segments;
}

/** Canvas 已按方向解码，回写时把 Orientation 置为 1，避免二次旋转 */
export function normalizeOrientation(seg) {
  const tiff = 10;
  if (seg.length < tiff + 8) return;
  const view = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const littleEndian = view.getUint16(tiff) === 0x4949;
  if (view.getUint16(tiff + 2, littleEndian) !== 42) return;
  const ifd0 = tiff + view.getUint32(tiff + 4, littleEndian);
  if (ifd0 + 2 > seg.length) return;
  const count = view.getUint16(ifd0, littleEndian);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > seg.length) return;
    if (view.getUint16(entry, littleEndian) === 0x0112) {
      view.setUint16(entry + 8, 1, littleEndian);
      return;
    }
  }
}

export function insertJpegSegments(jpeg, segments) {
  if (!segments || !segments.length) return jpeg;
  const total = jpeg.length + segments.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  out.set(jpeg.subarray(0, 2), 0);
  let off = 2;
  for (let i = 0; i < segments.length; i++) {
    out.set(segments[i], off);
    off += segments[i].length;
  }
  out.set(jpeg.subarray(2), off);
  return out;
}

export function readFileArrayBuffer(filePath) {
  return new Promise((resolve, reject) => {
    const fsm = wx.getFileSystemManager();
    fsm.readFile({
      filePath,
      success: (res) => {
        const data = res.data;
        if (data instanceof ArrayBuffer) {
          resolve(data);
          return;
        }
        if (typeof data === 'string' && wx.base64ToArrayBuffer) {
          resolve(wx.base64ToArrayBuffer(data));
          return;
        }
        reject(new Error('无法读取图片二进制'));
      },
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '读取失败')),
    });
  });
}

export function writeJpegTemp(bytes) {
  const outPath = `${wx.env.USER_DATA_PATH}/img_exif_${Date.now()}.jpg`;
  const fsm = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    const tryWrite = (data) =>
      new Promise((res, rej) => {
        fsm.writeFile({
          filePath: outPath,
          data,
          success: () => res(outPath),
          fail: rej,
        });
      });
    tryWrite(bytes)
      .then(resolve)
      .catch(() =>
        tryWrite(bytes.buffer)
          .then(resolve)
          .catch((err) =>
            reject(
              new Error((err && (err.errMsg || err.message)) || '写入失败'),
            ),
          ),
      );
  });
}

function readAscii(view, offset, length) {
  let s = '';
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.trim();
}

function readRational(view, offset, littleEndian) {
  const n = view.getUint32(offset, littleEndian);
  const d = view.getUint32(offset + 4, littleEndian);
  if (!d) return n;
  return n / d;
}

function formatTagValue(tag, type, count, valueOff, view, tiffStart, littleEndian) {
  try {
    if (type === 2) {
      const len = count;
      const off =
        len <= 4 ? valueOff : tiffStart + view.getUint32(valueOff, littleEndian);
      return readAscii(view, off, len);
    }
    if (type === 3 && count === 1) {
      return String(view.getUint16(valueOff, littleEndian));
    }
    if (type === 4 && count === 1) {
      return String(view.getUint32(valueOff, littleEndian));
    }
    if (type === 5) {
      const off = tiffStart + view.getUint32(valueOff, littleEndian);
      if (tag === 0x829a) {
        const v = readRational(view, off, littleEndian);
        if (v >= 1) return `${v.toFixed(1)} s`;
        return v > 0 ? `1/${Math.round(1 / v)} s` : String(v);
      }
      if (tag === 0x829d) {
        return `f/${readRational(view, off, littleEndian).toFixed(1)}`;
      }
      if (tag === 0x920a || tag === 0xa405) {
        return `${readRational(view, off, littleEndian).toFixed(1)} mm`;
      }
      if (count === 3) {
        const d = readRational(view, off, littleEndian);
        const m = readRational(view, off + 8, littleEndian);
        const s = readRational(view, off + 16, littleEndian);
        return `${d}°${m}'${s.toFixed(2)}"`;
      }
      return String(readRational(view, off, littleEndian));
    }
  } catch (e) {
    return '';
  }
  return '';
}

function parseIfd(view, tiffStart, ifdOff, littleEndian, tagMap, out) {
  if (ifdOff + 2 > view.byteLength) return null;
  const count = view.getUint16(ifdOff, littleEndian);
  let exifPtr = 0;
  let gpsPtr = 0;
  for (let i = 0; i < count; i++) {
    const entry = ifdOff + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    const num = view.getUint32(entry + 4, littleEndian);
    const valueOff = entry + 8;
    if (tag === 0x8769) {
      exifPtr = view.getUint32(valueOff, littleEndian);
      continue;
    }
    if (tag === 0x8825) {
      gpsPtr = view.getUint32(valueOff, littleEndian);
      continue;
    }
    const label = tagMap[tag];
    if (!label) continue;
    const text = formatTagValue(
      tag,
      type,
      num,
      valueOff,
      view,
      tiffStart,
      littleEndian,
    );
    if (text) out.push({ key: label, value: text, tag });
  }
  return { exifPtr, gpsPtr };
}

function dmsToDeg(dmsStr, ref) {
  const m = /(\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)'(\d+(?:\.\d+)?)"/.exec(dmsStr || '');
  if (!m) return null;
  let deg = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  if (ref === 'S' || ref === 'W') deg = -deg;
  return deg;
}

/** 解析常用 EXIF 字段，供「读取 EXIF」页展示 */
export async function parseJpegExif(filePath) {
  const buf = await readFileArrayBuffer(filePath);
  const view = new DataView(buf);
  if (!isJpeg(view)) {
    return { ok: false, message: '仅支持 JPG / JPEG', entries: [] };
  }
  const bytes = new Uint8Array(buf);
  let off = 2;
  let app1 = null;
  while (off + 4 <= view.byteLength) {
    if (view.getUint8(off) !== 0xff) break;
    const marker = view.getUint16(off);
    if (marker === SOS) break;
    const size = view.getUint16(off + 2);
    if (size < 2) break;
    if (marker === APP1) {
      const sig = String.fromCharCode(
        bytes[off + 4],
        bytes[off + 5],
        bytes[off + 6],
        bytes[off + 7],
      );
      if (sig === 'Exif') {
        app1 = bytes.subarray(off, off + 2 + size);
        break;
      }
    }
    off += 2 + size;
  }
  if (!app1) {
    return {
      ok: true,
      empty: true,
      message: '这张图片没有 EXIF（可能已被社交软件或截图去掉）',
      entries: [],
    };
  }

  const tiff = 10;
  const littleEndian = app1[tiff] === 0x49 && app1[tiff + 1] === 0x49;
  const segView = new DataView(app1.buffer, app1.byteOffset, app1.byteLength);
  if (segView.getUint16(tiff + 2, littleEndian) !== 42) {
    return { ok: false, message: 'EXIF 格式无法识别', entries: [] };
  }
  const ifd0Off = tiff + segView.getUint32(tiff + 4, littleEndian);
  const entries = [];
  const ptr = parseIfd(segView, tiff, ifd0Off, littleEndian, IFD0_TAGS, entries);
  if (ptr && ptr.exifPtr) {
    parseIfd(
      segView,
      tiff,
      tiff + ptr.exifPtr,
      littleEndian,
      EXIF_TAGS,
      entries,
    );
  }
  let gps = null;
  if (ptr && ptr.gpsPtr) {
    const gpsEntries = [];
    parseIfd(
      segView,
      tiff,
      tiff + ptr.gpsPtr,
      littleEndian,
      GPS_TAGS,
      gpsEntries,
    );
    entries.push(...gpsEntries);
    const lat = gpsEntries.find((e) => e.tag === 0x0002);
    const latRef = gpsEntries.find((e) => e.tag === 0x0001);
    const lng = gpsEntries.find((e) => e.tag === 0x0004);
    const lngRef = gpsEntries.find((e) => e.tag === 0x0003);
    if (lat && lng) {
      const la = dmsToDeg(lat.value, (latRef && latRef.value) || 'N');
      const ln = dmsToDeg(lng.value, (lngRef && lngRef.value) || 'E');
      if (la != null && ln != null) gps = { lat: la, lng: ln };
    }
  }

  return {
    ok: true,
    empty: entries.length === 0,
    entries,
    gps,
    message: entries.length ? '' : '未解析到可读的 EXIF 字段',
  };
}
