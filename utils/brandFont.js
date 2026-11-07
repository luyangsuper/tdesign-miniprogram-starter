/**
 * 品牌展示数字字体：Space Grotesk Bold（OFL）
 * 真机不支持包内路径直链，读本地文件转 Data URL 再 loadFontFace。
 */

const FONT_FAMILY = 'Space Grotesk';
const FONT_PATH = '/static/fonts/space-grotesk-700.woff';
const FONT_MIME = 'font/woff';

let loading = null;
let loaded = false;

function buildDataSource(base64) {
  return `url("data:${FONT_MIME};charset=utf-8;base64,${base64}")`;
}

function loadFromSource(source) {
  return new Promise((resolve) => {
    if (typeof wx.loadFontFace !== 'function') {
      resolve(false);
      return;
    }
    wx.loadFontFace({
      global: true,
      family: FONT_FAMILY,
      source,
      desc: { style: 'normal', weight: '700' },
      scopes: ['webview'],
      success() {
        loaded = true;
        resolve(true);
      },
      fail() {
        resolve(false);
      },
    });
  });
}

function readPackageBase64(filePath) {
  return new Promise((resolve) => {
    try {
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath,
        encoding: 'base64',
        success: (res) => resolve(res && res.data ? String(res.data) : ''),
        fail: () => resolve(''),
      });
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * App.onLaunch 调用一次即可；失败静默，页面回退系统字体。
 */
export function ensureBrandDisplayFont() {
  if (loaded) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    const candidates = [FONT_PATH, FONT_PATH.replace(/^\//, '')];
    for (let i = 0; i < candidates.length; i += 1) {
      const base64 = await readPackageBase64(candidates[i]);
      if (!base64) continue;
      const ok = await loadFromSource(buildDataSource(base64));
      if (ok) return true;
    }
    // 开发者工具偶发 Data URL 失败时，再试包内路径（仅模拟器）
    return loadFromSource(`url("${FONT_PATH}")`);
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function brandDisplayFontFamily() {
  return FONT_FAMILY;
}
