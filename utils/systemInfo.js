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
