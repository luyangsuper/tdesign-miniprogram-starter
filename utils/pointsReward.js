/**
 * 积分到账庆祝：优先走页面/组件上的 points-reward，找不到再降级 toast。
 *
 * @param {{
 *   host?: WechatMiniprogram.Component.TrivialInstance | WechatMiniprogram.Page.TrivialInstance | null,
 *   points?: number,
 *   title?: string,
 *   tip?: string,
 *   durationMs?: number,
 *   confetti?: boolean,
 *   vibrate?: boolean,
 * }} [opts]
 */
export function showPointsReward(opts = {}) {
  const points = Math.max(0, Math.floor(Number(opts.points) || 0));
  if (points <= 0) return false;

  const title = String(opts.title || '积分已到账').trim() || '积分已到账';
  const tip = String(opts.tip || '').trim();
  const payload = {
    points,
    title,
    tip,
    durationMs: opts.durationMs,
    confetti: opts.confetti,
    vibrate: opts.vibrate,
  };

  const tryShowOn = (host) => {
    if (!host || typeof host.selectComponent !== 'function') return false;
    const comp = host.selectComponent('#pointsReward');
    if (comp && typeof comp.show === 'function') {
      comp.show(payload);
      return true;
    }
    return false;
  };

  if (tryShowOn(opts.host)) return true;

  try {
    const pages =
      typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    for (let i = pages.length - 1; i >= 0; i -= 1) {
      if (tryShowOn(pages[i])) return true;
    }
  } catch (e) {
    /* ignore */
  }

  wx.showToast({
    title: tip ? `${title} +${points}` : `+${points} 积分`,
    icon: 'success',
  });
  return false;
}
