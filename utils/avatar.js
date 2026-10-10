import config from '~/config';

/**
 * 默认头像：Pixabots（https://pixabots.com/browse）
 * 按 openid 哈希固定选一只，再旋转色相，保证不同用户外形+颜色都明显不同
 *
 * 小程序后台 → 开发管理 → 服务器域名 → downloadFile 合法域名：
 *   https://pixabots.com
 * （开发期可勾选「不校验合法域名」）
 */

/** 从 browse / batch 抽样的外形差异较大的 ID */
const PIXABOT_POOL = [
  '2767',
  '516a',
  'b50a',
  '2300',
  '9160',
  'b72b',
  'e620',
  '4534',
  'd327',
  '2352',
  '1125',
  'b169',
  '1467',
  'b228',
  '7409',
  '7550',
  '6518',
  '505b',
  'd764',
  '9306',
  '1036',
  'c238',
  '6702',
  '8515',
  'd63b',
  '5213',
  '7629',
  '0351',
  'e751',
  'b75b',
  '2633',
  '5613',
  '3361',
  '5403',
  '3354',
  '3208',
  '9264',
  '9640',
  'c244',
  'a509',
  'c254',
  '6749',
  'd136',
  '7428',
  '0630',
  '0211',
  'b139',
  '5350',
];

/** 色相桶：间隔拉大，同外形也能一眼区分颜色 */
const HUE_BUCKETS = [0, 35, 70, 110, 150, 190, 230, 275, 315];

function hashString(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isLocalTempPath(url) {
  const u = String(url || '');
  if (!u) return false;
  return (
    u.startsWith('wxfile://') ||
    u.startsWith('http://tmp') ||
    u.startsWith('http://usr') ||
    (!u.includes('://') && !u.startsWith('cloud://'))
  );
}

function isLegacyDicebear(url) {
  return /dicebear\.com/i.test(String(url || ''));
}

/** 由 seed 得到固定的 pixabot id + hue */
export function resolvePixabotParams(seed = '') {
  const s = String(seed || 'guest').trim() || 'guest';
  const h = hashString(s);
  const id = PIXABOT_POOL[h % PIXABOT_POOL.length];
  const hue = HUE_BUCKETS[Math.floor(h / PIXABOT_POOL.length) % HUE_BUCKETS.length];
  return { id, hue };
}

/**
 * @param {string} [seed] openid 或任意稳定字符串
 */
export function getDefaultAvatarUrl(seed = '') {
  const size = Math.max(64, Math.min(480, Number(config.avatarSize) || 128));
  const { id, hue } = resolvePixabotParams(seed);
  const saturate = Number(config.avatarSaturate);
  const sat = Number.isFinite(saturate) && saturate > 0 ? saturate : 1.35;
  const bg = encodeURIComponent(String(config.avatarBg || '#f3f4f6'));
  return `https://pixabots.com/api/pixabot/${id}?size=${size}&hue=${hue}&saturate=${sat}&bg=${bg}`;
}

/**
 * 展示用头像：有自定义（微信头像云文件）用自定义；否则按 openid 固定 Pixabot
 */
export function resolveDisplayAvatarUrl({
  avatarFileID = '',
  avatarUrl = '',
  openid = '',
} = {}) {
  if (avatarFileID) {
    if (avatarUrl && !isLegacyDicebear(avatarUrl)) return avatarUrl;
    return getDefaultAvatarUrl(openid);
  }
  if (avatarUrl && isLocalTempPath(avatarUrl)) return avatarUrl;
  if (avatarUrl && /pixabots\.com\/api\/pixabot\//i.test(avatarUrl)) return avatarUrl;
  // 云临时 https（非 DiceBear）
  if (avatarUrl && /^https?:\/\//i.test(avatarUrl) && !isLegacyDicebear(avatarUrl)) {
    return avatarUrl;
  }
  return getDefaultAvatarUrl(openid);
}
