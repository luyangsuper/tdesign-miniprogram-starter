/**
 * Pixabots 部件目录 + ID + 动画（vendor 自 @pixabots/core，MIT）
 * 数组仅允许追加，勿重排/删除。
 * @see https://github.com/pablostanley/pixabots
 */

export const CATEGORY_ORDER = ['eyes', 'heads', 'body', 'top'];

/** 合成顺序：底 → 顶 */
export const LAYER_ORDER = ['top', 'body', 'heads', 'eyes'];

export const CATEGORY_LABELS = {
  eyes: '脸',
  heads: '头',
  body: '身',
  top: '顶',
};

/**
 * @typedef {{ name: string, frames?: number, kind?: 'static'|'blink'|'sequence' }} PartDef
 */

/** @type {Record<string, PartDef[]>} */
export const PARTS = {
  eyes: [
    { name: 'big-face' },
    { name: 'cheeky-terminal', frames: 16, kind: 'sequence' },
    { name: 'glasses', frames: 2, kind: 'blink' },
    { name: 'human', frames: 2, kind: 'blink' },
    { name: 'human-2', frames: 2, kind: 'blink' },
    { name: 'monitor' },
    { name: 'monitor-round' },
    { name: 'mustache' },
    { name: 'terminal', frames: 2, kind: 'blink' },
    { name: 'terminal-green', frames: 2, kind: 'blink' },
    { name: 'terminal-light' },
    { name: 'terminal-round', frames: 2, kind: 'blink' },
    { name: 'tight-visor', frames: 8, kind: 'sequence' },
    { name: 'visor', frames: 8, kind: 'sequence' },
    { name: 'wayfarer', frames: 4, kind: 'sequence' },
    { name: 'wayfarer-face', frames: 8, kind: 'sequence' },
  ],
  heads: [
    { name: 'ac' },
    { name: 'blob' },
    { name: 'blob-blue' },
    { name: 'bowl' },
    { name: 'box' },
    { name: 'commodore' },
    { name: 'frame' },
    { name: 'punch-bowl' },
  ],
  body: [
    { name: 'backpack' },
    { name: 'claws' },
    { name: 'heart' },
    { name: 'swag' },
    { name: 'tank' },
    { name: 'wings' },
    { name: 'fire' },
  ],
  top: [
    { name: 'antenna' },
    { name: 'bulb' },
    { name: 'bunny-ears' },
    { name: 'disco' },
    { name: 'leaf' },
    { name: 'lollypop' },
    { name: 'mohawk' },
    { name: 'plant' },
    { name: 'radar' },
    { name: 'bun' },
    { name: 'horns' },
    { name: 'spikes' },
  ],
};

export const FRAME_MS = 72;
export const LOOP_LENGTH = 16;
export const NATIVE_SIZE = 32;

/** 8 帧弹跳，Y 偏移（原生像素）；在 16-tick 环里播两遍 */
export const ANIM_FRAMES = [
  { top: 0, heads: 0, eyes: 0, body: 0 },
  { top: 0, heads: 0, eyes: 0, body: 0 },
  { top: 0, heads: 1, eyes: 1, body: 0 },
  { top: 1, heads: 2, eyes: 2, body: 1 },
  { top: 2, heads: 2, eyes: 2, body: 1 },
  { top: 2.5, heads: 2, eyes: 2, body: 1 },
  { top: 2, heads: 1, eyes: 1, body: 1 },
  { top: 1, heads: 0, eyes: 0, body: 0 },
];

export const BLINK_SCHEDULE = [
  0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

const BASE = 'https://pixabots.com';

export function partCount(category) {
  return (PARTS[category] || []).length;
}

export function getPart(category, index) {
  const list = PARTS[category] || [];
  if (index < 0 || index >= list.length) return null;
  return list[index];
}

export function getPartName(category, index) {
  const p = getPart(category, index);
  return (p && p.name) || '';
}

export function partPath(category, name) {
  return `${category}/${name}.png`;
}

export function partThumbUrl(category, name) {
  const n = String(name || '').trim();
  const c = String(category || '').trim();
  if (!n || !c) return '';
  return `${BASE}/parts/${c}/${n}.png`;
}

export function resolveFrameIndex(part, tick) {
  if (!part) return 0;
  const frames = part.frames || 1;
  if (frames <= 1) return 0;
  const kind = part.kind || 'static';
  const t = ((tick % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
  if (kind === 'blink') return BLINK_SCHEDULE[t % BLINK_SCHEDULE.length];
  if (kind === 'sequence') return t % frames;
  return 0;
}

export function bounceOffsets(tick) {
  const bounceTick = tick % ANIM_FRAMES.length;
  return ANIM_FRAMES[bounceTick] || ANIM_FRAMES[0];
}

export function encodeCombo(combo = {}) {
  let id = '';
  for (const cat of CATEGORY_ORDER) {
    const max = partCount(cat);
    let index = Number(combo[cat]);
    if (!Number.isFinite(index) || index < 0 || index >= max) index = 0;
    id += index.toString(36);
  }
  return id;
}

export function decodeId(id) {
  const raw = String(id || '').trim().toLowerCase();
  const combo = { eyes: 0, heads: 0, body: 0, top: 0 };
  if (raw.length !== CATEGORY_ORDER.length) return combo;
  for (let i = 0; i < CATEGORY_ORDER.length; i += 1) {
    const cat = CATEGORY_ORDER[i];
    const val = parseInt(raw[i], 36);
    const max = partCount(cat);
    combo[cat] = Number.isFinite(val) && val >= 0 && val < max ? val : 0;
  }
  return combo;
}

export function isValidId(id) {
  const raw = String(id || '').trim().toLowerCase();
  if (raw.length !== CATEGORY_ORDER.length) return false;
  for (let i = 0; i < CATEGORY_ORDER.length; i += 1) {
    const cat = CATEGORY_ORDER[i];
    const val = parseInt(raw[i], 36);
    if (!Number.isFinite(val) || val < 0 || val >= partCount(cat)) return false;
  }
  return true;
}

export function randomCombo() {
  const combo = {};
  CATEGORY_ORDER.forEach((cat) => {
    const n = partCount(cat);
    combo[cat] = n > 0 ? Math.floor(Math.random() * n) : 0;
  });
  return combo;
}

export function randomId() {
  return encodeCombo(randomCombo());
}

/** 色相预设（对齐官网 inspector / API ?hue） */
export const HUE_PRESETS = [
  { id: '0', hue: 0, saturate: 1, label: '原色', swatch: '#cbd5e1' },
  { id: '35', hue: 35, saturate: 1.25, label: '暖橙', swatch: '#f59e0b' },
  { id: '70', hue: 70, saturate: 1.2, label: '嫩黄', swatch: '#eab308' },
  { id: '110', hue: 110, saturate: 1.25, label: '草绿', swatch: '#22c55e' },
  { id: '150', hue: 150, saturate: 1.2, label: '青绿', swatch: '#14b8a6' },
  { id: '190', hue: 190, saturate: 1.25, label: '天蓝', swatch: '#0ea5e9' },
  { id: '230', hue: 230, saturate: 1.2, label: '靛蓝', swatch: '#3b82f6' },
  { id: '275', hue: 275, saturate: 1.25, label: '紫罗兰', swatch: '#a855f7' },
  { id: '315', hue: 315, saturate: 1.2, label: '玫红', swatch: '#ec4899' },
];

/** 对齐官网 randomPalette：hue 全圈，saturate 落在 0.6–1.4 */
export function randomPalette() {
  const hue = Math.floor(Math.random() * 360);
  const saturate = Math.round((0.6 + Math.random() * 0.8) * 100) / 100;
  return { hue, saturate };
}

export function normalizePalette(opts = {}) {
  const hue = ((Math.round(Number(opts.hue) || 0) % 360) + 360) % 360;
  let saturate = Number(opts.saturate);
  if (!Number.isFinite(saturate)) saturate = 1;
  saturate = Math.max(0, Math.min(4, saturate));
  return { hue, saturate };
}

export function hasPaletteTransform(palette) {
  if (!palette) return false;
  const { hue, saturate } = normalizePalette(palette);
  return hue !== 0 || saturate !== 1;
}

/** 仅作缩略图兜底；主预览走本地 canvas */
export function pixabotImageUrl(id, opts = {}) {
  const pid = isValidId(id) ? String(id).trim().toLowerCase() : '2156';
  const size = Math.max(64, Math.min(512, Number(opts.size) || 256));
  const bg = encodeURIComponent(String(opts.bg || '#f3f4f6'));
  const { hue, saturate } = normalizePalette(opts);
  let url = `${BASE}/api/pixabot/${pid}?size=${size}&bg=${bg}`;
  if (hue) url += `&hue=${hue}`;
  if (saturate !== 1) url += `&saturate=${Number(saturate.toFixed(2))}`;
  return url;
}

export function buildPartOptions(category) {
  const list = PARTS[category] || [];
  return list.map((p, index) => ({
    index,
    name: p.name,
    thumb: partThumbUrl(category, p.name),
  }));
}

export function buildCategoryTabs() {
  return CATEGORY_ORDER.map((id) => ({
    id,
    label: CATEGORY_LABELS[id] || id,
  }));
}

const LAST_PIXABOT_KEY = 'pixabot_last_v1';

/** 从云文件路径解析上次设头像的 pixabot id（不含色相） */
export function parsePixabotIdFromFileID(fileID) {
  const s = String(fileID || '');
  const m = s.match(/_pixabot_([0-9a-z]{4})(?:_|\.)/i);
  return m ? String(m[1]).toLowerCase() : '';
}

export function loadLastPixabot() {
  try {
    const raw = wx.getStorageSync(LAST_PIXABOT_KEY);
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim().toLowerCase();
    if (!isValidId(id)) return null;
    const palette = normalizePalette(raw);
    return {
      id,
      combo: decodeId(id),
      hue: palette.hue,
      saturate: palette.saturate,
      format: raw.format === 'gif' || raw.format === 'json' ? raw.format : 'png',
    };
  } catch (e) {
    return null;
  }
}

export function saveLastPixabot(state = {}) {
  const id = String(state.id || '').trim().toLowerCase();
  if (!isValidId(id)) return;
  const palette = normalizePalette(state);
  try {
    wx.setStorageSync(LAST_PIXABOT_KEY, {
      id,
      hue: palette.hue,
      saturate: palette.saturate,
      format: state.format === 'gif' || state.format === 'json' ? state.format : 'png',
      at: Date.now(),
    });
  } catch (e) {
    /* ignore */
  }
}
