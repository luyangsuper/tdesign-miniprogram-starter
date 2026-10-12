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
  const nextFileID = res.avatarFileID || prev.avatarFileID || '';
  // 云临时链约 2 小时过期：绝不能优先用本地旧 https，否则头像变 X
  // 只接受本次下发的可展示地址；缺省留给客户端按 fileID 重新换链
  let avatarUrl = String(res.avatarUrl || '');
  if (/^cloud:\/\//i.test(avatarUrl)) {
    avatarUrl = '';
  }
  // 仅本地临时路径（刚选完头像尚未换链）可短暂沿用
  if (!avatarUrl) {
    const prevUrl = String(prev.avatarUrl || '');
    if (
      nextFileID === (prev.avatarFileID || '') &&
      (prevUrl.startsWith('wxfile://') ||
        prevUrl.startsWith('http://tmp') ||
        prevUrl.startsWith('http://usr'))
    ) {
      avatarUrl = prevUrl;
    }
  }

  const profile = {
    nickName: res.nickName != null ? res.nickName : prev.nickName || '',
    avatarUrl,
    avatarFileID: nextFileID,
    // 用于判断云临时链是否可能过期（约 2h），过期则不再直接展示
    avatarUrlAt: avatarUrl ? Date.now() : 0,
  };
  setUserProfile(profile);
  if (app) app.globalData.userInfo = profile;

  if (res.entitlement) {
    setCachedEntitlement(res.entitlement);
  }
  return profile;
}
