/**
 * 图片工具箱共享能力：选图安检、Canvas 处理、导出与保存相册。
 */
import { callFunction, uploadFile } from '~/utils/cloud';
import { ensureAlbumAuth } from '~/utils/download';
import {
  extractJpegMetaSegments,
  normalizeOrientation,
  insertJpegSegments,
  readFileArrayBuffer,
  writeJpegTemp,
} from './jpegExif';

const MAX_BYTES = 10 * 1024 * 1024;
const SAFE_CHECK_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'heic', 'heif'];

function extOf(path) {
  const m = /\.(\w+)(\?|$)/.exec(path || '');
  return (m && m[1] ? m[1] : 'jpg').toLowerCase();
}

function safeUploadExt(ext) {
  if (ext === 'jpeg' || ext === 'jpg' || !ext) return 'jpg';
  if (['png', 'bmp', 'gif'].includes(ext)) return ext;
  return 'jpg';
}

export function createOffscreenCanvas(width, height) {
  const w = Math.max(1, Math.round(width) || 1);
  const h = Math.max(1, Math.round(height) || 1);
  if (typeof wx.createOffscreenCanvas === 'function') {
    try {
      return wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    } catch (e) {
      /* fall through */
    }
  }
  throw new Error('当前微信版本过低，请升级后重试');
}

export function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '读取图片失败')),
    });
  });
}

/** 优先 canvas 读尺寸（webp 更稳），失败再 getImageInfo */
export async function probeImage(src) {
  try {
    const canvas = createOffscreenCanvas(1, 1);
    const img = await loadCanvasImage(canvas, src);
    return {
      width: Math.max(1, Number(img.width) || 1),
      height: Math.max(1, Number(img.height) || 1),
      path: src,
      img,
      canvas,
    };
  } catch (e) {
    const info = await getImageInfo(src);
    return {
      width: Math.max(1, Number(info.width) || 1),
      height: Math.max(1, Number(info.height) || 1),
      path: info.path || src,
      img: null,
      canvas: null,
    };
  }
}

export function fileSize(path) {
  return new Promise((resolve) => {
    try {
      const fsm = wx.getFileSystemManager();
      fsm.getFileInfo({
        filePath: path,
        success: (res) => resolve(Number(res.size) || 0),
        fail: () => resolve(0),
      });
    } catch (e) {
      resolve(0);
    }
  });
}

export function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 上传临时云文件并 mediaCheck；通过后删云文件。
 * @param {string} localPath
 * @param {{ onProgress?: (text: string) => void }} [opts]
 */
export async function securityCheckImage(localPath, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const ext = extOf(localPath);
  if (ext && !SAFE_CHECK_EXTS.includes(ext)) {
    const err = new Error('暂不支持该图片格式，请换一张');
    err.code = 'BAD_FORMAT';
    throw err;
  }
  const safeExt = safeUploadExt(ext);
  const cloudPath = `image-check/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${safeExt}`;
  let fileID = '';
  try {
    onProgress('上传图片中…');
    fileID = await uploadFile(cloudPath, localPath);
    onProgress('安全检测中…');
    return await callFunction(
      'mediaCheck',
      {
        action: 'checkBeadImage',
        fileID,
        scene: 1,
      },
      { timeout: 20000 },
    );
  } catch (e) {
    if (fileID) {
      try {
        await wx.cloud.deleteFile({ fileList: [fileID] });
      } catch (e2) {
        /* ignore */
      }
    }
    throw e;
  }
}

/**
 * @param {{ count?: number, onProgress?: (text: string) => void }} [opts]
 * @returns {Promise<Array<{ path: string, size: number, width: number, height: number }>>}
 */
export function pickCheckedImages(opts = {}) {
  const count = Math.max(1, Math.min(9, Math.floor(Number(opts.count) || 1)));
  const onProgress = opts.onProgress || (() => {});
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      // 原图：裁剪/改尺寸等非压缩工具依赖此保画质；压缩工具再自行降质
      sizeType: ['original'],
      success: async (res) => {
        const files = (res.tempFiles || []).filter((f) => f && f.tempFilePath);
        if (!files.length) {
          reject(new Error('未选择图片'));
          return;
        }
        try {
          const out = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const path = f.tempFilePath;
            const size = Number(f.size) || 0;
            if (size > MAX_BYTES) {
              throw new Error('图片过大，请选小于10MB的图');
            }
            if (files.length > 1) {
              onProgress(`安全检测中（${i + 1}/${files.length}）…`);
            }
            await securityCheckImage(path, { onProgress });
            let width = 0;
            let height = 0;
            try {
              const meta = await probeImage(path);
              width = meta.width;
              height = meta.height;
            } catch (e) {
              /* ignore size */
            }
            out.push({ path, size, width, height });
          }
          resolve(out);
        } catch (e) {
          let msg =
            (e && e.message) ||
            (e && e.errMsg) ||
            '图片未通过安全检测，请更换后重试';
          if (/document\.(set|update)|-5020\d|database collection/i.test(String(msg))) {
            msg = '图片检测服务未就绪，请稍后重试';
          }
          reject(new Error(String(msg)));
        }
      },
      fail: (err) => {
        const msg = (err && (err.errMsg || err.message)) || '';
        if (/cancel/i.test(msg)) {
          reject(Object.assign(new Error('cancel'), { code: 'CANCEL' }));
          return;
        }
        reject(new Error(msg || '选图失败'));
      },
    });
  });
}

/** 最长边：只缩小不放大；edge<=0 表示保持原尺寸 */
function fitSize(srcW, srcH, maxEdge) {
  const w = Math.max(1, srcW);
  const h = Math.max(1, srcH);
  const edge = Math.max(0, Number(maxEdge) || 0);
  if (!edge || Math.max(w, h) <= edge) return { width: w, height: h, scale: 1 };
  const scale = edge / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

async function drawSource(src, destW, destH, opts = {}) {
  const canvas = createOffscreenCanvas(destW, destH);
  canvas.width = destW;
  canvas.height = destH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  const img = await loadCanvasImage(canvas, src);
  const srcW = Math.max(1, Number(img.width) || destW);
  const srcH = Math.max(1, Number(img.height) || destH);
  const sameSize = srcW === destW && srcH === destH;
  // 1:1 拷贝关平滑，避免无故发糊；缩放时开 high，尽量保细节
  if ('imageSmoothingEnabled' in ctx) {
    const smooth = opts.smooth != null ? !!opts.smooth : !sameSize;
    ctx.imageSmoothingEnabled = smooth;
    if (smooth && 'imageSmoothingQuality' in ctx) {
      ctx.imageSmoothingQuality = opts.smoothQuality || 'high';
    }
  }
  ctx.clearRect(0, 0, destW, destH);
  ctx.drawImage(img, 0, 0, destW, destH);
  return { canvas, ctx, img };
}

/**
 * 导出 canvas 为临时文件。jpg 走 toDataURL + 写文件；png 优先 canvasToTempFilePath。
 */
export async function exportCanvasToTemp(canvas, opts = {}) {
  const fileType = String(opts.fileType || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  // png 无损；未指定时 jpg 默认偏高，避免「只改尺寸却发糊」
  const rawQ = Number(opts.quality);
  const quality =
    fileType === 'png'
      ? 1
      : Math.min(1, Math.max(0.1, Number.isFinite(rawQ) ? rawQ : 0.95));
  const width = Math.max(1, Number(canvas.width) || 1);
  const height = Math.max(1, Number(canvas.height) || 1);

  if (fileType === 'jpg' && typeof canvas.toDataURL === 'function') {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const outPath = `${wx.env.USER_DATA_PATH}/imgtool_${Date.now()}_${width}x${height}.jpg`;
    const fsm = wx.getFileSystemManager();
    await new Promise((resolve, reject) => {
      fsm.writeFile({
        filePath: outPath,
        data: base64,
        encoding: 'base64',
        success: resolve,
        fail: (err) =>
          reject(new Error((err && (err.errMsg || err.message)) || '写入失败')),
      });
    });
    return outPath;
  }

  // 离屏 canvas 在部分基础库不支持 canvasToTempFilePath，改走 dataURL
  if (typeof canvas.toDataURL === 'function') {
    const mime = fileType === 'jpg' ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mime, quality);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const outPath = `${wx.env.USER_DATA_PATH}/imgtool_${Date.now()}_${width}x${height}.${fileType}`;
    const fsm = wx.getFileSystemManager();
    await new Promise((resolve, reject) => {
      fsm.writeFile({
        filePath: outPath,
        data: base64,
        encoding: 'base64',
        success: resolve,
        fail: (err) =>
          reject(new Error((err && (err.errMsg || err.message)) || '写入失败')),
      });
    });
    return outPath;
  }

  throw new Error('无法导出图片');
}

export async function compressImage(src, opts = {}) {
  const quality = Math.min(1, Math.max(0.1, Number(opts.quality) || 0.8));
  const maxEdge = Math.max(0, Number(opts.maxEdge) || 1920);
  const probed = await probeImage(src);
  const sized = fitSize(probed.width, probed.height, maxEdge);
  const { canvas } = await drawSource(src, sized.width, sized.height);
  const path = await exportCanvasToTemp(canvas, { fileType: 'jpg', quality });
  const size = await fileSize(path);
  return { path, width: sized.width, height: sized.height, size };
}

export async function resizeImage(src, opts = {}) {
  const probed = await probeImage(src);
  const lock = opts.lockRatio !== false;
  let width = Math.max(1, Math.round(Number(opts.width) || probed.width));
  let height = Math.max(1, Math.round(Number(opts.height) || probed.height));
  if (lock && opts.width && !opts.height) {
    height = Math.max(1, Math.round((width / probed.width) * probed.height));
  } else if (lock && opts.height && !opts.width) {
    width = Math.max(1, Math.round((height / probed.height) * probed.width));
  }
  // 尺寸未变：不重编码，彻底避免发糊
  if (width === probed.width && height === probed.height) {
    const size = await fileSize(probed.path || src);
    return { path: probed.path || src, width, height, size };
  }
  const fileType = String(opts.fileType || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  const quality = Math.min(1, Math.max(0.1, Number(opts.quality) || 1));
  const { canvas } = await drawSource(src, width, height);
  const path = await exportCanvasToTemp(canvas, { fileType, quality });
  const size = await fileSize(path);
  return { path, width, height, size };
}

export async function convertImage(src, opts = {}) {
  const format = String(opts.format || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  const quality = Math.min(
    1,
    Math.max(0.1, Number(opts.quality) || (format === 'jpg' ? 0.95 : 1)),
  );
  const maxEdge = Math.max(0, Number(opts.maxEdge) || 4096);
  const probed = await probeImage(src);
  const sized = fitSize(probed.width, probed.height, maxEdge);
  const { canvas, ctx } = await drawSource(src, sized.width, sized.height);
  if (format === 'jpg') {
    // JPG 无透明：铺白底
    const imgData = ctx.getImageData(0, 0, sized.width, sized.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      d[i] = Math.round(d[i] * a + 255 * (1 - a));
      d[i + 1] = Math.round(d[i + 1] * a + 255 * (1 - a));
      d[i + 2] = Math.round(d[i + 2] * a + 255 * (1 - a));
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }
  const path = await exportCanvasToTemp(canvas, { fileType: format, quality });
  const size = await fileSize(path);
  return { path, width: sized.width, height: sized.height, size, format };
}

/**
 * 按源图像素矩形裁剪导出
 * @param {{ x:number,y:number,w:number,h:number }} rect 相对原图像素
 */
export async function cropImage(src, rect, opts = {}) {
  const probed = await probeImage(src);
  const x = Math.max(0, Math.min(probed.width - 1, Math.round(Number(rect.x) || 0)));
  const y = Math.max(0, Math.min(probed.height - 1, Math.round(Number(rect.y) || 0)));
  const w = Math.max(
    1,
    Math.min(probed.width - x, Math.round(Number(rect.w) || probed.width)),
  );
  const h = Math.max(
    1,
    Math.min(probed.height - y, Math.round(Number(rect.h) || probed.height)),
  );
  const fileType = String(opts.fileType || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  const quality = Math.min(1, Math.max(0.1, Number(opts.quality) || 1));
  const canvas = createOffscreenCanvas(w, h);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  const img = await loadCanvasImage(canvas, src);
  // 裁剪为 1:1 像素拷贝，关平滑以免边缘发糊
  if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const path = await exportCanvasToTemp(canvas, { fileType, quality });
  const size = await fileSize(path);
  return { path, width: w, height: h, size };
}

const WATERMARK_POS = {
  tl: [0.08, 0.12],
  tc: [0.5, 0.12],
  tr: [0.92, 0.12],
  ml: [0.08, 0.5],
  mc: [0.5, 0.5],
  mr: [0.92, 0.5],
  bl: [0.08, 0.88],
  bc: [0.5, 0.88],
  br: [0.92, 0.88],
};

export async function watermarkImage(src, opts = {}) {
  const text = String(opts.text || '').trim() || '水印';
  const tile = !!opts.tile || String(opts.position || '') === 'tile';
  const pos = WATERMARK_POS[opts.position] || WATERMARK_POS.br;
  const opacity = Math.min(1, Math.max(0.05, Number(opts.opacity) || 0.45));
  const color = String(opts.color || '#ffffff');
  const probed = await probeImage(src);
  // sizePct：相对图片宽度；否则用绝对字号
  let fontSize = Math.max(12, Math.round(Number(opts.fontSize) || 36));
  const sizePct = Number(opts.sizePct);
  if (Number.isFinite(sizePct) && sizePct > 0) {
    fontSize = Math.max(12, Math.round((probed.width * sizePct) / 100));
  }
  const { canvas, ctx } = await drawSource(src, probed.width, probed.height);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  if (tile) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const stepX = Math.max(fontSize * 4, Math.round(probed.width / 4));
    const stepY = Math.max(fontSize * 3, Math.round(probed.height / 5));
    ctx.translate(probed.width / 2, probed.height / 2);
    ctx.rotate((-28 * Math.PI) / 180);
    ctx.translate(-probed.width / 2, -probed.height / 2);
    for (let y = -stepY; y < probed.height + stepY; y += stepY) {
      for (let x = -stepX; x < probed.width + stepX; x += stepX) {
        ctx.fillText(text, x, y);
      }
    }
  } else {
    ctx.textAlign =
      pos[0] < 0.34 ? 'left' : pos[0] > 0.66 ? 'right' : 'center';
    ctx.textBaseline =
      pos[1] < 0.34 ? 'top' : pos[1] > 0.66 ? 'bottom' : 'middle';
    ctx.fillText(text, probed.width * pos[0], probed.height * pos[1]);
  }
  ctx.restore();
  const path = await exportCanvasToTemp(canvas, {
    fileType: 'png',
    quality: 1,
  });
  const size = await fileSize(path);
  return { path, width: probed.width, height: probed.height, size };
}

/**
 * 拼接长图（对齐 hahaimage）：
 * - unify=true：统一到最短边（等比缩小）
 * - unify=false：按原尺寸，沿主轴拼接，另一轴取最大并居中
 * - gap / bgColor / fileType
 */
export async function stitchImages(paths, opts = {}) {
  const list = (paths || []).filter(Boolean);
  if (list.length < 2) throw new Error('至少选 2 张图拼接');
  const direction = opts.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const gap = Math.max(0, Math.round(Number(opts.gap) || 0));
  const bg = String(opts.bgColor || '#ffffff');
  const doUnify = opts.unify !== false;
  const fileType = String(opts.fileType || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  const quality = Math.min(1, Math.max(0.1, Number(opts.quality) || (fileType === 'jpg' ? 0.92 : 1)));
  const metas = [];
  for (const p of list) {
    const m = await probeImage(p);
    metas.push({ path: p, width: m.width, height: m.height });
  }

  let drawn;
  let totalW;
  let totalH;

  if (direction === 'vertical') {
    const targetW = doUnify
      ? Math.min(...metas.map((m) => m.width))
      : Math.max(...metas.map((m) => m.width));
    drawn = metas.map((m) => {
      if (doUnify) {
        const scale = targetW / m.width;
        return {
          ...m,
          dw: targetW,
          dh: Math.max(1, Math.round(m.height * scale)),
          ox: 0,
        };
      }
      return { ...m, dw: m.width, dh: m.height, ox: Math.round((targetW - m.width) / 2) };
    });
    totalW = targetW;
    totalH = drawn.reduce((s, d) => s + d.dh, 0) + gap * (drawn.length - 1);
  } else {
    const targetH = doUnify
      ? Math.min(...metas.map((m) => m.height))
      : Math.max(...metas.map((m) => m.height));
    drawn = metas.map((m) => {
      if (doUnify) {
        const scale = targetH / m.height;
        return {
          ...m,
          dw: Math.max(1, Math.round(m.width * scale)),
          dh: targetH,
          oy: 0,
        };
      }
      return { ...m, dw: m.width, dh: m.height, oy: Math.round((targetH - m.height) / 2) };
    });
    totalH = targetH;
    totalW = drawn.reduce((s, d) => s + d.dw, 0) + gap * (drawn.length - 1);
  }

  const canvas = createOffscreenCanvas(totalW, totalH);
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  if ('imageSmoothingEnabled' in ctx) {
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  }
  if (bg === 'transparent') {
    ctx.clearRect(0, 0, totalW, totalH);
  } else {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, totalW, totalH);
  }
  let cursor = 0;
  for (const d of drawn) {
    const img = await loadCanvasImage(canvas, d.path);
    if (direction === 'horizontal') {
      ctx.drawImage(img, cursor, d.oy || 0, d.dw, d.dh);
      cursor += d.dw + gap;
    } else {
      ctx.drawImage(img, d.ox || 0, cursor, d.dw, d.dh);
      cursor += d.dh + gap;
    }
  }
  const outType = bg === 'transparent' ? 'png' : fileType;
  const path = await exportCanvasToTemp(canvas, {
    fileType: outType,
    quality: outType === 'jpg' ? quality : 1,
  });
  const size = await fileSize(path);
  return { path, width: totalW, height: totalH, size };
}

/** 旋转 / 翻转 */
export async function rotateImage(src, opts = {}) {
  const deg = ((Number(opts.rotate) || 0) % 360 + 360) % 360;
  const flipH = !!opts.flipH;
  const flipV = !!opts.flipV;
  const probed = await probeImage(src);
  const swap = deg === 90 || deg === 270;
  const outW = swap ? probed.height : probed.width;
  const outH = swap ? probed.width : probed.height;
  const canvas = createOffscreenCanvas(outW, outH);
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
  const img = await loadCanvasImage(canvas, src);
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, -probed.width / 2, -probed.height / 2);
  ctx.restore();
  const path = await exportCanvasToTemp(canvas, { fileType: 'png', quality: 1 });
  const size = await fileSize(path);
  return { path, width: outW, height: outH, size };
}

/** 圆角（透明底 PNG） */
export async function roundCornerImage(src, opts = {}) {
  const probed = await probeImage(src);
  const maxR = Math.floor(Math.min(probed.width, probed.height) / 2);
  const radius = Math.max(
    0,
    Math.min(maxR, Math.round(Number(opts.radius) || 0)),
  );
  const canvas = createOffscreenCanvas(probed.width, probed.height);
  canvas.width = probed.width;
  canvas.height = probed.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  const img = await loadCanvasImage(canvas, src);
  ctx.clearRect(0, 0, probed.width, probed.height);
  if (radius <= 0) {
    ctx.drawImage(img, 0, 0);
  } else {
    const w = probed.width;
    const h = probed.height;
    const r = radius;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.clip();
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
  }
  const path = await exportCanvasToTemp(canvas, { fileType: 'png', quality: 1 });
  const size = await fileSize(path);
  return { path, width: probed.width, height: probed.height, size };
}

export async function splitImage(src, opts = {}) {
  // 自定义行列：1～12（过多张保存相册体验差，上限卡一下）
  const rows = Math.max(1, Math.min(12, Math.round(Number(opts.rows) || 3)));
  const cols = Math.max(1, Math.min(12, Math.round(Number(opts.cols) || 3)));
  const probed = await probeImage(src);
  const cellW = Math.floor(probed.width / cols);
  const cellH = Math.floor(probed.height / rows);
  if (cellW < 1 || cellH < 1) throw new Error('图片太小，无法分割');
  const pieces = [];
  const canvas = createOffscreenCanvas(cellW, cellH);
  const img = await loadCanvasImage(canvas, src);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      canvas.width = cellW;
      canvas.height = cellH;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, cellW, cellH);
      if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        c * cellW,
        r * cellH,
        cellW,
        cellH,
        0,
        0,
        cellW,
        cellH,
      );
      const path = await exportCanvasToTemp(canvas, {
        fileType: 'png',
        quality: 1,
      });
      const size = await fileSize(path);
      pieces.push({
        path,
        width: cellW,
        height: cellH,
        size,
        row: r,
        col: c,
      });
    }
  }
  return { pieces, rows, cols, cellW, cellH };
}

/** 二分质量压到目标字节；不够再降最长边 */
export async function compressToTargetSize(src, opts = {}) {
  const targetBytes = Math.max(8 * 1024, Number(opts.targetBytes) || 200 * 1024);
  let maxEdge = Math.max(320, Number(opts.maxEdge) || 2048);
  const probed = await probeImage(src);
  let best = null;

  for (let shrink = 0; shrink < 6; shrink++) {
    const sized = fitSize(probed.width, probed.height, maxEdge);
    let lo = 0.2;
    let hi = 0.95;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const { canvas } = await drawSource(src, sized.width, sized.height);
      const path = await exportCanvasToTemp(canvas, {
        fileType: 'jpg',
        quality: mid,
      });
      const size = await fileSize(path);
      const cand = {
        path,
        width: sized.width,
        height: sized.height,
        size,
        quality: mid,
      };
      if (!best || Math.abs(size - targetBytes) < Math.abs(best.size - targetBytes)) {
        best = cand;
      }
      if (size > targetBytes) hi = mid;
      else lo = mid;
      if (size <= targetBytes && size >= targetBytes * 0.85) {
        return cand;
      }
    }
    if (best && best.size <= targetBytes) return best;
    maxEdge = Math.max(240, Math.round(maxEdge * 0.75));
  }
  if (!best) throw new Error('压缩失败');
  return best;
}

/**
 * 压缩 JPG 并保留 EXIF / ICC（对齐 hahaimage compressJpegKeepExif）
 */
export async function compressJpegKeepExif(src, opts = {}) {
  const origBuf = await readFileArrayBuffer(src);
  const head = new DataView(origBuf);
  if (!(head.byteLength > 4 && head.getUint16(0) === 0xffd8)) {
    throw new Error('仅支持 JPG / JPEG');
  }
  const compressed = await compressImage(src, {
    quality: Math.min(1, Math.max(0.1, Number(opts.quality) || 0.8)),
    maxEdge: Math.max(0, Number(opts.maxEdge) || 0),
  });
  const newBuf = await readFileArrayBuffer(compressed.path);
  const segments = extractJpegMetaSegments(origBuf).map((seg) => {
    const copy = new Uint8Array(seg);
    if (copy[1] === 0xe1) normalizeOrientation(copy);
    return copy;
  });
  const merged = insertJpegSegments(new Uint8Array(newBuf), segments);
  const path = await writeJpegTemp(merged);
  const size = await fileSize(path);
  return {
    path,
    width: compressed.width,
    height: compressed.height,
    size,
    keptExif: segments.length > 0,
  };
}

/** 图片水印（透明 PNG 更佳） */
export async function watermarkWithImage(src, wmPath, opts = {}) {
  const tile = !!opts.tile || String(opts.position || '') === 'tile';
  const pos = WATERMARK_POS[opts.position] || WATERMARK_POS.br;
  const opacity = Math.min(1, Math.max(0.05, Number(opts.opacity) || 0.45));
  const sizePct = Math.max(2, Math.min(40, Number(opts.sizePct) || 12));
  const probed = await probeImage(src);
  const { canvas, ctx } = await drawSource(src, probed.width, probed.height);
  const wm = await loadCanvasImage(canvas, wmPath);
  const ww = Math.max(8, Math.round((probed.width * sizePct) / 100));
  const wh = Math.max(8, Math.round((wm.height * ww) / Math.max(1, wm.width)));
  ctx.save();
  ctx.globalAlpha = opacity;
  if (tile) {
    for (let y = 0; y < probed.height; y += wh * 2) {
      for (let x = 0; x < probed.width; x += ww * 2) {
        ctx.drawImage(wm, x, y, ww, wh);
      }
    }
  } else {
    const x =
      pos[0] < 0.34
        ? probed.width * 0.04
        : pos[0] > 0.66
          ? probed.width * 0.96 - ww
          : (probed.width - ww) / 2;
    const y =
      pos[1] < 0.34
        ? probed.height * 0.04
        : pos[1] > 0.66
          ? probed.height * 0.96 - wh
          : (probed.height - wh) / 2;
    ctx.drawImage(wm, x, y, ww, wh);
  }
  ctx.restore();
  const path = await exportCanvasToTemp(canvas, { fileType: 'png', quality: 1 });
  const size = await fileSize(path);
  return { path, width: probed.width, height: probed.height, size };
}

export async function saveLocalImageToAlbum(filePath) {
  if (!filePath) throw new Error('没有可保存的图片');
  await ensureAlbumAuth();
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) =>
        reject(
          new Error((err && (err.errMsg || err.message)) || '保存到相册失败'),
        ),
    });
  });
}
