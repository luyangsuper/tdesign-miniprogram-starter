import config from '~/config';

/**
 * 默认头像：DiceBear 开源库（MIT）
 * https://www.dicebear.com/ — 同 seed 永远同一张图
 * 风格默认 fun-emoji（可爱表情脸），可在 config.avatarStyle 改成 lorelei / adventurer 等
 *
 * 注意：微信小程序需在后台把 api.dicebear.com 加到「downloadFile 合法域名」
 * （开发阶段可勾选「不校验合法域名」）
 */
export function getDefaultAvatarUrl(seed = '') {
  const s = String(seed || 'guest').trim() || 'guest';
  const style = String(config.avatarStyle || 'fun-emoji').trim() || 'fun-emoji';
  const size = Number(config.avatarSize) || 128;
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/png?seed=${encodeURIComponent(
    s,
  )}&size=${size}`;
}

/**
 * 展示用头像：有自定义（微信头像云文件）用自定义；否则按 openid 固定随机默认图
 */
export function resolveDisplayAvatarUrl({
  avatarFileID = '',
  avatarUrl = '',
  openid = '',
} = {}) {
  if (avatarFileID) {
    return avatarUrl || getDefaultAvatarUrl(openid);
  }
  // 刚选完微信头像、尚未上传完的本地临时路径
  if (avatarUrl) return avatarUrl;
  return getDefaultAvatarUrl(openid);
}
