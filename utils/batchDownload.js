import { callFunction } from '~/utils/cloud';
import { ensureAlbumAuth, saveRemoteImageToAlbum } from '~/utils/download';
import {
  canAttemptDownload,
  getCachedEntitlement,
  setCachedEntitlement,
} from '~/utils/entitlement';

async function refundDownloadCharge(fromVip, fromPoints, onEntitlement) {
  if (!fromVip && !fromPoints) return;
  try {
    const refund = await callFunction('getEmojiDownload', {
      action: 'refund',
      fromVip,
      fromPoints,
    });
    if (refund.entitlement) {
      setCachedEntitlement(refund.entitlement);
      if (typeof onEntitlement === 'function') onEntitlement(refund.entitlement);
    }
  } catch (refundErr) {
    console.warn('[refundDownload]', refundErr.message || refundErr);
  }
}

/**
 * 下载并保存一张；成功返回扣费信息，失败抛错。
 * @param {{ packId: string, index: number, variant?: 'static'|'anim', skipAuth?: boolean, onEntitlement?: Function, onDownloadCount?: Function }} opts
 */
export async function downloadOne(opts = {}) {
  const packId = opts.packId;
  const index = Number(opts.index);
  const variant = opts.variant === 'anim' ? 'anim' : 'static';
  const onEntitlement = opts.onEntitlement;
  const onDownloadCount = opts.onDownloadCount;

  if (!packId || Number.isNaN(index) || index < 0) {
    throw new Error('参数错误');
  }

  if (!opts.skipAuth) {
    await ensureAlbumAuth();
  }

  const res = await callFunction('getEmojiDownload', {
    packId,
    index,
    variant,
  });

  const url = res.data && res.data.url;
  const fromVip = Number((res.data && res.data.fromVip) || 0);
  const fromPoints = Number((res.data && res.data.fromPoints) || 0);
  if (!url) throw new Error('未获取到下载链接');

  if (res.data.entitlement) {
    setCachedEntitlement(res.data.entitlement);
    if (typeof onEntitlement === 'function') onEntitlement(res.data.entitlement);
  }

  try {
    await saveRemoteImageToAlbum(url);
  } catch (saveErr) {
    await refundDownloadCharge(fromVip, fromPoints, onEntitlement);
    throw saveErr;
  }

  let downloadCount;
  try {
    const report = await callFunction('reportDownload', {
      packId,
      index,
      grantType: (res.data && res.data.grantType) || '',
    });
    downloadCount = report.data && report.data.downloadCount;
    if (typeof downloadCount === 'number' && typeof onDownloadCount === 'function') {
      onDownloadCount(downloadCount, packId);
    }
  } catch (reportErr) {
    console.warn('[reportDownload]', reportErr.message || reportErr);
  }

  return {
    cost: Number((res.data && res.data.cost) || 0),
    fromVip,
    fromPoints,
    grantType: (res.data && res.data.grantType) || '',
    variant,
    downloadCount,
    packId,
    index,
  };
}

/**
 * 跨合集批量下载。
 * @param {{ jobs: Array<{ packId: string, indexes: number[] }>, variant?: 'static'|'anim', onProgress?: Function, onEntitlement?: Function, onDownloadCount?: Function }} opts
 */
export async function runBatchDownload(opts = {}) {
  const variant = opts.variant === 'anim' ? 'anim' : 'static';
  const jobs = Array.isArray(opts.jobs) ? opts.jobs : [];
  const tasks = [];
  jobs.forEach((job) => {
    const packId = job && job.packId;
    const indexes = (job && job.indexes) || [];
    indexes.forEach((index) => {
      tasks.push({ packId, index: Number(index) });
    });
  });

  const total = tasks.length;
  let okCount = 0;
  let failCount = 0;
  let vipSpent = 0;
  let pointsSpent = 0;
  let stoppedByBalance = false;

  if (!total) {
    return {
      okCount,
      failCount,
      vipSpent,
      pointsSpent,
      stoppedByBalance,
      total,
    };
  }

  await ensureAlbumAuth();

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    if (!canAttemptDownload(getCachedEntitlement(), variant)) {
      stoppedByBalance = true;
      break;
    }

    if (typeof opts.onProgress === 'function') {
      opts.onProgress({ current: i + 1, total, packId: task.packId, index: task.index });
    }

    try {
      const stat = await downloadOne({
        packId: task.packId,
        index: task.index,
        variant,
        skipAuth: true,
        onEntitlement: opts.onEntitlement,
        onDownloadCount: opts.onDownloadCount,
      });
      okCount += 1;
      vipSpent += stat.fromVip || 0;
      pointsSpent += stat.fromPoints || 0;
    } catch (err) {
      console.error('[batchDownload]', task.packId, task.index, err);
      failCount += 1;
      const msg = (err && err.message) || '';
      if (/不足|积分|额度|兑换|权益|NO_QUOTA|NO_POINTS/i.test(msg)) {
        stoppedByBalance = true;
        break;
      }
    }
  }

  return {
    okCount,
    failCount,
    vipSpent,
    pointsSpent,
    stoppedByBalance,
    total,
  };
}

/** 汇总批量结果文案 */
export function formatBatchResultTip(stat) {
  const parts = [`成功 ${stat.okCount || 0} 张`];
  if (stat.failCount) parts.push(`失败 ${stat.failCount}`);
  if (stat.skippedPacks) parts.push(`跳过 ${stat.skippedPacks} 个无动态合集`);
  if (stat.stoppedByBalance && (stat.okCount || 0) < (stat.total || 0)) {
    parts.push('余额不足已停止');
  }
  if (stat.vipSpent || stat.pointsSpent) {
    const spend = [];
    if (stat.vipSpent) spend.push(`额度 -${stat.vipSpent} 积分`);
    if (stat.pointsSpent) spend.push(`购买积分 -${stat.pointsSpent}`);
    parts.push(spend.join(' · '));
  }
  return parts.join('，');
}
