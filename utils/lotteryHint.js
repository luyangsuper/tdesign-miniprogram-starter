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

/**
 * @param {Array} pending
 * @returns {boolean} 是否有新增
 */
export function applyPendingLotteryInvites(pending) {
  try {
    const app = getApp();
    if (!app || !app.globalData) return false;
    const acked = getAckedSet('ackedLotteryInviteIds');
    const incoming = (Array.isArray(pending) ? pending : []).filter(
      (g) => g && g.id && g.lotteryId && !acked.has(String(g.id)),
    );
    if (!incoming.length) return false;

    const cur = Array.isArray(app.globalData.pendingLotteryInvites)
      ? app.globalData.pendingLotteryInvites
      : [];
    const hadIds = new Set(cur.map((g) => g && g.id).filter(Boolean));
    const map = new Map();
    cur.forEach((g) => {
      if (g && g.id && !acked.has(String(g.id))) map.set(g.id, g);
    });
    incoming.forEach((g) => map.set(g.id, g));
    const next = Array.from(map.values());
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

export function applyPendingLotteryResults(pending) {
  try {
    const app = getApp();
    if (!app || !app.globalData) return false;
    const acked = getAckedSet('ackedLotteryResultIds');
    const incoming = (Array.isArray(pending) ? pending : []).filter(
      (g) => g && g.id && g.lotteryId && !acked.has(String(g.id)),
    );
    if (!incoming.length) return false;

    const cur = Array.isArray(app.globalData.pendingLotteryResults)
      ? app.globalData.pendingLotteryResults
      : [];
    const hadIds = new Set(cur.map((g) => g && g.id).filter(Boolean));
    const map = new Map();
    cur.forEach((g) => {
      if (g && g.id && !acked.has(String(g.id))) map.set(g.id, g);
    });
    incoming.forEach((g) => map.set(g.id, g));
    const next = Array.from(map.values());
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
