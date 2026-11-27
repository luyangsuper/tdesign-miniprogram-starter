import { callFunction } from '~/utils/cloud';
import { ensureAlbumAuth, saveRemoteMediaToAlbum } from '~/utils/download';
import {
  getCachedEntitlement,
  setCachedEntitlement,
} from '~/utils/entitlement';
import { downloadCost, resolveLibraryCostKey } from '~/utils/pricing';
import {
  canSaveFormatToAlbum,
  normalizeLibFormat,
  resolveLibraryBillFormat,
  shouldConvertDownloadToGif,
} from '~/utils/library';
import { convertLocalImageToGif } from '~/utils/imageToGif';

async function refundLibraryCharge(fromVip, fromPoints, itemId, onEntitlement) {
  if (!fromVip && !fromPoints) return;
  try {
    const refund = await callFunction('getLibraryDownload', {
      action: 'refund',
      itemId,
      fromVip,
      fromPoints,
    });
    if (refund.entitlement) {
      setCachedEntitlement(refund.entitlement);
      if (typeof onEntitlement === 'function') onEntitlement(refund.entitlement);
    }
  } catch (refundErr) {
    console.warn('[refundLibrary]', refundErr.message || refundErr);
  }
}

function downloadUrlToTemp(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          reject(new Error('下载失败'));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail: (err) =>
        reject(new Error((err && (err.errMsg || err.message)) || '下载失败')),
    });
  });
}

function saveLocalImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: (err) =>
        reject(
          new Error((err && (err.errMsg || err.message)) || '保存到相册失败'),
        ),
    });
  });
}

/**
 * 下载素材库条目某一格式。
 * - 默认 GIF：有原生 gif 直接存；仅有静图则拉原图再转成 GIF（导入微信更清晰）
 * - 用户可改选 WebP / PNG 等原格式
 * gif/webp/png → 相册；lottie/svg → 返回 url 供复制。
 *
 * @param {{ itemId: string, format?: string, item?: object, onEntitlement?: Function, skipAuth?: boolean }} opts
 */
export async function downloadLibraryItem(opts = {}) {
  const itemId = String(opts.itemId || '').trim();
  const uiFormat = normalizeLibFormat(opts.format || 'gif');
  const item = opts.item || null;
  const onEntitlement = opts.onEntitlement;

  if (!itemId) throw new Error('参数错误');

  const billFormat = item
    ? resolveLibraryBillFormat(item, uiFormat)
    : uiFormat;
  const convertToGif = item
    ? shouldConvertDownloadToGif(item, uiFormat)
    : false;

  const saveAlbum = canSaveFormatToAlbum(uiFormat) || convertToGif;
  if (saveAlbum && !opts.skipAuth) {
    await ensureAlbumAuth();
  }

  const res = await callFunction('getLibraryDownload', {
    itemId,
    format: billFormat,
    convertToGif: !!convertToGif,
  });

  const data = res.data || {};
  const url = data.url;
  const fromVip = Number(data.fromVip || 0);
  const fromPoints = Number(data.fromPoints || 0);
  if (!url) throw new Error('未获取到下载链接');

  if (data.entitlement) {
    setCachedEntitlement(data.entitlement);
    if (typeof onEntitlement === 'function') onEntitlement(data.entitlement);
  }

  if (convertToGif) {
    try {
      const temp = await downloadUrlToTemp(url);
      const gifPath = await convertLocalImageToGif(temp);
      await saveLocalImageToAlbum(gifPath);
    } catch (saveErr) {
      await refundLibraryCharge(fromVip, fromPoints, itemId, onEntitlement);
      throw saveErr;
    }
    return {
      mode: 'album',
      format: 'gif',
      converted: true,
      url,
      cost: data.cost,
      fromVip,
      fromPoints,
      entitlement: data.entitlement || getCachedEntitlement(),
    };
  }

  if (saveAlbum || data.saveToAlbum) {
    try {
      await saveRemoteMediaToAlbum(url, 'image');
    } catch (saveErr) {
      await refundLibraryCharge(fromVip, fromPoints, itemId, onEntitlement);
      throw saveErr;
    }
    return {
      mode: 'album',
      format: uiFormat,
      url,
      cost: data.cost,
      fromVip,
      fromPoints,
      entitlement: data.entitlement || getCachedEntitlement(),
    };
  }

  return {
    mode: 'link',
    format: uiFormat,
    url,
    cost: data.cost,
    fromVip,
    fromPoints,
    entitlement: data.entitlement || getCachedEntitlement(),
  };
}

/** @param {string} [format] gif/webp/lottie…；缺省按 gif 对应单价 */
export function libraryUnitCost(format) {
  return downloadCost(resolveLibraryCostKey(format || 'gif'));
}

export function libraryCostKey(format) {
  return resolveLibraryCostKey(format);
}

/** 弹层展示用单价：按实际扣费格式（静图转 GIF 时按原静图价） */
export function libraryUnitCostForItem(item, uiFormat) {
  const bill = item
    ? resolveLibraryBillFormat(item, uiFormat)
    : normalizeLibFormat(uiFormat || 'gif');
  return libraryUnitCost(bill);
}

export function libraryCostKeyForItem(item, uiFormat) {
  const bill = item
    ? resolveLibraryBillFormat(item, uiFormat)
    : normalizeLibFormat(uiFormat || 'gif');
  return libraryCostKey(bill);
}
