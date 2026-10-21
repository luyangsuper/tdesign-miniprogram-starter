import { callFunction } from '~/utils/cloud';

/** packId → 本地认定的收藏态（含排队中） */
const desired = Object.create(null);
/** packId → 服务端已确认 */
const acked = Object.create(null);
const inflight = Object.create(null);

function emitChange(packId, favorited, extra = {}) {
  try {
    const app = getApp();
    if (app && app.eventBus) {
      app.eventBus.emit('favoriteChange', { packId, favorited, ...extra });
    }
  } catch (e) {
    /* ignore */
  }
}

export function getFavoriteCached(packId) {
  const id = String(packId || '');
  if (!id) return undefined;
  if (Object.prototype.hasOwnProperty.call(desired, id)) return !!desired[id];
  if (Object.prototype.hasOwnProperty.call(acked, id)) return !!acked[id];
  return undefined;
}

export function rememberFavorite(packId, favorited) {
  const id = String(packId || '');
  if (!id) return;
  acked[id] = !!favorited;
  if (!inflight[id]) desired[id] = !!favorited;
}

async function flush(packId) {
  if (inflight[packId]) return;
  inflight[packId] = true;
  try {
    while (desired[packId] !== acked[packId]) {
      const want = !!desired[packId];
      try {
        await callFunction('userFavorite', {
          action: 'set',
          packId,
          favorited: want,
        });
        acked[packId] = want;
      } catch (err) {
        desired[packId] = acked[packId];
        emitChange(packId, !!acked[packId], {
          rollback: true,
          message: (err && err.message) || '收藏失败',
        });
        wx.showToast({
          title: ((err && err.message) || '收藏失败').slice(0, 40),
          icon: 'none',
        });
        break;
      }
    }
  } finally {
    inflight[packId] = false;
  }
}

/**
 * 立刻记下目标态并后台排队同步（同一合集串行，以最后一次为准）
 */
export function queueFavorite(packId, favorited) {
  const id = String(packId || '').trim();
  if (!id) return;
  desired[id] = !!favorited;
  emitChange(id, !!favorited, { optimistic: true });
  flush(id);
}
