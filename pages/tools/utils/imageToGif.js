/**
 * 本地静图（webp/png/jpg）→ GIF 临时文件
 * 统一走 gifski-wasm（高质量），微信侧经 WXWebAssembly 加载
 *
 * 注意：wx.getImageInfo 对 downloadFile 下来的 webp 常报 fail invalid，
 * 因此用 offscreen canvas + createImage 读尺寸与像素。
 */
import { encodeGifski } from '~/utils/gifskiEncode';

/** gifski quality 1–100：尽量保真，避免额外有损 */
const GIFSKI_QUALITY = 100;
/** 仅防极端大图撑爆内存；素材库表情远小于此，正常不会缩放 */
const SAFETY_MAX_EDGE = 2048;

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

function createWorkCanvas(width, height) {
  if (typeof wx.createOffscreenCanvas === 'function') {
    try {
      return wx.createOffscreenCanvas({ type: '2d', width, height });
    } catch (e) {
      /* fall through */
    }
  }
  throw new Error('当前微信版本过低，无法转为 GIF，请升级后重试');
}

/** 给临时文件补扩展名，部分机型对无后缀路径更挑剔 */
function ensureLocalImagePath(src) {
  const path = String(src || '').trim();
  if (!path) return Promise.reject(new Error('没有可转换的图片'));
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(path)) {
    return Promise.resolve(path);
  }
  const dest = `${wx.env.USER_DATA_PATH}/lib_src_${Date.now()}.webp`;
  const fsm = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fsm.copyFile({
      srcPath: path,
      destPath: dest,
      success: () => resolve(dest),
      fail: () => resolve(path), // 复制失败仍尝试原路径
    });
  });
}

function toWritableBuffer(u8) {
  if (!u8) return u8;
  if (u8 instanceof ArrayBuffer) return u8;
  if (u8.buffer instanceof ArrayBuffer) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }
  return u8;
}

/**
 * @param {string} localPath downloadFile / 本地路径
 * @returns {Promise<string>} 本地 .gif 路径
 */
export async function convertLocalImageToGif(localPath) {
  const src = await ensureLocalImagePath(localPath);

  // 先用 1×1 探针 canvas 创建 Image（不依赖 getImageInfo）
  const probe = createWorkCanvas(1, 1);
  const img = await loadCanvasImage(probe, src);
  const srcW = Math.max(1, Number(img.width) || 1);
  const srcH = Math.max(1, Number(img.height) || 1);

  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > SAFETY_MAX_EDGE ? SAFETY_MAX_EDGE / longEdge : 1;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = createWorkCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = scale < 1;

  // 尺寸变了或需独立 canvas 时重新绘制；探针上的 img 可复用到同源 canvas 族
  let drawImg = img;
  try {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(drawImg, 0, 0, width, height);
  } catch (e) {
    drawImg = await loadCanvasImage(canvas, src);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(drawImg, 0, 0, width, height);
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const rgba = new Uint8Array(imageData.data.buffer.slice(0));

  const gifU8 = await encodeGifski({
    frames: [rgba],
    width,
    height,
    quality: GIFSKI_QUALITY,
    frameDurations: [200],
  });

  const outPath = `${wx.env.USER_DATA_PATH}/lib_${Date.now()}_${width}x${height}.gif`;
  const fsm = wx.getFileSystemManager();
  await new Promise((resolve, reject) => {
    fsm.writeFile({
      filePath: outPath,
      data: toWritableBuffer(gifU8),
      success: resolve,
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '写入 GIF 失败')),
    });
  });
  return outPath;
}
