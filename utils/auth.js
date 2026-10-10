import config from '~/config';
import { setCachedEntitlement } from '~/utils/entitlement';

const OPENID_KEY = 'openid';
const USER_KEY = 'user_profile';
/** 本地预览：true 时客户端按普通用户展示（不影响云函数真实鉴权） */
const PREVIEW_AS_USER_KEY = 'preview_as_user';

export function getOpenId() {
  return wx.getStorageSync(OPENID_KEY) || '';
}

export function setOpenId(openid) {
  wx.setStorageSync(OPENID_KEY, openid || '');
}

export function getUserProfile() {
  return wx.getStorageSync(USER_KEY) || null;
}

export function setUserProfile(profile) {
  wx.setStorageSync(USER_KEY, profile || null);
}

export function isAdmin(adminOpenids = []) {
  const openid = getOpenId();
  if (!openid || !adminOpenids.length) return false;
  return adminOpenids.includes(openid);
}

/** 是否具备管理员身份（忽略「预览普通用户」开关） */
export function canBeAdmin() {
  const app = getApp();
  if (app && app.globalData && app.globalData.isAdmin) return true;
  if (!config.adminOpenids.length) return true; // 未配置名单：调试期默认可管
  return isAdmin(config.adminOpenids);
}

export function isPreviewAsUser() {
  return !!wx.getStorageSync(PREVIEW_AS_USER_KEY);
}

export function setPreviewAsUser(on) {
  wx.setStorageSync(PREVIEW_AS_USER_KEY, !!on);
}

/** 客户端入口是否按管理员展示（受预览开关影响） */
export function resolveIsAdmin() {
  if (isPreviewAsUser()) return false;
  return canBeAdmin();
}

/** 把登录/更新资料结果写进本地与 globalData */
export function applyLoginResult(res = {}) {
  const app = getApp();
  if (res.openid) {
    setOpenId(res.openid);
    if (app) app.globalData.openid = res.openid;
  }
  if (typeof res.isAdmin === 'boolean' && app) {
    app.globalData.isAdmin = res.isAdmin;
  }

  const prev = (app && app.globalData && app.globalData.userInfo) || getUserProfile() || {};
  const nextFileID = res.avatarFileID || '';
  const prevFileID = prev.avatarFileID || '';
  // 同一文件每次 getTempFileURL 会换域名/签名，强制换 src 会闪；fileID 不变则沿用旧 URL
  let avatarUrl = res.avatarUrl || '';
  if (nextFileID && nextFileID === prevFileID && prev.avatarUrl) {
    avatarUrl = prev.avatarUrl;
  } else if (!avatarUrl && prev.avatarUrl && nextFileID === prevFileID) {
    avatarUrl = prev.avatarUrl;
  }

  const profile = {
    nickName: res.nickName != null ? res.nickName : prev.nickName || '',
    avatarUrl,
    avatarFileID: nextFileID || prevFileID || '',
  };
  setUserProfile(profile);
  if (app) app.globalData.userInfo = profile;

  if (res.entitlement) {
    setCachedEntitlement(res.entitlement);
  }
  return profile;
}
