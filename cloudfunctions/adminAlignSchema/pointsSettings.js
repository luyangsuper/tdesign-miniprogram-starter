/** 与 adminManagePoints/pointsSettings 对齐的精简副本：仅用于把缺失单价写回云库 */

const DEFAULTS = {
  welcomeGiftPoints: 18,
  checkinPoints: 1,
  oaBonusPoints: 1,
  adRewardPoints: 1,
  adRewardDailyMax: 5,
  saveAdRewardPoints: 1,
  saveAdRewardDailyMax: 8,
  homeFeedAdEvery: 6,
  costStatic: 1,
  costAnim: 2,
  costWallpaper: 4,
  costAvatar: 4,
  costVideo: 8,
};

const POINT_KEYS = Object.keys(DEFAULTS);

function clampPoints(n, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(9999, Math.floor(v)));
}

function clampDailyMax(n, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(50, Math.floor(v)));
}

function clampHomeFeedAdEvery(n, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(20, Math.floor(v)));
}

function clampDownloadCost(n, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(1, Math.min(999, Math.floor(v)));
}

function normalizeSettings(raw = {}) {
  return {
    welcomeGiftPoints: clampPoints(raw.welcomeGiftPoints, DEFAULTS.welcomeGiftPoints),
    checkinPoints: clampPoints(raw.checkinPoints, DEFAULTS.checkinPoints),
    oaBonusPoints: clampPoints(raw.oaBonusPoints, DEFAULTS.oaBonusPoints),
    adRewardPoints: clampPoints(raw.adRewardPoints, DEFAULTS.adRewardPoints),
    adRewardDailyMax: clampDailyMax(raw.adRewardDailyMax, DEFAULTS.adRewardDailyMax),
    saveAdRewardPoints: clampPoints(raw.saveAdRewardPoints, DEFAULTS.saveAdRewardPoints),
    saveAdRewardDailyMax: clampDailyMax(
      raw.saveAdRewardDailyMax,
      DEFAULTS.saveAdRewardDailyMax,
    ),
    homeFeedAdEvery: clampHomeFeedAdEvery(raw.homeFeedAdEvery, DEFAULTS.homeFeedAdEvery),
    costStatic: clampDownloadCost(raw.costStatic, DEFAULTS.costStatic),
    costAnim: clampDownloadCost(raw.costAnim, DEFAULTS.costAnim),
    costWallpaper: clampDownloadCost(raw.costWallpaper, DEFAULTS.costWallpaper),
    costAvatar: clampDownloadCost(raw.costAvatar, DEFAULTS.costAvatar),
    costVideo: clampDownloadCost(raw.costVideo, DEFAULTS.costVideo),
  };
}

async function ensureAppConfigCollection(db) {
  try {
    await db.createCollection('app_config');
  } catch (e) {
    /* ignore */
  }
}

/**
 * 若 app_config/points 缺字段（尤其壁纸/头像/视频单价），写回完整规范化配置。
 * @returns {{ patched: boolean, missingKeys: string[] }}
 */
async function repairPointsConfig(db, { dryRun, openid }) {
  let raw = {};
  let exists = false;
  try {
    const snap = await db.collection('app_config').doc('points').get();
    raw = (snap && snap.data) || {};
    exists = !!(snap && snap.data);
  } catch (e) {
    raw = {};
    exists = false;
  }

  const missingKeys = POINT_KEYS.filter(
    (k) => raw[k] === undefined || raw[k] === null || raw[k] === '',
  );
  if (!missingKeys.length && exists) {
    return { patched: false, missingKeys: [] };
  }

  const next = normalizeSettings(raw);
  if (dryRun) {
    return { patched: true, missingKeys: missingKeys.length ? missingKeys : POINT_KEYS };
  }

  await ensureAppConfigCollection(db);
  await db.collection('app_config').doc('points').set({
    data: {
      ...next,
      updatedAt: db.serverDate(),
      updatedBy: openid || '',
      repairedAt: db.serverDate(),
    },
  });
  return {
    patched: true,
    missingKeys: missingKeys.length ? missingKeys : POINT_KEYS,
  };
}

module.exports = {
  DEFAULTS,
  POINT_KEYS,
  normalizeSettings,
  repairPointsConfig,
};
