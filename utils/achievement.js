import { callFunction } from '~/utils/cloud';

/**
 * 懒同步成就（签到 / 下载 / 付费后调用）。失败静默。
 * @returns {Promise<{ newly: Array }|null>}
 */
export async function syncAchievements(options = {}) {
  try {
    const res = await callFunction('userAchievement', {
      action: 'sync',
      ...(options || {}),
    });
    const data = (res && res.data) || {};
    const newly = Array.isArray(data.newly) ? data.newly : [];
    if (newly.length && options.toast !== false) {
      const titles = newly
        .map((n) => n.title)
        .filter(Boolean)
        .slice(0, 2);
      wx.showToast({
        title: titles.length
          ? `解锁：${titles.join('、')}`
          : `解锁 ${newly.length} 个头像框`,
        icon: 'none',
        duration: 2200,
      });
    }
    return data;
  } catch (e) {
    console.warn('[achievement] sync', e && e.message);
    return null;
  }
}

export async function listAchievements() {
  const res = await callFunction('userAchievement', { action: 'list' });
  return (res && res.data) || {};
}

export async function equipAvatarFrame(frameId) {
  const res = await callFunction('userAchievement', {
    action: frameId ? 'equip' : 'unequip',
    frameId: frameId || '',
  });
  return (res && res.data) || {};
}
