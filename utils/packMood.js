/**
 * 合集「人气氛围」状态：整卡轻量氛围层 + 角标（不挡标题/标签/预览）。
 * GIF 存云存储，见 packMoodAssets.js；用 ensurePackMoodOverlayUrls 换临时链。
 * bg=dark 的素材在白卡片上用 screen 混色去掉黑底。
 * @see https://particlefx.studio/effects
 */

import { getTempFileURLs } from '~/utils/cloud';
import { forgetTempUrl } from '~/utils/tempUrlCache';
import {
  PACK_MOOD_FILE_IDS,
  packMoodBg,
  packMoodBoxStyle,
  packMoodFileId,
} from '~/utils/packMoodAssets';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 优先级：数字越小越优先（一张卡只展示一个） */
export const PACK_MOODS = {
  viral: {
    id: 'viral',
    label: '爆火',
    icon: 'flame',
    iconColor: '#ea580c',
    priority: 10,
  },
  rising: {
    id: 'rising',
    label: '飙升',
    icon: 'zap',
    iconColor: '#2563eb',
    priority: 20,
  },
  revived: {
    id: 'revived',
    label: '复活',
    icon: 'sprout',
    iconColor: '#16a34a',
    priority: 30,
  },
  fresh: {
    id: 'fresh',
    label: '新发布',
    icon: 'sparkles',
    iconColor: '#ca8a04',
    priority: 40,
  },
  popular: {
    id: 'popular',
    label: '人气',
    icon: 'heart',
    iconColor: '#e11d48',
    priority: 50,
  },
  sleeping: {
    id: 'sleeping',
    label: '沉睡',
    icon: 'moon',
    iconColor: '#64748b',
    priority: 60,
  },
  cold: {
    id: 'cold',
    label: '冷门',
    icon: 'snowflake',
    iconColor: '#0ea5e9',
    priority: 70,
  },
};

const BY_ID = PACK_MOODS;

/** @type {Record<string, string>} moodId → https 临时链 */
let overlayUrlMap = Object.create(null);
let overlayResolvePromise = null;

export function getPackMoodOverlayUrl(moodId) {
  const id = String(moodId || '').trim();
  return (id && overlayUrlMap[id]) || '';
}

/**
 * 批量换签氛围 GIF；首页启动时调一次即可。
 * @param {{ force?: boolean }} [opts] force=true 清掉旧临时链再换签（换素材后要用）
 */
export function ensurePackMoodOverlayUrls(opts = {}) {
  const ids = Object.keys(PACK_MOOD_FILE_IDS || {});
  const fileList = ids.map((id) => PACK_MOOD_FILE_IDS[id]).filter(Boolean);
  if (!fileList.length) return Promise.resolve(overlayUrlMap);
  if (overlayResolvePromise && !opts.force) return overlayResolvePromise;

  if (opts.force) {
    fileList.forEach((id) => forgetTempUrl(id));
    overlayUrlMap = Object.create(null);
  }

  overlayResolvePromise = getTempFileURLs(fileList)
    .then((urls) => {
      const next = Object.create(null);
      ids.forEach((id, i) => {
        const u = String((urls && urls[i]) || '').trim();
        if (u) next[id] = u;
      });
      overlayUrlMap = next;
      return overlayUrlMap;
    })
    .catch((e) => {
      console.warn('[packMood] overlay url resolve fail', e && e.message);
      return overlayUrlMap;
    })
    .finally(() => {
      overlayResolvePromise = null;
    });

  return overlayResolvePromise;
}

/**
 * @param {object} pack
 * @param {{ viralMin?: number, popularMin?: number, now?: number, overlayUrls?: Record<string,string> }} [opts]
 */
export function resolvePackMood(pack, opts = {}) {
  if (!pack || pack.isAd) return null;
  const now = Number(opts.now) || Date.now();
  const createdAt = Number(pack.createdAt) || 0;
  const downloadCount = Math.max(0, Number(pack.downloadCount) || 0);
  const lastDownloadAt = Number(pack.lastDownloadAt) || 0;
  const revivedAt = Number(pack.revivedAt) || 0;
  const age = createdAt > 0 ? now - createdAt : 0;

  const viralMin = Math.max(1, Number(opts.viralMin) || 0);
  const popularMin = Math.max(
    8,
    Number(opts.popularMin) || Math.max(8, Math.floor(viralMin * 0.25) || 12),
  );

  const fromServer = String(pack.moodId || pack.mood || '').trim();
  if (fromServer && BY_ID[fromServer]) {
    return decorateMood(BY_ID[fromServer], opts.overlayUrls);
  }

  /** @type {string[]} */
  const hits = [];

  if (viralMin > 0 && downloadCount >= viralMin) hits.push('viral');

  if (
    lastDownloadAt > 0 &&
    now - lastDownloadAt < DAY_MS &&
    downloadCount >= Math.max(5, Math.floor(popularMin * 0.5)) &&
    age > 3 * DAY_MS
  ) {
    hits.push('rising');
  }

  if (revivedAt > 0 && now - revivedAt < 14 * DAY_MS) hits.push('revived');
  // 老合集近三周又有下载 → 回流复活（放宽年龄与回流窗口，提高可见率）
  if (
    age > 14 * DAY_MS &&
    lastDownloadAt > 0 &&
    now - lastDownloadAt < 21 * DAY_MS &&
    downloadCount >= 1
  ) {
    hits.push('revived');
  }

  if (createdAt > 0 && age < 3 * DAY_MS) hits.push('fresh');

  if (downloadCount >= popularMin && !(viralMin > 0 && downloadCount >= viralMin)) {
    hits.push('popular');
  }

  const idleMs = lastDownloadAt > 0 ? now - lastDownloadAt : age;
  if (age > 30 * DAY_MS && idleMs > 30 * DAY_MS) hits.push('sleeping');

  if (
    age > 14 * DAY_MS &&
    downloadCount > 0 &&
    downloadCount < Math.max(3, Math.floor(popularMin * 0.2)) &&
    idleMs <= 30 * DAY_MS
  ) {
    hits.push('cold');
  }

  if (!hits.length) return null;
  hits.sort((a, b) => BY_ID[a].priority - BY_ID[b].priority);
  return decorateMood(BY_ID[hits[0]], opts.overlayUrls);
}

function decorateMood(def, overlayUrls) {
  if (!def) return null;
  const urls = overlayUrls || overlayUrlMap;
  const overlay =
    (urls && urls[def.id]) || getPackMoodOverlayUrl(def.id) || '';
  const bg = packMoodBg(def.id);
  return {
    id: def.id,
    label: def.label,
    icon: def.icon,
    iconColor: def.iconColor,
    fileID: packMoodFileId(def.id),
    overlay,
    bg,
    /** 右上角展示尺寸 = GIF 原比例（aspectFit，不拉伸） */
    boxStyle: packMoodBoxStyle(def.id),
    className: `home__pack-row--mood-${def.id}`,
  };
}
