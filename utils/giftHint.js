import config from '~/config';
import { downloadCost } from '~/utils/pricing';

/** 见面礼文案：约可存几张 */
export function formatGiftAffordLine(points) {
  const n = Math.max(0, Number(points) || 0);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const staticN = staticCost > 0 ? Math.floor(n / staticCost) : 0;
  const animN = animCost > 0 ? Math.floor(n / animCost) : 0;
  return `约可存 ${staticN} 张静态 · ${animN} 张动态`;
}

export function defaultWelcomeGiftPoints() {
  return Math.max(0, Number(config.welcomeGiftPoints) || 18);
}

export function defaultCheckinPoints() {
  return Math.max(0, Number(config.checkinPoints) || 1);
}

/**
 * 多笔待弹活动礼合并为一次展示文案（避免连环弹窗）。
 * @param {Array<{ id?: string, title?: string, points?: number }>} list
 */
export function summarizePendingPointGifts(list) {
  const gifts = (Array.isArray(list) ? list : []).filter(
    (g) => g && g.id && Number(g.points) > 0,
  );
  const ids = gifts.map((g) => g.id);
  const total = gifts.reduce((sum, g) => sum + (Number(g.points) || 0), 0);
  const count = gifts.length;
  if (!count) {
    return {
      ids: [],
      total: 0,
      count: 0,
      title: '活动奖励到账',
      tip: '感谢参与趣集活动',
      affordLine: formatGiftAffordLine(0),
    };
  }
  if (count === 1) {
    return {
      ids,
      total,
      count,
      title: gifts[0].title || '活动奖励',
      tip: '感谢参与趣集活动',
      affordLine: formatGiftAffordLine(total),
    };
  }
  const names = gifts.map((g) => String(g.title || '活动').trim()).filter(Boolean);
  const shown = names.slice(0, 2);
  const tip =
    shown.length >= names.length
      ? `含「${shown.join('」「')}」共 ${count} 项`
      : `含「${shown.join('」「')}」等 ${count} 项`;
  return {
    ids,
    total,
    count,
    title: '活动奖励到账',
    tip,
    affordLine: formatGiftAffordLine(total),
  };
}

/**
 * 合并服务端待展示活动积分礼，有新增时通知首页弹窗。
 * @param {Array<{ id?: string, title?: string, points?: number }>} pending
 * @returns {boolean} 是否有新增待弹
 */
/** 本会话已确认的活动礼，避免 ack 未落库时轮询又弹回来 */
function getAckedGiftIdSet() {
  try {
    const app = getApp();
    if (!app.globalData) return new Set();
    if (!app.globalData.ackedActivityGiftIds) {
      app.globalData.ackedActivityGiftIds = [];
    }
    return new Set(app.globalData.ackedActivityGiftIds);
  } catch (e) {
    return new Set();
  }
}

export function markActivityGiftsAcked(ids) {
  try {
    const app = getApp();
    if (!app || !app.globalData) return;
    const prev = Array.isArray(app.globalData.ackedActivityGiftIds)
      ? app.globalData.ackedActivityGiftIds
      : [];
    const set = new Set(prev);
    (ids || []).forEach((id) => {
      if (id) set.add(String(id));
    });
    // 控制长度，避免无限涨
    app.globalData.ackedActivityGiftIds = Array.from(set).slice(-200);
  } catch (e) {
    /* ignore */
  }
}

export function applyPendingPointGifts(pending) {
  try {
    const app = getApp();
    if (!app || !app.globalData) return false;
    const acked = getAckedGiftIdSet();
    const incoming = (Array.isArray(pending) ? pending : []).filter(
      (g) => g && g.id && Number(g.points) > 0 && !acked.has(String(g.id)),
    );
    if (!incoming.length) return false;

    const cur = Array.isArray(app.globalData.pendingActivityGifts)
      ? app.globalData.pendingActivityGifts
      : [];
    const hadIds = new Set(cur.map((g) => g && g.id).filter(Boolean));
    const map = new Map();
    cur.forEach((g) => {
      if (g && g.id && !acked.has(String(g.id))) map.set(g.id, g);
    });
    incoming.forEach((g) => map.set(g.id, g));
    const next = Array.from(map.values());
    app.globalData.pendingActivityGifts = next;

    const hasNew = next.some((g) => !hadIds.has(g.id));
    if (hasNew && app.eventBus) {
      try {
        app.eventBus.emit('activityGift');
      } catch (e) {
        /* ignore */
      }
    }
    return hasNew;
  } catch (e) {
    return false;
  }
}
