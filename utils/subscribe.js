import config from '~/config';
import { callFunction } from '~/utils/cloud';

/**
 * 是否应弹出底部引导：发送额度用完（或从未订阅）时弹出
 * 微信官方订阅弹窗必须由用户点击触发，所以先出底部栏再点「开启」
 */
export async function shouldShowNewPackGuide() {
  try {
    const credits = await fetchNewPackSubscribeStatus();
    return !(credits > 0);
  } catch (e) {
    return true;
  }
}

function requestSubscribe(tmplId, type) {
  if (!tmplId) {
    return Promise.reject(new Error('未配置订阅消息模板'));
  }

  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: async (res) => {
        const status = res[tmplId];
        const accepted = status === 'accept' || status === 'acceptWithAlert';
        try {
          if (accepted) {
            const result = await callFunction('userSubscribe', {
              action: 'record',
              type,
              accepted: true,
            });
            resolve({
              accepted: true,
              credits: (result.data && result.data.credits) || 0,
            });
          } else {
            resolve({ accepted: false, status, credits: 0 });
          }
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => reject(err),
    });
  });
}

/** 调起「新品上线提醒」订阅；同意后记一次发送额度（须在 tap 回调里调用） */
export function requestNewPackSubscribe() {
  return requestSubscribe(config.subscribeNewPackTmplId, 'newPack');
}

export function fetchNewPackSubscribeStatus() {
  return callFunction('userSubscribe', { action: 'status', type: 'newPack' }).then(
    (res) => (res.data && res.data.credits) || 0,
  );
}

/** 管理员：接收用户反馈通知 */
export function requestFeedbackNotifySubscribe() {
  return requestSubscribe(config.subscribeFeedbackTmplId, 'feedback');
}

export function fetchFeedbackNotifyStatus() {
  return callFunction('userSubscribe', { action: 'status', type: 'feedback' }).then(
    (res) => (res.data && res.data.credits) || 0,
  );
}
