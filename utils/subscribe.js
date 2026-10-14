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

function isAccepted(status) {
  return status === 'accept' || status === 'acceptWithAlert';
}

async function recordLotteryType(type, status) {
  if (!isAccepted(status)) {
    return { accepted: false, status, credits: 0 };
  }
  const result = await callFunction('userSubscribe', {
    action: 'record',
    type,
    accepted: true,
  });
  return {
    accepted: true,
    status,
    credits: (result.data && result.data.credits) || 0,
  };
}

/**
 * 抽奖提醒（须在 tap 同步调用，中间不能先 await 云函数，否则微信会报订阅失败）
 * @param {{ inviteCredits?: number, winCredits?: number }} [known]
 *   传入页面已缓存的额度：缺哪项就只弹哪项；不传则两项一起弹
 */
export function requestLotterySubscribe(known = {}) {
  const inviteId = config.subscribeLotteryInviteTmplId;
  const winId = config.subscribeLotteryWinTmplId;
  if (!inviteId && !winId) {
    return Promise.reject(new Error('未配置抽奖订阅消息模板'));
  }

  const hasInvite = (Number(known.inviteCredits) || 0) > 0;
  const hasWin = (Number(known.winCredits) || 0) > 0;
  let needInvite = !!inviteId;
  let needWin = !!winId;
  // 仅当调用方传入了已知额度时才做「只补缺」；避免误判
  if (
    known &&
    (known.inviteCredits != null || known.winCredits != null)
  ) {
    if (hasInvite && !hasWin) {
      needInvite = false;
      needWin = !!winId;
    } else if (!hasInvite && hasWin) {
      needInvite = !!inviteId;
      needWin = false;
    }
  }

  const tmplIds = [];
  if (needInvite && inviteId) tmplIds.push(inviteId);
  if (needWin && winId) tmplIds.push(winId);
  if (!tmplIds.length) {
    return Promise.reject(new Error('未配置抽奖订阅消息模板'));
  }

  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: async (res) => {
        try {
          console.log('[lotterySubscribe] wx result', res, { needInvite, needWin });
          const out = {
            invite: needInvite
              ? await recordLotteryType('lotteryInvite', res[inviteId])
              : null,
            win: needWin
              ? await recordLotteryType('lotteryWin', res[winId])
              : null,
          };
          console.log('[lotterySubscribe] recorded', out);
          resolve(out);
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => {
        const msg =
          (err && (err.errMsg || err.message)) || '订阅失败';
        reject(new Error(msg.replace(/^requestSubscribeMessage:fail\s*/i, '') || '订阅失败'));
      },
    });
  });
}

export async function fetchLotterySubscribeStatus() {
  try {
    const res = await callFunction('userSubscribe', { action: 'statusLottery' });
    const data = (res && res.data) || {};
    return {
      inviteCredits: Number(data.inviteCredits) || 0,
      winCredits: Number(data.winCredits) || 0,
    };
  } catch (e) {
    // 兼容未部署 statusLottery 的旧云函数
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
}

/**
 * 文案拆开「发布提醒 / 中奖提醒」，避免只开了中奖却误以为创建抽奖也会微信通知
 */
export function buildLotteryNotifyHint(inviteCredits, winCredits) {
  const invite = Number(inviteCredits) || 0;
  const win = Number(winCredits) || 0;
  if (invite > 0 && win > 0) {
    return `发布提醒 ${invite} 次 · 中奖提醒 ${win} 次，点击可加强`;
  }
  if (invite > 0) {
    return `发布提醒还可收 ${invite} 次；中奖提醒未开，点击补开`;
  }
  if (win > 0) {
    return `中奖提醒还可收 ${win} 次；发布提醒未开（创建抽奖不会微信通知），请再点开启并勾选全部`;
  }
  return '须同时允许「抽奖机会」和「中奖结果」，创建/中奖才会微信提醒';
}

/**
 * 订阅结果 toast
 * @param {object} res requestLotterySubscribe 返回值
 * @param {{ inviteCredits?: number, winCredits?: number }} [totals] 订阅后的总额度（避免「其实已有中奖额度」却提示未授权）
 */
export function lotterySubscribeToast(res, totals = {}) {
  const inviteAsked = !!(res && res.invite);
  const winAsked = !!(res && res.win);
  const inviteOk = !!(res && res.invite && res.invite.accepted);
  const winOk = !!(res && res.win && res.win.accepted);
  const inviteTotal = Number(totals.inviteCredits) || 0;
  const winTotal = Number(totals.winCredits) || 0;

  if (inviteOk && winOk) {
    return { title: '已开启发布与中奖提醒', icon: 'success' };
  }
  if (inviteOk && winTotal > 0) {
    return { title: '已加强发布提醒', icon: 'success' };
  }
  if (winOk && inviteTotal > 0) {
    return { title: '已加强中奖提醒', icon: 'success' };
  }
  if (inviteOk && winTotal <= 0) {
    return { title: '已开发布提醒；中奖未授权', icon: 'none' };
  }
  if (winOk && inviteTotal <= 0) {
    return { title: '已开中奖提醒；发布未授权', icon: 'none' };
  }

  if (winAsked && !inviteAsked) {
    const st = res.win && res.win.status;
    if (st === 'reject') return { title: '中奖提醒被拒绝，去设置打开', icon: 'none' };
    if (st === 'ban') return { title: '中奖提醒被禁用，去设置打开', icon: 'none' };
    return { title: '请在弹窗点允许「中奖结果」', icon: 'none' };
  }
  if (inviteAsked && !winAsked) {
    return { title: '请在弹窗点允许「抽奖机会」', icon: 'none' };
  }

  const invStatus = res && res.invite && res.invite.status;
  const winStatus = res && res.win && res.win.status;
  if (invStatus === 'reject' || winStatus === 'reject') {
    return { title: '已拒绝提醒，可在设置里打开', icon: 'none' };
  }
  if (invStatus === 'ban' || winStatus === 'ban') {
    return { title: '提醒被禁用，请在设置中开启', icon: 'none' };
  }
  if (inviteTotal > 0 || winTotal > 0) {
    return { title: '提醒额度未变化', icon: 'none' };
  }
  return { title: '未授权抽奖提醒', icon: 'none' };
}
