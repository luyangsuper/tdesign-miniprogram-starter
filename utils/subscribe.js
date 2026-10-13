import config from '~/config';
import { callFunction } from '~/utils/cloud';

/**
 * 订阅消息发送时的小程序版本。
 * 开发版/体验版里授权的订阅，必须用 developer/trial 下发，否则会 43101。
 */
export function getSubscribeMpState() {
  try {
    const info = wx.getAccountInfoSync();
    const v = (info && info.miniProgram && info.miniProgram.envVersion) || '';
    if (v === 'develop') return 'developer';
    if (v === 'trial') return 'trial';
  } catch (e) {
    /* ignore */
  }
  return 'formal';
}

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

/**
 * 抽奖提醒：一次拉起「获得抽奖机会」+「中奖结果」两个模板（须在 tap 里调用）
 */
export function requestLotterySubscribe() {
  const inviteId = config.subscribeLotteryInviteTmplId;
  const winId = config.subscribeLotteryWinTmplId;
  const tmplIds = [inviteId, winId].filter(Boolean);
  if (!tmplIds.length) {
    return Promise.reject(new Error('未配置抽奖订阅消息模板'));
  }

  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: async (res) => {
        const out = { invite: null, win: null };
        try {
          if (inviteId) {
            const status = res[inviteId];
            const accepted = status === 'accept' || status === 'acceptWithAlert';
            if (accepted) {
              const result = await callFunction('userSubscribe', {
                action: 'record',
                type: 'lotteryInvite',
                accepted: true,
              });
              out.invite = {
                accepted: true,
                credits: (result.data && result.data.credits) || 0,
              };
            } else {
              out.invite = { accepted: false, status };
            }
          }
          if (winId) {
            const status = res[winId];
            const accepted = status === 'accept' || status === 'acceptWithAlert';
            if (accepted) {
              const result = await callFunction('userSubscribe', {
                action: 'record',
                type: 'lotteryWin',
                accepted: true,
              });
              out.win = {
                accepted: true,
                credits: (result.data && result.data.credits) || 0,
              };
            } else {
              out.win = { accepted: false, status };
            }
          }
          resolve(out);
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => reject(err),
    });
  });
}

export async function fetchLotterySubscribeStatus() {
  const [invite, win] = await Promise.all([
    callFunction('userSubscribe', { action: 'status', type: 'lotteryInvite' }).then(
      (res) => (res.data && res.data.credits) || 0,
    ),
    callFunction('userSubscribe', { action: 'status', type: 'lotteryWin' }).then(
      (res) => (res.data && res.data.credits) || 0,
    ),
  ]);
  return { inviteCredits: invite, winCredits: win };
}

/** 用户可见文案：不拆「邀请/中奖」额度，避免像抽奖次数 */
export function buildLotteryNotifyHint(inviteCredits, winCredits) {
  const total = (Number(inviteCredits) || 0) + (Number(winCredits) || 0);
  if (total > 0) {
    return `提醒已开启，还可收 ${total} 次，点击可加强`;
  }
  return '开启后可收到抽奖邀请和中奖结果';
}
