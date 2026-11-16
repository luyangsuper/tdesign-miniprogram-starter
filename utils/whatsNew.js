/**
 * 版本更新说明：每个 appVersion 只弹一次。
 * 发版时改 APP_VERSION + RELEASES 对应条目即可。
 */

const STORAGE_KEY = 'whats_new_seen_version';

/**
 * 与 package.json version 对齐；发版必改。
 * 未在 RELEASES 里登记的版本不会弹窗。
 */
export const APP_VERSION = '3.3.0';

/**
 * @typedef {{ version: string, title?: string, items: string[] }} WhatsNewRelease
 * @type {WhatsNewRelease[]}
 */
export const RELEASES = [
  {
    version: '3.3.0',
    title: '更新说明',
    items: [
      '静态表情保存时会自动转为透明 GIF，导入微信表情包更清晰、更稳',
      '新增导入方式：保存到相册后，在聊天里发送该图，长按即可「添加为表情」',
    ],
  },
];

function normalizeVersion(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '');
}

export function getSeenWhatsNewVersion() {
  try {
    return normalizeVersion(wx.getStorageSync(STORAGE_KEY));
  } catch (e) {
    return '';
  }
}

export function markWhatsNewSeen(version = APP_VERSION) {
  const v = normalizeVersion(version) || APP_VERSION;
  try {
    wx.setStorageSync(STORAGE_KEY, v);
  } catch (e) {
    /* ignore */
  }
}

/**
 * 当前版本尚未确认过、且 RELEASES 有条目时返回说明；否则 null。
 * 每个版本只弹一次（点「知道了」后写入本地）。
 */
export function getPendingWhatsNew() {
  const current = normalizeVersion(APP_VERSION);
  if (!current) return null;
  if (getSeenWhatsNewVersion() === current) return null;

  const release = RELEASES.find((r) => normalizeVersion(r.version) === current);
  if (!release || !Array.isArray(release.items) || !release.items.length) {
    return null;
  }
  return {
    version: current,
    title: release.title || '更新说明',
    items: release.items.map((t) => String(t || '').trim()).filter(Boolean),
  };
}
