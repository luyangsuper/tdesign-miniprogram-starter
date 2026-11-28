/**
 * 离屏 Canvas 合成 Pixabot → 本地 PNG/GIF 路径，用 <image> 预览。
 * 动画对齐官网 render.ts：脚固定 + 裁进 32×32。
 * 不把 canvas 挂到页面上，避免原生层错位/空白。
 */
import {
  FRAME_MS,
  LAYER_ORDER,
  LOOP_LENGTH,
  NATIVE_SIZE,
  bounceOffsets,
  getPart,
  hasPaletteTransform,
  normalizePalette,
  partThumbUrl,
  resolveFrameIndex,
} from '~/utils/pixabotParts';
import { encodeGifski } from '~/utils/gifskiEncode';

const pathCache = new Map();
/** @type {{ canvas: any, ctx: any, size: number, imageCache: Map } | null} */
let offscreen = null;

function downloadToTemp(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) resolve(res.tempFilePath);
        else reject(new Error('部件下载失败'));
      },
      fail: (err) => reject(err || new Error('下载失败')),
    });
  });
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e || new Error('图片加载失败'));
    img.src = src;
  });
}

async function ensurePartPath(category, part) {
  const key = `${category}/${part.name}`;
  if (pathCache.has(key)) return pathCache.get(key);
  const url = partThumbUrl(category, part.name);
  const temp = await downloadToTemp(url);
  pathCache.set(key, temp);
  return temp;
}

function ensureOffscreen(size) {
  const s = Math.max(64, Math.min(512, Number(size) || 140));
  if (offscreen && offscreen.size === s && offscreen.canvas && offscreen.ctx) {
    return offscreen;
  }
  if (typeof wx.createOffscreenCanvas !== 'function') {
    throw new Error('当前微信版本过低，无法合成头像');
  }
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: s, height: s });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.imageSmoothingEnabled = false;
  offscreen = { canvas, ctx, size: s, imageCache: new Map() };
  return offscreen;
}

function drawLayer(ctx, layer, bounce, scale, size) {
  if (!layer || !layer.img) return;
  const { img, frames } = layer;
  const fi = Math.max(0, Math.min((frames || 1) - 1, layer.frameIndex || 0));
  const offNative = Math.round(Number(bounce[layer.cat]) || 0);
  const dy = offNative * scale;
  const sx = fi * NATIVE_SIZE;

  if (layer.cat === 'body' && offNative > 0) {
    ctx.drawImage(
      img,
      sx,
      0,
      NATIVE_SIZE,
      NATIVE_SIZE - 1,
      0,
      dy,
      size,
      (NATIVE_SIZE - 1) * scale,
    );
    ctx.drawImage(
      img,
      sx,
      NATIVE_SIZE - 1,
      NATIVE_SIZE,
      1,
      0,
      size - scale,
      size,
      scale,
    );
    return;
  }

  ctx.drawImage(img, sx, 0, NATIVE_SIZE, NATIVE_SIZE, 0, dy, size, size);
}

function rgbToHsl(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h, s, l];
}

function hue2rgb(p, q, t) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** 对齐 sharp.modulate：色相旋转 + 饱和度倍率，保留 alpha，不改背景 */
function applyPaletteToImageData(imageData, palette) {
  if (!hasPaletteTransform(palette)) return;
  const { hue, saturate } = normalizePalette(palette);
  const data = imageData.data;
  const hueTurn = hue / 360;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [h0, s0, l0] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const h1 = (h0 + hueTurn) % 1;
    const s1 = Math.max(0, Math.min(1, s0 * saturate));
    const [r, g, b] = hslToRgb(h1, s1, l0);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

async function drawFrame(session, combo, tick, bg, palette) {
  const { canvas, ctx, size, imageCache } = session;
  const scale = size / NATIVE_SIZE;
  const layers = await Promise.all(
    LAYER_ORDER.map(async (cat) => {
      const idx = Number(combo[cat]) || 0;
      const part = getPart(cat, idx);
      if (!part) return null;
      const cacheKey = `${cat}/${part.name}`;
      let img = imageCache.get(cacheKey);
      if (!img) {
        const temp = await ensurePartPath(cat, part);
        img = await loadCanvasImage(canvas, temp);
        imageCache.set(cacheKey, img);
      }
      return {
        cat,
        frames: part.frames || 1,
        frameIndex: resolveFrameIndex(part, tick),
        img,
      };
    }),
  );

  const bounce = bounceOffsets(tick);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);

  const needPalette = hasPaletteTransform(palette);
  if (!needPalette && bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  layers.forEach((layer) => drawLayer(ctx, layer, bounce, scale, size));
  ctx.restore();

  if (!needPalette) return;

  // 先透明合成再调色，最后铺底，避免底色被 hue 染色（对齐官网 render.ts）
  const imageData = ctx.getImageData(0, 0, size, size);
  applyPaletteToImageData(imageData, palette);
  if (!bg) {
    ctx.putImageData(imageData, 0, 0);
    return;
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const base = ctx.getImageData(0, 0, size, size);
  const tinted = imageData.data;
  const out = base.data;
  for (let i = 0; i < tinted.length; i += 4) {
    const a = tinted[i + 3] / 255;
    if (a <= 0) continue;
    if (a >= 1) {
      out[i] = tinted[i];
      out[i + 1] = tinted[i + 1];
      out[i + 2] = tinted[i + 2];
      out[i + 3] = 255;
      continue;
    }
    out[i] = Math.round(tinted[i] * a + out[i] * (1 - a));
    out[i + 1] = Math.round(tinted[i + 1] * a + out[i + 1] * (1 - a));
    out[i + 2] = Math.round(tinted[i + 2] * a + out[i + 2] * (1 - a));
    out[i + 3] = 255;
  }
  ctx.putImageData(base, 0, 0);
}

function toWritableBuffer(u8) {
  if (!u8) return u8;
  if (u8 instanceof ArrayBuffer) return u8;
  if (u8.buffer instanceof ArrayBuffer) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }
  return u8;
}

function writeFile(path, data) {
  const fsm = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fsm.writeFile({
      filePath: path,
      data,
      success: () => resolve(path),
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '写入失败')),
    });
  });
}

function copyFile(src, dest) {
  const fsm = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fsm.copyFile({
      srcPath: src,
      destPath: dest,
      success: () => resolve(dest),
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '复制失败')),
    });
  });
}

function canvasToPngPath(canvas, size) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      destWidth: size,
      destHeight: size,
      success: async (res) => {
        if (!res.tempFilePath) {
          reject(new Error('导出失败'));
          return;
        }
        // 临时路径常被复用，image 不刷新；落到唯一路径强制跟手更新
        try {
          const outPath = `${wx.env.USER_DATA_PATH}/pixabot_${Date.now()}_${Math.floor(
            Math.random() * 1e6,
          )}.png`;
          resolve(await copyFile(res.tempFilePath, outPath));
        } catch (e) {
          resolve(res.tempFilePath);
        }
      },
      fail: (err) => reject(err || new Error('导出失败')),
    });
  });
}

/**
 * 合成静态 PNG（tick=0）
 * @returns {Promise<string>} 本地路径
 */
export async function renderPixabotPng(combo, opts = {}) {
  const size = Math.max(64, Number(opts.size) || 140);
  const bg = opts.bg || '#f3f4f6';
  const palette = normalizePalette(opts);
  const session = ensureOffscreen(size);
  await drawFrame(session, combo, 0, bg, palette);
  return canvasToPngPath(session.canvas, size);
}

/**
 * 合成一圈动画 GIF
 * @returns {Promise<string>} 本地 .gif 路径
 */
export async function renderPixabotGif(combo, opts = {}) {
  const size = Math.max(64, Number(opts.size) || 140);
  const bg = opts.bg || '#f3f4f6';
  const palette = normalizePalette(opts);
  const session = ensureOffscreen(size);
  const frames = [];
  for (let t = 0; t < LOOP_LENGTH; t += 1) {
    await drawFrame(session, combo, t, bg, palette);
    const imageData = session.ctx.getImageData(0, 0, size, size);
    frames.push(new Uint8Array(imageData.data.buffer.slice(0)));
  }
  // gifski-wasm：repeat >= 0 为有限次（0=只播一遍）；<0 才是无限循环
  const gifU8 = await encodeGifski({
    frames,
    width: size,
    height: size,
    quality: 90,
    frameDurations: frames.map(() => FRAME_MS),
    repeat: -1,
  });
  const outPath = `${wx.env.USER_DATA_PATH}/pixabot_${Date.now()}.gif`;
  await writeFile(outPath, toWritableBuffer(gifU8));
  return outPath;
}
