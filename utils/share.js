/** 右上角 ··· 菜单：转发给朋友 / 分享到朋友圈 / 复制链接 */

const SHARE_MENUS = ['shareAppMessage', 'shareTimeline'];

export const HOME_PATH = '/pages/home/index';
export const DEFAULT_SHARE_TITLE = '趣图铺子 · 发现表情、壁纸、头像和视频合集';
/** 代码包内品牌图；未传 imageUrl / 非 http(s) 时用作默认封面 */
export const DEFAULT_SHARE_IMAGE = '/static/brand/logo.png';

function resolveShareImage(url) {
  const raw = String(url || '').trim();
  if (!raw) return DEFAULT_SHARE_IMAGE;
  if (/^https?:\/\//i.test(raw)) return raw;
  // 代码包路径 / 本地临时文件可用；cloud:// 等不可作封面
  if (raw.startsWith('/') || raw.startsWith('wxfile://')) return raw;
  return DEFAULT_SHARE_IMAGE;
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
  return {
    title: title || DEFAULT_SHARE_TITLE,
    path: path || HOME_PATH,
    imageUrl: resolveShareImage(imageUrl),
  };
}

export function shareTimeline({ title, query, imageUrl } = {}) {
  return {
    title: title || DEFAULT_SHARE_TITLE,
    query: query || '',
    imageUrl: resolveShareImage(imageUrl),
  };
}
