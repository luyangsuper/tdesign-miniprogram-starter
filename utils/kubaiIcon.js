/**
 * Kubai UI 图标
 * - 接口返回 SVG；小程序 <image> 不支持网络 SVG，需 downloadFile 落到本地后再显示
 * - 后台把 icons.kubai.design 加入 downloadFile 合法域名（开发期可勾选不校验）
 * @see https://icons.kubai.design/docs/static/
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
  file: 'file',
  secured: 'shield-check',
  image: 'image',
  film: 'clapperboard',
  clapperboard: 'clapperboard',
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
  minus: 'circle-minus',
  plus: 'circle-plus',
  'circle-minus': 'circle-minus',
  'circle-plus': 'circle-plus',
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
  /** layout-grid 在 Kubai 无资源，改用 layout-dashboard */
  grid: 'layout-dashboard',
  'layout-grid': 'layout-dashboard',
  'layout-dashboard': 'layout-dashboard',
  'shield-check': 'shield-check',
  paintbrush: 'paintbrush',
  smile: 'smile',
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
  timer: 'timer',
  clock: 'clock',
};

const FALLBACK_HEX = '07c160';

/** 过浅色 → 深色，避免白勾/浅勾看不清（不含有意的白/浅灰） */
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

/** 有意保留的浅色（按钮上的白图标等），不再被亮度规则改成品牌绿 */
const KEEP_LIGHT_HEX = {
  ffffff: 'f8fafc',
  f8fafc: 'f8fafc',
  f1f5f9: 'f1f5f9',
  e5e7eb: 'e5e7eb',
  e2e8f0: 'e2e8f0',
};

const memCache = Object.create(null);
const inflight = Object.create(null);

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
    if (/255\s*,\s*255\s*,\s*255/.test(raw)) return KEEP_LIGHT_HEX.ffffff;
    return 'e5e7eb';
  }
  let hex = raw.replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/.test(hex)) return FALLBACK_HEX;
  if (KEEP_LIGHT_HEX[hex]) return KEEP_LIGHT_HEX[hex];
  if (LIGHT_ACCENT_TO_ICON[hex]) return LIGHT_ACCENT_TO_ICON[hex];
  if (relativeLuminance(hex) > 0.72) return FALLBACK_HEX;
  return hex;
}

export function buildKubaiIconUrl(name, color) {
  const icon = kubaiName(name);
  const hex = normalizeKubaiHex(color);
  return `${KUBAI_ICON_API}/${encodeURIComponent(icon)}.svg?color=${hex}&variant=color&size=${KUBAI_ICON_SIZE}`;
}

/** @deprecated 请用 loadKubaiIconLocal；同步 URL 在真机 <image> 上往往空白 */
export function resolveKubaiIconSrc(name, color) {
  return buildKubaiIconUrl(name, color);
}

/** @deprecated */
export function resolveKubaiIconPngSrc(name, color) {
  return buildKubaiIconUrl(name, color);
}

function cacheKey(name, color) {
  return `${kubaiName(name)}_${normalizeKubaiHex(color)}`;
}

function ensureIconDir(fs) {
  const dir = `${wx.env.USER_DATA_PATH}/kubai-icons`;
  try {
    fs.accessSync(dir);
  } catch (e) {
    try {
      fs.mkdirSync(dir, true);
    } catch (err) {
      /* ignore */
    }
  }
  return dir;
}

/**
 * 下载 SVG 到本地再给 <image> 用（小程序不支持网络 SVG）。
 * @returns {Promise<string>} 本地路径；失败时仍返回远程 URL 兜底
 */
export function loadKubaiIconLocal(name, color) {
  const key = cacheKey(name, color);
  if (memCache[key]) return Promise.resolve(memCache[key]);
  if (inflight[key]) return inflight[key];

  const url = buildKubaiIconUrl(name, color);
  const fs = wx.getFileSystemManager();
  const dir = ensureIconDir(fs);
  const filePath = `${dir}/${key}.svg`;

  try {
    fs.accessSync(filePath);
    memCache[key] = filePath;
    return Promise.resolve(filePath);
  } catch (e) {
    /* need download */
  }

  inflight[key] = new Promise((resolve) => {
    wx.downloadFile({
      url,
      filePath,
      success: (res) => {
        if (res && (res.statusCode === 200 || res.statusCode === 304)) {
          memCache[key] = filePath;
          resolve(filePath);
          return;
        }
        // 部分基础库只给 tempFilePath
        const temp = res && res.tempFilePath;
        if (temp) {
          try {
            fs.saveFileSync(temp, filePath);
            memCache[key] = filePath;
            resolve(filePath);
            return;
          } catch (err) {
            memCache[key] = temp;
            resolve(temp);
            return;
          }
        }
        resolve(url);
      },
      fail: () => resolve(url),
      complete: () => {
        delete inflight[key];
      },
    });
  });

  return inflight[key];
}
