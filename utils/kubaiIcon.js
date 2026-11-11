/**
 * Kubai UI 图标：逻辑名 → 远程 SVG（不占主包）
 * API：https://icons.kubai.design/docs/static/
 * 后台需将 icons.kubai.design 加入 downloadFile 合法域名
 */

const KUBAI_ICON_API = 'https://icons.kubai.design/api/icon';
/** 与原先本地 PNG 一致，偏清晰 */
const KUBAI_ICON_SIZE = 96;

/** TDesign / 业务名 → Kubai kebab-case */
const ALIAS = {
  search: 'search',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  close: 'circle-x',
  star: 'star',
  heart: 'heart',
  'heart-filled': 'heart',
  'file-1': 'file',
  secured: 'shield-check',
  image: 'image',
  'view-module': 'layout-dashboard',
  bookmark: 'bookmark',
  gift: 'gift',
  ticket: 'ticket',
  'badge-percent': 'badge-percent',
  sparkles: 'sparkles',
  'root-list': 'list-ordered',
  'play-circle': 'clapperboard',
  notification: 'bell',
  'chart-bar': 'chart-bar',
  upload: 'cloud-upload',
  'view-list': 'list-view',
  'user-vip': 'crown',
  user: 'user',
  refresh: 'rotate-cw',
  mail: 'mail',
  'help-circle': 'circle-help',
  chat: 'message-circle',
  'info-circle': 'info',
  check: 'circle-check',
  'check-circle-filled': 'circle-check',
  circle: 'circle',
  sound: 'volume',
  'sound-mute': 'volume-off',
  palette: 'palette',
  paintbrush: 'paintbrush',
  smile: 'smile',
  sparkles: 'sparkles',
  map: 'map',
  crown: 'crown',
  trophy: 'trophy',
  copy: 'copy',
  download: 'image-down',
  'image-down': 'image-down',
  eye: 'eye',
  'calendar-check': 'calendar-check',
  settings: 'settings',
  play: 'play',
};

const FALLBACK_HEX = '07c160';

/** 过浅色 → 深色，避免白勾/浅勾看不清 */
const LIGHT_ACCENT_TO_ICON = {
  d0a6ff: '7a3db8',
  f9a8d4: 'c9347a',
  '5eead4': '078d85',
  fbbf24: 'd97706',
  a5b4fc: '4f46e5',
  '67e8f9': '0e7490',
  fdba74: 'c2410c',
  '8bb8ff': '2f80ed',
  '6ee7a8': '07c160',
  fca5a5: 'd54941',
  c4b5fd: '6d28d9',
  fda4af: 'e11d48',
  bef264: '65a30d',
  '7dd3fc': '0284c7',
  f0abfc: 'c026d3',
  cbd5e1: '475569',
  fde047: 'ca8a04',
};

export function kubaiName(name) {
  const key = String(name || '').trim();
  return ALIAS[key] || key;
}

function relativeLuminance(hex) {
  const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(n(0)) + 0.7152 * lin(n(2)) + 0.0722 * lin(n(4));
}

export function normalizeKubaiHex(color) {
  const raw = String(color || '').trim();
  if (!raw) return FALLBACK_HEX;
  if (raw.startsWith('var(')) return FALLBACK_HEX;
  if (raw.startsWith('rgba') || raw.startsWith('rgb')) {
    if (/255\s*,\s*255\s*,\s*255/.test(raw)) return 'e5e7eb';
    return 'e5e7eb';
  }
  let hex = raw.replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (hex === 'ffffff') return 'f8fafc';
  if (LIGHT_ACCENT_TO_ICON[hex]) return LIGHT_ACCENT_TO_ICON[hex];
  if (/^[0-9a-f]{6}$/.test(hex) && relativeLuminance(hex) > 0.72) return FALLBACK_HEX;
  return hex;
}

/**
 * 同步返回远程 SVG URL（按色即时着色，无需预生成 PNG）
 * @see https://icons.kubai.design/docs/static/
 */
export function resolveKubaiIconSrc(name, color) {
  const icon = kubaiName(name);
  const hex = normalizeKubaiHex(color);
  return `${KUBAI_ICON_API}/${encodeURIComponent(icon)}.svg?color=${hex}&variant=color&size=${KUBAI_ICON_SIZE}`;
}

/** @deprecated 同 resolveKubaiIconSrc */
export function resolveKubaiIconPngSrc(name, color) {
  return resolveKubaiIconSrc(name, color);
}
