import config from '~/config';

/** 是否已配置激励视频广告位（未配置则下载不可用） */
export function isDownloadReady() {
  return !!config.rewardedAdUnitId;
}

/**
 * 播放激励视频广告。
 * 未配置广告位：不放行下载（对用户只提示暂无法下载）。
 * @returns {Promise<boolean>} 是否完整观看并可继续保存
 */
export function showRewardedAd() {
  const unitId = config.rewardedAdUnitId;

  if (!unitId) {
    wx.showToast({ title: '暂未配置广告，请先兑换', icon: 'none' });
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const ad = wx.createRewardedVideoAd({ adUnitId: unitId });

    const onClose = (res) => {
      ad.offClose(onClose);
      ad.offError(onError);
      finish(!!(res && res.isEnded));
    };

    const onError = (err) => {
      console.error('[ad]', err);
      ad.offClose(onClose);
      ad.offError(onError);
      wx.showToast({ title: '广告加载失败，请稍后重试', icon: 'none' });
      finish(false);
    };

    ad.onClose(onClose);
    ad.onError(onError);

    ad
      .load()
      .then(() => ad.show())
      .catch(() => {
        ad
          .load()
          .then(() => ad.show())
          .catch(onError);
      });
  });
}
