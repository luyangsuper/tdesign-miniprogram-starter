/**
 * 合集氛围 GIF 云资源（由 scripts/upload-pack-mood-fx.mjs 生成）。
 * - fileID：小程序 getTempFileURL 换临时链，勿打进包体
 * - bg：dark=黑底粒子（卡片上 screen 去黑）；light=白底友好
 * 素材：https://particlefx.studio/effects （免费商用、无需署名）
 */
export const PACK_MOOD_FILE_IDS = {
  "viral": "cloud://cloud1-d4g0731mc55f853ef.636c-cloud1-d4g0731mc55f853ef-1501873885/assets/pack-mood/v2/viral-drifting-embers-overlay.gif",
  "rising": "cloud://cloud1-d4g0731mc55f853ef.636c-cloud1-d4g0731mc55f853ef-1501873885/assets/pack-mood/v2/rising-tileable-meteor-shower.gif",
  "revived": "cloud://cloud1-d4g0731mc55f853ef.636c-cloud1-d4g0731mc55f853ef-1501873885/assets/pack-mood/v2/revived-wild-growth.gif",
  "fresh": "cloud://cloud1-d4g0731mc55f853ef.636c-cloud1-d4g0731mc55f853ef-1501873885/assets/pack-mood/v2/fresh-twinkling-stars.gif",
  "popular": "cloud://cloud1-d4g0731mc55f853ef.636c-cloud1-d4g0731mc55f853ef-1501873885/assets/pack-mood/v2/popular-valentine-hearts-loop.gif",
  "sleeping": "cloud://cloud1-d4g0731mc55f853ef.636c-cloud1-d4g0731mc55f853ef-1501873885/assets/pack-mood/v2/sleeping-drifting-clouds-loop.gif",
  "cold": "cloud://cloud1-d4g0731mc55f853ef.636c-cloud1-d4g0731mc55f853ef-1501873885/assets/pack-mood/v2/cold-seamless-snowfall-loop.gif"
};

export const PACK_MOOD_META = {
  "viral": {
    "bg": "dark",
    "slug": "drifting-embers-overlay",
    "w": 512,
    "h": 512
  },
  "rising": {
    "bg": "dark",
    "slug": "tileable-meteor-shower",
    "w": 512,
    "h": 512
  },
  "revived": {
    "bg": "dark",
    "slug": "wild-growth",
    "w": 431,
    "h": 237
  },
  "fresh": {
    "bg": "dark",
    "slug": "twinkling-stars",
    "w": 361,
    "h": 356
  },
  "popular": {
    "bg": "dark",
    "slug": "valentine-hearts-loop",
    "w": 512,
    "h": 512
  },
  "sleeping": {
    "bg": "dark",
    "slug": "drifting-clouds-loop",
    "w": 512,
    "h": 512
  },
  "cold": {
    "bg": "dark",
    "slug": "seamless-snowfall-loop",
    "w": 512,
    "h": 512
  }
};

export const PACK_MOOD_DISPLAY_MAX_RPX = 240;

export function packMoodFileId(moodId) {
  const id = String(moodId || '').trim();
  return PACK_MOOD_FILE_IDS[id] || '';
}

export function packMoodBg(moodId) {
  const id = String(moodId || '').trim();
  const hit = PACK_MOOD_META[id];
  return hit && hit.bg === 'light' ? 'light' : 'dark';
}

export function packMoodBoxStyle(moodId) {
  const id = String(moodId || '').trim();
  const hit = PACK_MOOD_META[id] || {};
  const w = Math.max(1, Number(hit.w) || 512);
  const h = Math.max(1, Number(hit.h) || 512);
  const max = PACK_MOOD_DISPLAY_MAX_RPX;
  const scale = max / Math.max(w, h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  return `width:${dw}rpx;height:${dh}rpx;`;
}
