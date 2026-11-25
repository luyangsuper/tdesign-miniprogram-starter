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
} from '~/utils/library';

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

/**
 * 下载素材库条目某一格式。
 * gif/webp → 相册；lottie/svg → 返回 url 供复制。
 */
export async function downloadLibraryItem(opts = {}) {
  const itemId = String(opts.itemId || '').trim();
  const format = normalizeLibFormat(opts.format || 'gif');
  const onEntitlement = opts.onEntitlement;

  if (!itemId) throw new Error('参数错误');

  const saveAlbum = canSaveFormatToAlbum(format);
  if (saveAlbum && !opts.skipAuth) {
    await ensureAlbumAuth();
  }

  const res = await callFunction('getLibraryDownload', {
    itemId,
    format,
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

  if (saveAlbum || data.saveToAlbum) {
    try {
      await saveRemoteMediaToAlbum(url, 'image');
    } catch (saveErr) {
      await refundLibraryCharge(fromVip, fromPoints, itemId, onEntitlement);
      throw saveErr;
    }
    return {
      mode: 'album',
      format,
      url,
      cost: data.cost,
      fromVip,
      fromPoints,
      entitlement: data.entitlement || getCachedEntitlement(),
    };
  }

  return {
    mode: 'link',
    format,
    url,
    cost: data.cost,
    fromVip,
    fromPoints,
    entitlement: data.entitlement || getCachedEntitlement(),
  };
}

/** @param {string} [format] gif/webp/lottie…；缺省按动图价展示 */
export function libraryUnitCost(format) {
  return downloadCost(resolveLibraryCostKey(format || 'gif'));
}

export function libraryCostKey(format) {
  return resolveLibraryCostKey(format);
}
