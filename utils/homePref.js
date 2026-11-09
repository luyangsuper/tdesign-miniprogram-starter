/**
 * 首页偏好：默认主分类 + 多选角色分类。
 * 本地持久化；保存后下次进首页按此加载（类型筛选 + 角色 Tab 前排）。
 */
import {
  CONTENT_TYPE_ALL,
  contentTypeFilterLabel,
  contentTypeLabel,
  normalizeContentType,
} from '~/utils/contentType';
import { CATEGORY_FILTER_ALL } from '~/utils/categories';

const STORAGE_KEY = 'home_pref_v2';
const LEGACY_KEY = 'home_pref_v1';

function emitHomePrefChange(pref) {
  try {
    const app = getApp();
    if (app && app.eventBus) app.eventBus.emit('homePrefChange', pref);
    if (app && app.globalData) app.globalData.homeNeedRefresh = true;
  } catch (e) {
    /* ignore */
  }
}

function normalizeContentTypePref(raw) {
  const contentTypeRaw = String(raw || CONTENT_TYPE_ALL).trim();
  if (!contentTypeRaw || contentTypeRaw === CONTENT_TYPE_ALL) return CONTENT_TYPE_ALL;
  return normalizeContentType(contentTypeRaw);
}

/**
 * @param {unknown} rawIds
 * @param {unknown} rawNames
 * @param {string} [legacyId]
 * @param {string} [legacyName]
 */
function normalizeCategoryPrefs(rawIds, rawNames, legacyId, legacyName) {
  let ids = [];
  if (Array.isArray(rawIds)) {
    ids = rawIds.map((x) => String(x || '').trim()).filter(Boolean);
  } else if (legacyId) {
    const id = String(legacyId || '').trim();
    if (id && id !== CATEGORY_FILTER_ALL) ids = [id];
  }
  // 「全部」不进多选列表
  ids = ids.filter((id) => id && id !== CATEGORY_FILTER_ALL && id !== 'uncategorized');
  // 去重保序
  const seen = Object.create(null);
  ids = ids.filter((id) => {
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });

  let names = [];
  if (Array.isArray(rawNames)) {
    names = rawNames.map((x) => String(x || '').trim());
  } else if (legacyName && ids.length === 1) {
    names = [String(legacyName).trim()];
  }
  while (names.length < ids.length) names.push('');
  names = names.slice(0, ids.length);

  return {
    categoryIds: ids,
    categoryNames: names,
    /** 兼容旧字段：单选时的主角色 */
    categoryId: ids[0] || CATEGORY_FILTER_ALL,
    categoryName: names[0] || (ids.length ? '' : '全部'),
  };
}

function emptyPref() {
  return {
    saved: false,
    contentType: CONTENT_TYPE_ALL,
    categoryIds: [],
    categoryNames: [],
    categoryId: CATEGORY_FILTER_ALL,
    categoryName: '全部',
  };
}

function readRawStorage() {
  try {
    const v2 = wx.getStorageSync(STORAGE_KEY);
    if (v2 && typeof v2 === 'object') return v2;
  } catch (e) {
    /* ignore */
  }
  try {
    const v1 = wx.getStorageSync(LEGACY_KEY);
    if (v1 && typeof v1 === 'object') return v1;
  } catch (e) {
    /* ignore */
  }
  return null;
}

/**
 * @returns {{
 *   saved: boolean,
 *   contentType: string,
 *   categoryIds: string[],
 *   categoryNames: string[],
 *   categoryId: string,
 *   categoryName: string,
 * }}
 */
export function getHomePref() {
  try {
    const raw = readRawStorage();
    if (!raw) return emptyPref();
    const cats = normalizeCategoryPrefs(
      raw.categoryIds,
      raw.categoryNames,
      raw.categoryId,
      raw.categoryName,
    );
    return {
      saved: !!raw.saved,
      contentType: normalizeContentTypePref(raw.contentType),
      ...cats,
    };
  } catch (e) {
    return emptyPref();
  }
}

/**
 * @param {{
 *   contentType?: string,
 *   categoryIds?: string[],
 *   categoryNames?: string[],
 *   categoryId?: string,
 *   categoryName?: string,
 *   saved?: boolean,
 * }} patch
 */
export function setHomePref(patch = {}) {
  const prev = getHomePref();
  const contentType = normalizeContentTypePref(
    patch.contentType != null ? patch.contentType : prev.contentType,
  );
  const cats = normalizeCategoryPrefs(
    patch.categoryIds != null ? patch.categoryIds : prev.categoryIds,
    patch.categoryNames != null ? patch.categoryNames : prev.categoryNames,
    patch.categoryId != null ? patch.categoryId : undefined,
    patch.categoryName != null ? patch.categoryName : undefined,
  );
  const next = {
    saved: patch.saved != null ? !!patch.saved : true,
    contentType,
    ...cats,
  };
  try {
    wx.setStorageSync(STORAGE_KEY, next);
    try {
      wx.removeStorageSync(LEGACY_KEY);
    } catch (e) {
      /* ignore */
    }
  } catch (e) {
    /* storage full */
  }
  emitHomePrefChange(next);
  return next;
}

export function clearHomePref() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
  try {
    wx.removeStorageSync(LEGACY_KEY);
  } catch (e) {
    /* ignore */
  }
  const next = emptyPref();
  emitHomePrefChange(next);
  return next;
}

/** 把偏好角色排到「全部」之后、其余角色之前 */
export function reorderFiltersByPref(filters, preferredIds) {
  const list = Array.isArray(filters) ? filters.slice() : [];
  if (!list.length) return list;
  const pref = (Array.isArray(preferredIds) ? preferredIds : [])
    .map((x) => String(x || '').trim())
    .filter((id) => id && id !== CATEGORY_FILTER_ALL);
  if (!pref.length) return list;

  const all = list.filter((f) => f && f.id === CATEGORY_FILTER_ALL);
  const rest = list.filter((f) => f && f.id !== CATEGORY_FILTER_ALL);
  const prefSet = new Set(pref);
  const head = [];
  pref.forEach((id) => {
    const hit = rest.find((f) => f.id === id);
    if (hit) head.push(hit);
  });
  const tail = rest.filter((f) => !prefSet.has(f.id));
  return all.concat(head, tail);
}

/**
 * 冷启动默认选中的角色：
 * - 只选 1 个 → 直接进该角色
 * - 多选 → 进「全部」，偏好角色仅置顶在分类栏
 * - 未选 → 全部
 */
export function resolveHomePrefCategoryId(pref = getHomePref()) {
  if (!pref || !pref.saved) return CATEGORY_FILTER_ALL;
  const ids = Array.isArray(pref.categoryIds) ? pref.categoryIds : [];
  if (ids.length === 1) return ids[0];
  return CATEGORY_FILTER_ALL;
}

/** 「我的」菜单右侧摘要 */
export function getHomePrefNote(pref = getHomePref()) {
  if (!pref || !pref.saved) return '未设置';
  const typePart =
    pref.contentType === CONTENT_TYPE_ALL
      ? '不限类型'
      : contentTypeLabel(pref.contentType);
  const ids = Array.isArray(pref.categoryIds) ? pref.categoryIds : [];
  const names = Array.isArray(pref.categoryNames) ? pref.categoryNames : [];
  let catPart = '全部角色';
  if (ids.length === 1) {
    catPart = names[0] || '1 个角色';
  } else if (ids.length > 1) {
    const shown = names.filter(Boolean).slice(0, 2).join('、');
    catPart = shown
      ? `${shown}${ids.length > 2 ? `等${ids.length}个` : ''}`
      : `${ids.length} 个角色`;
  }
  return `${typePart} · ${catPart}`;
}

/** 预览 / 简短文案 */
export function getHomePrefBrief(pref = getHomePref()) {
  if (!pref || !pref.saved) return '';
  const typeName =
    pref.contentType === CONTENT_TYPE_ALL
      ? '全部'
      : contentTypeFilterLabel(pref.contentType);
  const ids = Array.isArray(pref.categoryIds) ? pref.categoryIds : [];
  const names = Array.isArray(pref.categoryNames) ? pref.categoryNames : [];
  if (!ids.length) return `${typeName} · 全部角色`;
  if (ids.length === 1) return `${typeName} · ${names[0] || '角色'}`;
  const shown = names.filter(Boolean).slice(0, 2).join('、');
  return `${typeName} · ${shown || `${ids.length}角色`}`;
}
