/**
 * 抽奖邀请 / 结果待办队列（与活动积分礼类似）
 */

function getAckedSet(key) {
  try {
    const app = getApp();
    if (!app.globalData) return new Set();
    if (!app.globalData[key]) app.globalData[key] = [];
    return new Set(app.globalData[key]);
  } catch (e) {
    return new Set();
  }
}

function markAcked(key, ids) {
  try {
    const app = getApp();
    if (!app || !app.globalData) return;
    const prev = Array.isArray(app.globalData[key]) ? app.globalData[key] : [];
    const set = new Set(prev);
    (ids || []).forEach((id) => {
      if (id) set.add(String(id));
    });
    app.globalData[key] = Array.from(set).slice(-200);
  } catch (e) {
    /* ignore */
  }
}

export function markLotteryInvitesAcked(ids) {
  markAcked('ackedLotteryInviteIds', ids);
}

export function markLotteryResultsAcked(ids) {
  markAcked('ackedLotteryResultIds', ids);
}

/** 邀请仍可展示：未确认且未到开奖时间 */
function isInviteActionable(g) {
  if (!g || !g.id || !g.lotteryId) return false;
  const drawAt = Number(g.drawAt) || 0;
  // 已到开奖点的邀请不再弹（未参与者也不应再被催参与）
  if (drawAt > 0 && drawAt <= Date.now()) return false;
  return true;
}

/**
 * @param {Array} pending
 * @param {{ replace?: boolean }} [opts] replace=true 时以服务端列表为准（清掉本地过期项）
 * @returns {boolean} 是否有新增
 */
export function applyPendingLotteryInvites(pending, opts = {}) {
  try {
    // null/undefined 表示本次接口未下发，切勿当成空列表清空
    if (pending == null) return false;
    const app = getApp();
    if (!app || !app.globalData) return false;
    const replace = !!opts.replace;
    const acked = getAckedSet('ackedLotteryInviteIds');
    const incoming = (Array.isArray(pending) ? pending : []).filter(
      (g) => g && g.id && g.lotteryId && !acked.has(String(g.id)) && isInviteActionable(g),
    );

    const cur = Array.isArray(app.globalData.pendingLotteryInvites)
      ? app.globalData.pendingLotteryInvites
      : [];
    const hadIds = new Set(cur.map((g) => g && g.id).filter(Boolean));

    let next;
    if (replace) {
      next = incoming;
    } else {
      if (!incoming.length) {
        // 无增量时仍清掉本地已过期邀请
        const pruned = cur.filter(
          (g) => g && g.id && !acked.has(String(g.id)) && isInviteActionable(g),
        );
        app.globalData.pendingLotteryInvites = pruned;
        return false;
      }
      const map = new Map();
      cur.forEach((g) => {
        if (g && g.id && !acked.has(String(g.id)) && isInviteActionable(g)) {
          map.set(g.id, g);
        }
      });
      incoming.forEach((g) => map.set(g.id, g));
      next = Array.from(map.values());
    }

    app.globalData.pendingLotteryInvites = next;
    const hasNew = next.some((g) => !hadIds.has(g.id));
    if (hasNew && app.eventBus) {
      try {
        app.eventBus.emit('lotteryInvite');
      } catch (e) {
        /* ignore */
      }
    }
    return hasNew;
  } catch (e) {
    return false;
  }
}

/**
 * @param {Array} pending
 * @param {{ replace?: boolean }} [opts]
 * @returns {boolean} 是否有新增
 */
export function applyPendingLotteryResults(pending, opts = {}) {
  try {
    // null/undefined 表示本次接口未下发（如 login），避免误清空参与者结果队列
    if (pending == null) return false;
    const app = getApp();
    if (!app || !app.globalData) return false;
    const replace = !!opts.replace;
    const acked = getAckedSet('ackedLotteryResultIds');
    const incoming = (Array.isArray(pending) ? pending : []).filter(
      (g) => g && g.id && g.lotteryId && !acked.has(String(g.id)),
    );

    const cur = Array.isArray(app.globalData.pendingLotteryResults)
      ? app.globalData.pendingLotteryResults
      : [];
    const hadIds = new Set(cur.map((g) => g && g.id).filter(Boolean));

    let next;
    if (replace) {
      next = incoming;
    } else {
      if (!incoming.length) return false;
      const map = new Map();
      cur.forEach((g) => {
        if (g && g.id && !acked.has(String(g.id))) map.set(g.id, g);
      });
      incoming.forEach((g) => map.set(g.id, g));
      next = Array.from(map.values());
    }

    app.globalData.pendingLotteryResults = next;
    const hasNew = next.some((g) => !hadIds.has(g.id));
    if (hasNew && app.eventBus) {
      try {
        app.eventBus.emit('lotteryResult');
      } catch (e) {
        /* ignore */
      }
    }
    return hasNew;
  } catch (e) {
    return false;
  }
}

export function formatCountdown(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n <= 0) return '即将开奖';
  const sec = Math.floor(n / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

/** 开奖结果系统弹窗（不依赖 t-popup，避免误关） */
export function showLotteryResultModal(result, onClose) {
  if (!result) return;
  const won = !!result.won;
  const pts = Number(result.prizePoints) || 0;
  const title = String(result.title || '开奖结果').slice(0, 16);
  wx.showModal({
    title: title || '开奖结果',
    content: won ? `恭喜中奖 +${pts} 积分，已发放到账户` : '很遗憾，这次未中奖',
    showCancel: false,
    confirmText: '好的',
    success: () => {
      if (typeof onClose === 'function') onClose();
    },
    fail: (err) => {
      // eslint-disable-next-line no-console
      console.error('[lottery] showModal fail', err);
      wx.showToast({
        title: won ? `中奖 +${pts}` : '未中奖',
        icon: 'none',
        duration: 2500,
      });
      if (typeof onClose === 'function') onClose();
    },
  });
}
