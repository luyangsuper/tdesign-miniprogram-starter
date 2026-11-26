/**
 * 本地静图（webp/png/jpg）→ 单帧 GIF 临时文件
 * 用于素材库默认保存：导入微信时 GIF 较少被压糊
 */
import { encodeGifFromImageData } from '~/utils/gifEncode';

const MAX_EDGE = 512;

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '读取图片失败')),
    });
  });
}

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

/**
 * @param {string} localPath downloadFile / 本地路径
 * @returns {Promise<string>} 本地 .gif 路径
 */
export async function convertLocalImageToGif(localPath) {
  const src = String(localPath || '').trim();
  if (!src) throw new Error('没有可转换的图片');

  const info = await getImageInfo(src);
  const srcW = Math.max(1, Number(info.width) || 1);
  const srcH = Math.max(1, Number(info.height) || 1);
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = createWorkCanvas(width, height);
  // 部分基础库需再设宽高
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  const img = await loadCanvasImage(canvas, src);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const gifBuf = encodeGifFromImageData(imageData);

  const outPath = `${wx.env.USER_DATA_PATH}/lib_${Date.now()}_${width}x${height}.gif`;
  const fsm = wx.getFileSystemManager();
  await new Promise((resolve, reject) => {
    fsm.writeFile({
      filePath: outPath,
      data: gifBuf,
      success: resolve,
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '写入 GIF 失败')),
    });
  });
  return outPath;
}
