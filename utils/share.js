/** 右上角 ··· 菜单：转发给朋友 / 分享到朋友圈 / 复制链接 */

const SHARE_MENUS = ['shareAppMessage', 'shareTimeline'];

export const HOME_PATH = '/pages/home/index';
export const DEFAULT_SHARE_TITLE = '趣集 · 发现表情和壁纸合集';

function httpsUrl(url) {
  return url && /^https?:\/\//i.test(url) ? url : '';
}

/** 点亮右上角转发、朋友圈；复制链接随「转发给朋友」一起可用 */
export function showShareMenu() {
  if (typeof wx === 'undefined' || typeof wx.showShareMenu !== 'function') return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: SHARE_MENUS,
  });
}

export function shareAppMessage({ title, path, imageUrl } = {}) {
  const payload = {
    title: title || DEFAULT_SHARE_TITLE,
    path: path || HOME_PATH,
  };
  const cover = httpsUrl(imageUrl);
  if (cover) payload.imageUrl = cover;
  return payload;
}

export function shareTimeline({ title, query, imageUrl } = {}) {
  const payload = {
    title: title || DEFAULT_SHARE_TITLE,
    query: query || '',
  };
  const cover = httpsUrl(imageUrl);
  if (cover) payload.imageUrl = cover;
  return payload;
}
