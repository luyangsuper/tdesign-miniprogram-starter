/**
 * 版本更新说明：顶栏「趣图铺子」红点提示，点击查看；确认后本版本不再提示。
 * 发版时改 APP_VERSION + RELEASES 对应条目即可。
 */

const STORAGE_KEY = 'whats_new_seen_version';

/**
 * 与 package.json version 对齐；发版必改。
 * 未在 RELEASES 里登记的版本不会出红点。
 */
export const APP_VERSION = '3.6.0';

/**
 * @typedef {{ version: string, title?: string, items: string[] }} WhatsNewRelease
 * @type {WhatsNewRelease[]}
 */
export const RELEASES = [
  {
    version: '3.6.0',
    title: '更新说明',
    items: [
      '「我的」新增成就装扮：签到、保存等进度解锁头像框，可随时佩戴切换',
      '头像框衣橱支持成就 / 会员专属 / 选购，装扮一眼换上',
      '像素头像工坊上线：拼眼睛、身体与配色，可导出静态或动态头像',
      '首页搜索边输边找素材库图片，回车再查合集，找图更快',
      '合集卡新增人气氛围：爆火、飙升、新发布等角标与动效',
      '素材库继续扩容：动态表情、梗图、粒子特效等分区浏览；免费 GIF 可发给好友',
      '趣味工坊图片工具加码：旋转、圆角、EXIF、指定大小压缩等',
      '「我的收藏」改版：合集预览格更清晰，管理更顺手',
    ],
  },
  {
    version: '3.5.0',
    title: '更新说明',
    items: [
      '素材库上新：更多表情、梗图、粒子特效等有趣素材',
      '首页合集预览与素材入口优化，浏览更清晰好找',
      '趣味工坊新增一批图片工具：压缩、裁剪、转 GIF、水印等',
      '素材支持发给好友（免费 GIF）、搜索直达，体验更顺手',
      '修复若干显示与返回问题，滚动更稳、加载更省',
    ],
  },
  {
    version: '3.4.0',
    title: '更新说明',
    items: [
      '新增「趣味拼图」：用合集图玩滑动拼图，通关就能领积分',
      '支持计时冲榜与限时挑战，日榜靠前还有额外积分奖励',
      '轻松上手又好玩，每天都能来几局攒积分',
    ],
  },
];

function normalizeVersion(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '');
}

export function getSeenWhatsNewVersion() {
  try {
    return normalizeVersion(wx.getStorageSync(STORAGE_KEY));
  } catch (e) {
    return '';
  }
}

export function markWhatsNewSeen(version = APP_VERSION) {
  const v = normalizeVersion(version) || APP_VERSION;
  try {
    wx.setStorageSync(STORAGE_KEY, v);
  } catch (e) {
    /* ignore */
  }
}

/**
 * 当前版本尚未确认过、且 RELEASES 有条目时返回说明；否则 null。
 */
export function getPendingWhatsNew() {
  const current = normalizeVersion(APP_VERSION);
  if (!current) return null;
  if (getSeenWhatsNewVersion() === current) return null;

  const release = RELEASES.find((r) => normalizeVersion(r.version) === current);
  if (!release || !Array.isArray(release.items) || !release.items.length) {
    return null;
  }
  return {
    version: current,
    title: release.title || '更新说明',
    items: release.items.map((t) => String(t || '').trim()).filter(Boolean),
  };
}

function mapReleaseItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
}

/** 任意打开更新说明（含已读版本仍可再看当前版本文案） */
export function getCurrentWhatsNew() {
  const panel = getWhatsNewPanel();
  if (!panel) return null;
  return {
    version: panel.version,
    title: panel.title,
    items: panel.releases[0] ? panel.releases[0].items : [],
    pending: panel.pending,
  };
}

/**
 * 更新说明弹层数据：当前版 + 全部历史；有上一版时带 fromVersion 做「旧 → 新」展示。
 */
export function getWhatsNewPanel() {
  const current = normalizeVersion(APP_VERSION);
  const seen = getSeenWhatsNewVersion();

  const releases = RELEASES.map((r) => {
    const version = normalizeVersion(r.version);
    const items = mapReleaseItems(r.items);
    return {
      version,
      title: r.title || '更新说明',
      items,
    };
  }).filter((r) => r.version && r.items.length);

  if (!releases.length) return null;

  const currentIdx = releases.findIndex((r) => r.version === current);
  const head = currentIdx >= 0 ? releases[currentIdx] : releases[0];
  const headIdx = currentIdx >= 0 ? currentIdx : 0;
  const prevInCatalog =
    headIdx < releases.length - 1 ? releases[headIdx + 1].version : '';

  // 升级箭头：优先用「上次已读」→ 当前；否则用目录里上一版 → 当前
  let fromVersion = '';
  if (seen && seen !== head.version) {
    fromVersion = seen;
  } else if (prevInCatalog) {
    fromVersion = prevInCatalog;
  }

  return {
    title: head.title || '更新说明',
    version: head.version,
    fromVersion,
    showUpgrade: !!fromVersion,
    pending: seen !== head.version,
    releases: releases.map((r, i) => ({
      version: r.version,
      items: r.items,
      isCurrent: r.version === head.version,
      fromVersion: i < releases.length - 1 ? releases[i + 1].version : '',
    })),
  };
}
