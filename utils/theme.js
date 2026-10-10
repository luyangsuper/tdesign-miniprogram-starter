const THEME_STORAGE_KEY = 'app_theme_id';

/**
 * 预设主题。scale: TDesign primary 1–10；hue 用于标签避让。
 * metaPrefer: 「张数 / 已下载」优先色相，需与 hue 不同。
 */
export const THEME_PRESETS = [
  {
    id: 'wechat',
    name: '微信绿',
    hue: 'green',
    brand: '#07c160',
    scale: {
      1: '#e8f8ef',
      2: '#c6f0d6',
      3: '#91e3b0',
      4: '#5ad68a',
      5: '#2dcc6f',
      6: '#1db85c',
      7: '#07c160',
      8: '#06ad56',
      9: '#058f47',
      10: '#046b36',
    },
  },
  {
    id: 'blue',
    name: '科技蓝',
    hue: 'blue',
    brand: '#0052d9',
    scale: {
      1: '#f2f3ff',
      2: '#d9e1ff',
      3: '#b5c7ff',
      4: '#8eabff',
      5: '#618dff',
      6: '#366ef4',
      7: '#0052d9',
      8: '#003cab',
      9: '#002a7c',
      10: '#001a57',
    },
  },
  {
    id: 'orange',
    name: '活力橙',
    hue: 'orange',
    brand: '#ed7b2f',
    scale: {
      1: '#fff1e9',
      2: '#ffd9c2',
      3: '#ffb98c',
      4: '#ff984f',
      5: '#f97d23',
      6: '#ed7b2f',
      7: '#e37318',
      8: '#be5a00',
      9: '#9a4a00',
      10: '#6b3400',
    },
  },
  {
    id: 'purple',
    name: '浪漫紫',
    hue: 'purple',
    brand: '#8b5cf6',
    scale: {
      1: '#f5f3ff',
      2: '#ede9fe',
      3: '#ddd6fe',
      4: '#c4b5fd',
      5: '#a78bfa',
      6: '#8b5cf6',
      7: '#7c3aed',
      8: '#6d28d9',
      9: '#5b21b6',
      10: '#4c1d95',
    },
  },
  {
    id: 'pink',
    name: '樱花粉',
    hue: 'pink',
    brand: '#ec4899',
    scale: {
      1: '#fdf2f8',
      2: '#fce7f3',
      3: '#fbcfe8',
      4: '#f9a8d4',
      5: '#f472b6',
      6: '#ec4899',
      7: '#db2777',
      8: '#be185d',
      9: '#9d174d',
      10: '#831843',
    },
  },
  {
    id: 'cyan',
    name: '清新青',
    hue: 'cyan',
    brand: '#0891b2',
    scale: {
      1: '#ecfeff',
      2: '#cffafe',
      3: '#a5f3fc',
      4: '#67e8f9',
      5: '#22d3ee',
      6: '#06b6d4',
      7: '#0891b2',
      8: '#0e7490',
      9: '#155e75',
      10: '#164e63',
    },
  },
  {
    id: 'red',
    name: '中国红',
    hue: 'red',
    brand: '#e34d59',
    scale: {
      1: '#fff0ed',
      2: '#ffd8d2',
      3: '#ffb7b0',
      4: '#ff9592',
      5: '#f76560',
      6: '#e34d59',
      7: '#d54941',
      8: '#ad352f',
      9: '#881f1c',
      10: '#68070a',
    },
  },
];

/**
 * 卡片标签色库：浅色用淡底深字，深色用半透明底 + 亮字，避免深色模式「白底突兀」。
 * light/dark 成对维护。
 */
const META_SWATCHES = [
  { hue: 'blue', light: { bg: '#e8f3ff', color: '#2f80ed' }, dark: { bg: 'rgba(47,128,237,0.22)', color: '#8bb8ff' } },
  { hue: 'amber', light: { bg: '#fff7e6', color: '#b36b00' }, dark: { bg: 'rgba(245,158,11,0.2)', color: '#fbbf24' } },
  { hue: 'purple', light: { bg: '#f3e8ff', color: '#7a3db8' }, dark: { bg: 'rgba(155,81,224,0.22)', color: '#d0a6ff' } },
  { hue: 'pink', light: { bg: '#ffe8f1', color: '#c9347a' }, dark: { bg: 'rgba(236,72,153,0.22)', color: '#f9a8d4' } },
  { hue: 'cyan', light: { bg: '#ecfeff', color: '#0e7490' }, dark: { bg: 'rgba(34,211,238,0.18)', color: '#67e8f9' } },
  { hue: 'indigo', light: { bg: '#eef2ff', color: '#4f46e5' }, dark: { bg: 'rgba(99,102,241,0.22)', color: '#a5b4fc' } },
  { hue: 'teal', light: { bg: '#e8faf8', color: '#078d85' }, dark: { bg: 'rgba(20,184,166,0.2)', color: '#5eead4' } },
];

/** 分类色库（带 hue） */
const CATEGORY_SWATCHES = [
  { hue: 'purple', light: { bg: '#f3e8ff', color: '#7a3db8' }, dark: { bg: 'rgba(155,81,224,0.22)', color: '#d0a6ff' } },
  { hue: 'pink', light: { bg: '#ffe8f1', color: '#c9347a' }, dark: { bg: 'rgba(236,72,153,0.22)', color: '#f9a8d4' } },
  { hue: 'teal', light: { bg: '#e8faf8', color: '#078d85' }, dark: { bg: 'rgba(20,184,166,0.2)', color: '#5eead4' } },
  { hue: 'amber', light: { bg: '#fff1e9', color: '#d97706' }, dark: { bg: 'rgba(245,158,11,0.2)', color: '#fbbf24' } },
  { hue: 'indigo', light: { bg: '#eef2ff', color: '#4f46e5' }, dark: { bg: 'rgba(99,102,241,0.22)', color: '#a5b4fc' } },
  { hue: 'cyan', light: { bg: '#ecfeff', color: '#0e7490' }, dark: { bg: 'rgba(34,211,238,0.18)', color: '#67e8f9' } },
  { hue: 'orange', light: { bg: '#fef3c7', color: '#b45309' }, dark: { bg: 'rgba(249,115,22,0.2)', color: '#fdba74' } },
  { hue: 'blue', light: { bg: '#e8f3ff', color: '#2f80ed' }, dark: { bg: 'rgba(47,128,237,0.22)', color: '#8bb8ff' } },
  { hue: 'green', light: { bg: '#e8f8ef', color: '#07c160' }, dark: { bg: 'rgba(7,193,96,0.22)', color: '#6ee7a8' } },
  { hue: 'red', light: { bg: '#fff0ed', color: '#d54941' }, dark: { bg: 'rgba(213,73,65,0.22)', color: '#fca5a5' } },
];

const BUILTIN_TAG_INDEX = {
  spongebob: 6,
  doraemon: 0,
  kuromi: 1,
  shinchan: 3,
};

const HUE_NEAR = {
  green: ['green', 'teal'],
  blue: ['blue', 'indigo', 'cyan'],
  orange: ['orange', 'amber'],
  purple: ['purple', 'indigo'],
  pink: ['pink', 'red'],
  cyan: ['cyan', 'teal', 'blue'],
  red: ['red', 'pink', 'orange'],
};

function nearHues(hue) {
  return HUE_NEAR[hue] || [hue];
}

function isNear(a, b) {
  const na = nearHues(a);
  return na.indexOf(b) >= 0 || nearHues(b).indexOf(a) >= 0;
}

/** 系统深色模式（app.json darkmode: true） */
export function isDarkMode() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.systemTheme) {
      return app.globalData.systemTheme === 'dark';
    }
  } catch (e) {
    /* ignore */
  }
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      const info = wx.getAppBaseInfo();
      if (info && info.theme) return info.theme === 'dark';
    }
  } catch (e) {
    /* ignore */
  }
  try {
    const info = wx.getSystemInfoSync();
    return !!(info && info.theme === 'dark');
  } catch (e) {
    return false;
  }
}

function resolveSwatch(entry) {
  if (!entry) return { bg: 'rgba(127,127,127,0.15)', color: '#888' };
  if (entry.light || entry.dark) {
    const mode = isDarkMode() ? 'dark' : 'light';
    const pair = entry[mode] || entry.light || entry.dark;
    return { hue: entry.hue, bg: pair.bg, color: pair.color };
  }
  return { hue: entry.hue, bg: entry.bg, color: entry.color };
}

export function getThemePresets() {
  return THEME_PRESETS.map((t) => ({
    id: t.id,
    name: t.name,
    brand: t.brand,
  }));
}

export function getThemeById(id) {
  return THEME_PRESETS.find((t) => t.id === id) || THEME_PRESETS[0];
}

export function getThemeId() {
  try {
    const id = wx.getStorageSync(THEME_STORAGE_KEY);
    if (id && THEME_PRESETS.some((t) => t.id === id)) return id;
  } catch (e) {
    /* ignore */
  }
  return 'wechat';
}

export function getCurrentTheme() {
  return getThemeById(getThemeId());
}

/** #rrggbb → rgba，用于深色模式浅底 token */
function hexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(127,127,127,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 写入 CSS 变量，挂在页面根节点 style 上即可覆盖 TDesign token */
export function buildThemeStyle(theme) {
  const t = theme || getCurrentTheme();
  const s = t.scale;
  const dark = isDarkMode();
  // 深色下不能再用 s[1] 近白浅底，否则 check-tag 选中态会整块发白
  const brandSoft = dark ? hexToRgba(s[7], 0.22) : s[1];
  const brandSoftActive = dark ? hexToRgba(s[7], 0.32) : s[2];
  const brandText = dark ? s[5] : s[7];
  const parts = [];
  for (let i = 1; i <= 10; i += 1) {
    parts.push(`--td-primary-color-${i}:${s[i]}`);
  }
  // 深色里 primary-1/2 也改成半透明，避免组件回退到近白浅色
  if (dark) {
    parts.push(`--td-primary-color-1:${brandSoft}`);
    parts.push(`--td-primary-color-2:${brandSoftActive}`);
  }
  parts.push(`--td-brand-color:${brandText}`);
  parts.push(`--td-brand-color-focus:${brandSoft}`);
  parts.push(`--td-brand-color-active:${dark ? s[6] : s[8]}`);
  parts.push(`--td-brand-color-disabled:${dark ? hexToRgba(s[7], 0.35) : s[3]}`);
  parts.push(`--td-brand-color-light:${brandSoft}`);
  parts.push(`--td-brand-color-light-active:${brandSoftActive}`);
  parts.push(`--td-text-color-brand:${brandText}`);
  parts.push(`--td-text-color-link:${brandText}`);
  parts.push(`--app-brand:${brandText}`);
  parts.push(`--app-brand-light:${brandSoft}`);
  return parts.join(';');
}

export function setThemeId(id) {
  const theme = getThemeById(id);
  try {
    wx.setStorageSync(THEME_STORAGE_KEY, theme.id);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app) {
      app.globalData.themeId = theme.id;
      app.globalData.themeStyle = buildThemeStyle(theme);
      app.globalData.themeBrand = theme.brand;
      if (app.eventBus) app.eventBus.emit('themeChange', theme);
    }
  } catch (e) {
    /* ignore */
  }
  return theme;
}

let _systemThemeListenerBound = false;

export function initTheme() {
  let systemTheme = 'light';
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      const info = wx.getAppBaseInfo();
      if (info && info.theme) systemTheme = info.theme;
    } else {
      const info = wx.getSystemInfoSync();
      if (info && info.theme) systemTheme = info.theme;
    }
  } catch (e) {
    /* ignore */
  }

  const theme = getCurrentTheme();
  try {
    const app = getApp();
    if (app) {
      // 先写入 systemTheme，再 buildThemeStyle（深色浅底 token 依赖 isDarkMode）
      app.globalData.systemTheme = systemTheme === 'dark' ? 'dark' : 'light';
      app.globalData.themeId = theme.id;
      app.globalData.themeStyle = buildThemeStyle(theme);
      app.globalData.themeBrand = theme.brand;
    }
  } catch (e) {
    /* ignore */
  }

  // 系统浅/深色切换时刷新标签色（分类标签用了内联 customStyle）
  if (!_systemThemeListenerBound && typeof wx.onThemeChange === 'function') {
    _systemThemeListenerBound = true;
    wx.onThemeChange((res) => {
      try {
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.systemTheme =
            res && res.theme === 'dark' ? 'dark' : 'light';
          if (app.eventBus) app.eventBus.emit('themeChange', getCurrentTheme());
        }
      } catch (err) {
        /* ignore */
      }
    });
  }
  return theme;
}

/** 以本地存储的主题为准，避免 globalData 默认微信绿盖住已选主题 */
function syncGlobalTheme() {
  const theme = getCurrentTheme();
  const style = buildThemeStyle(theme);
  try {
    const app = getApp();
    if (app && app.globalData) {
      // 含深/浅色切换：style 字符串会变，也要写回
      if (
        app.globalData.themeId !== theme.id ||
        app.globalData.themeBrand !== theme.brand ||
        app.globalData.themeStyle !== style
      ) {
        app.globalData.themeId = theme.id;
        app.globalData.themeBrand = theme.brand;
        app.globalData.themeStyle = style;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return { theme, style };
}

export function getThemeStyle() {
  return syncGlobalTheme().style;
}

export function getThemeBrand() {
  return syncGlobalTheme().theme.brand;
}

function hashToIndex(str, mod) {
  const s = String(str || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return mod ? h % mod : 0;
}

function tagCustomStyle(c) {
  return [
    `--td-tag-default-color:${c.color}`,
    `--td-tag-default-light-color:${c.bg}`,
    `color:${c.color}`,
    `background-color:${c.bg}`,
    'border-color:transparent',
  ].join(';');
}

/** 相对当前主题色，挑两个不撞色的元信息色 */
export function getMetaSwatches(theme) {
  const t = theme || getCurrentTheme();
  const pool = META_SWATCHES.filter((s) => !isNear(s.hue, t.hue));
  const list = pool.length >= 2 ? pool : META_SWATCHES;
  return {
    count: resolveSwatch(list[0]),
    download: resolveSwatch(list[1] || list[0]),
  };
}

export function metaTagStyle(kind, theme) {
  const pair = getMetaSwatches(theme);
  const c = pair[kind] || pair.count;
  return tagCustomStyle(c);
}

/** 分类色：避开主题色与元信息色 */
export function categoryTagStyle(id, name, theme) {
  const t = theme || getCurrentTheme();
  const meta = getMetaSwatches(t);
  const avoid = nearHues(t.hue)
    .concat(nearHues(meta.count.hue))
    .concat(nearHues(meta.download.hue));
  const pool = CATEGORY_SWATCHES.filter((s) => avoid.indexOf(s.hue) < 0);
  const palette = pool.length ? pool : CATEGORY_SWATCHES;
  const builtinIdx = BUILTIN_TAG_INDEX[id];
  const idx =
    builtinIdx != null
      ? builtinIdx % palette.length
      : hashToIndex(String(name || id || ''), palette.length);
  return tagCustomStyle(resolveSwatch(palette[idx]));
}

/** 同步当前页 / 自定义 tabBar 的 themeStyle */
export function applyThemeToPage(page) {
  if (!page || typeof page.setData !== 'function') return;
  const style = getThemeStyle();
  const brand = getThemeBrand();
  const theme = getCurrentTheme();
  const patch = {};
  if (page.data.themeStyle !== style) patch.themeStyle = style;
  if (page.data.themeBrand !== brand) patch.themeBrand = brand;
  if (page.data.themeId !== undefined && page.data.themeId !== theme.id) {
    patch.themeId = theme.id;
  }
  if (page.data.themeName !== undefined && page.data.themeName !== theme.name) {
    patch.themeName = theme.name;
  }
  if (Object.keys(patch).length) page.setData(patch);
}

export function applyThemeToTabBar() {
  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    if (!cur || typeof cur.getTabBar !== 'function') return;
    const bar = cur.getTabBar();
    if (!bar) return;
    if (typeof bar.syncTheme === 'function') {
      bar.syncTheme();
      return;
    }
    if (typeof bar.setData === 'function') {
      bar.setData({
        themeStyle: getThemeStyle(),
        brand: getThemeBrand(),
      });
    }
  } catch (e) {
    /* ignore */
  }
}
