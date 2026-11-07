/**
 * 系统信息封装：优先新 API，旧基础库回退 getSystemInfoSync
 */

function legacySystemInfo() {
  return wx.getSystemInfoSync();
}

/** 窗口尺寸 / 状态栏等 */
export function getWindowInfoSafe() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      return wx.getWindowInfo();
    }
  } catch (e) {
    /* ignore */
  }
  return legacySystemInfo();
}

/**
 * 自定义导航尺寸：完全以胶囊几何为准。
 * 不用裸 statusBarHeight 推算——它与胶囊错位时，t-navbar placeholder 会比 fixed 实色栏更高，顶下留灰缝。
 */
export function getCustomNavMetrics() {
  const win = getWindowInfoSafe();
  const menu = wx.getMenuButtonBoundingClientRect();
  const menuTop = Number(menu.top) || 0;
  const menuHeight = Number(menu.height) || 32;
  const menuBottom = Number(menu.bottom) || menuTop + menuHeight;
  const reportedStatus = Number(win.statusBarHeight) || 0;
  let gap = menuTop - reportedStatus;
  if (!menuTop || gap < 0 || gap > 16) {
    gap = 6;
  }
  /* 顶栏总高 = 胶囊底 + 与上方对称的 gap，保证和标题行（top=menuTop）闭合无缝 */
  const statusBarHeight = Math.max(0, Math.round(menuTop - gap));
  const navBarHeight = Math.round(gap * 2 + menuHeight);
  const navHeight = Math.round(menuBottom + gap);
  const navBarStyle = [
    `--td-navbar-padding-top:${statusBarHeight}px`,
    `--td-navbar-height:${navBarHeight}px`,
  ].join(';');

  return {
    statusBarHeight,
    navBarHeight,
    navHeight,
    menuTop: Math.round(menuTop),
    menuHeight: Math.round(menuHeight),
    menuBottom: Math.round(menuBottom),
    gap: Math.round(gap),
    navBarStyle,
    windowWidth: Number(win.windowWidth) || 375,
  };
}

/** SDK 版本、语言、微信版本、主题等 */
export function getAppBaseInfoSafe() {
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      return wx.getAppBaseInfo();
    }
  } catch (e) {
    /* ignore */
  }
  return legacySystemInfo();
}

/** 设备 platform / brand / model 等 */
export function getDeviceInfoSafe() {
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      return wx.getDeviceInfo();
    }
  } catch (e) {
    /* ignore */
  }
  return legacySystemInfo();
}
