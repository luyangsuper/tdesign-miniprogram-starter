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
} from './library';
import { convertLocalImageToGif } from './imageToGif';

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

  const color = String(opts.color || '').trim().toLowerCase();
  const res = await callFunction('getLibraryDownload', {
    itemId,
    format: billFormat,
    convertToGif: !!convertToGif,
    ...(color ? { color } : {}),
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

/**
 * 扣费后下载到本地临时文件，供发给好友（不写相册）。
 * 失败自动退款。
 */
export async function prepareLibraryItemTempFile(opts = {}) {
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

  const color = String(opts.color || '').trim().toLowerCase();
  const res = await callFunction('getLibraryDownload', {
    itemId,
    format: billFormat,
    convertToGif: !!convertToGif,
    ...(color ? { color } : {}),
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

  try {
    let filePath = await downloadUrlToTemp(url);
    let outFormat = uiFormat;
    if (convertToGif || uiFormat === 'gif') {
      if (convertToGif) {
        filePath = await convertLocalImageToGif(filePath);
      }
      outFormat = 'gif';
    }
    const base =
      String((item && item.name) || itemId)
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 40) || 'emoji';
    const fileName = `${base}.${outFormat === 'gif' ? 'gif' : outFormat}`;
    return {
      filePath,
      fileName,
      format: outFormat,
      cost: data.cost,
      fromVip,
      fromPoints,
      entitlement: data.entitlement || getCachedEntitlement(),
    };
  } catch (err) {
    await refundLibraryCharge(fromVip, fromPoints, itemId, onEntitlement);
    throw err;
  }
}

/**
 * 发给好友：优先图片分享菜单（GIF 体验更好），否则退回文件分享
 */
export function shareTempFileToFriend(filePath, fileName) {
  return new Promise((resolve, reject) => {
    const fail = (err) =>
      reject(new Error((err && (err.errMsg || err.message)) || '发送失败'));
    if (typeof wx.showShareImageMenu === 'function') {
      wx.showShareImageMenu({
        path: filePath,
        success: resolve,
        fail: (err) => {
          const msg = String((err && err.errMsg) || '');
          if (/cancel|取消/i.test(msg)) {
            fail(err);
            return;
          }
          // 菜单不可用时再试文件分享
          if (typeof wx.shareFileMessage !== 'function') {
            fail(err);
            return;
          }
          wx.shareFileMessage({
            filePath,
            fileName: fileName || 'emoji.gif',
            success: resolve,
            fail,
          });
        },
      });
      return;
    }
    if (typeof wx.shareFileMessage !== 'function') {
      reject(new Error('当前微信版本不支持发送'));
      return;
    }
    wx.shareFileMessage({
      filePath,
      fileName: fileName || 'emoji.gif',
      success: resolve,
      fail,
    });
  });
}

/**
 * 扣费 → 落地临时 GIF → 选联系人发送；发送失败（非取消）退款
 */
export async function shareLibraryItemToFriend(opts = {}) {
  const itemId = String(opts.itemId || '').trim();
  const prepared = await prepareLibraryItemTempFile(opts);
  try {
    await shareTempFileToFriend(prepared.filePath, prepared.fileName);
    return prepared;
  } catch (err) {
    // 取消选人或发送失败都退款（未真正发出）
    await refundLibraryCharge(
      prepared.fromVip,
      prepared.fromPoints,
      itemId,
      opts.onEntitlement,
    );
    throw err;
  }
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
