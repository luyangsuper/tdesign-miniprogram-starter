const DEFAULTS = {
  welcomeGiftPoints: 18,
  checkinPoints: 1,
  oaBonusPoints: 1,
  /** 主动看广告（约 30s）奖励；0 关闭 */
  adRewardPoints: 1,
  /** 主动看广告每日上限；0 关闭 */
  adRewardDailyMax: 5,
  /** 救急短广告（约 15s）奖励；0 关闭 */
  saveAdRewardPoints: 1,
  /** 救急短广告每日上限；0 关闭 */
  saveAdRewardDailyMax: 8,
  /** 首页信息流每隔多少个合集插一条原生广告；0=关闭；建议 6～8 */
  homeFeedAdEvery: 6,
  /** 保存单价（与客户端 config.downloadCosts 默认对齐） */
  costStatic: 1,
  costAnim: 2,
  costWallpaper: 4,
  costAvatar: 4,
  costVideo: 8,
};

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

/** 保存单价：至少 1，避免误设成免费 */
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
    adRewardDailyMax: clampDailyMax(
      raw.adRewardDailyMax,
      DEFAULTS.adRewardDailyMax,
    ),
    saveAdRewardPoints: clampPoints(
      raw.saveAdRewardPoints,
      DEFAULTS.saveAdRewardPoints,
    ),
    saveAdRewardDailyMax: clampDailyMax(
      raw.saveAdRewardDailyMax,
      DEFAULTS.saveAdRewardDailyMax,
    ),
    homeFeedAdEvery: clampHomeFeedAdEvery(
      raw.homeFeedAdEvery,
      DEFAULTS.homeFeedAdEvery,
    ),
    costStatic: clampDownloadCost(raw.costStatic, DEFAULTS.costStatic),
    costAnim: clampDownloadCost(raw.costAnim, DEFAULTS.costAnim),
    costWallpaper: clampDownloadCost(raw.costWallpaper, DEFAULTS.costWallpaper),
    costAvatar: clampDownloadCost(raw.costAvatar, DEFAULTS.costAvatar),
    costVideo: clampDownloadCost(raw.costVideo, DEFAULTS.costVideo),
  };
}

function downloadCostsFromSettings(settings = {}) {
  const s = normalizeSettings(settings);
  return {
    static: s.costStatic,
    anim: s.costAnim,
    wallpaper: s.costWallpaper,
    avatar: s.costAvatar,
    video: s.costVideo,
  };
}

async function getPointsSettings(db) {
  try {
    const snap = await db.collection('app_config').doc('points').get();
    return normalizeSettings((snap && snap.data) || {});
  } catch (e) {
    return { ...DEFAULTS };
  }
}

async function ensureAppConfigCollection(db) {
  try {
    await db.createCollection('app_config');
  } catch (e) {
    /* 已存在则忽略 */
  }
}

async function savePointsSettings(db, patch, meta = {}) {
  const prev = await getPointsSettings(db);
  const next = normalizeSettings({
    welcomeGiftPoints:
      patch.welcomeGiftPoints !== undefined && patch.welcomeGiftPoints !== null
        ? patch.welcomeGiftPoints
        : prev.welcomeGiftPoints,
    checkinPoints:
      patch.checkinPoints !== undefined && patch.checkinPoints !== null
        ? patch.checkinPoints
        : prev.checkinPoints,
    oaBonusPoints:
      patch.oaBonusPoints !== undefined && patch.oaBonusPoints !== null
        ? patch.oaBonusPoints
        : prev.oaBonusPoints,
    adRewardPoints:
      patch.adRewardPoints !== undefined && patch.adRewardPoints !== null
        ? patch.adRewardPoints
        : prev.adRewardPoints,
    adRewardDailyMax:
      patch.adRewardDailyMax !== undefined && patch.adRewardDailyMax !== null
        ? patch.adRewardDailyMax
        : prev.adRewardDailyMax,
    saveAdRewardPoints:
      patch.saveAdRewardPoints !== undefined && patch.saveAdRewardPoints !== null
        ? patch.saveAdRewardPoints
        : prev.saveAdRewardPoints,
    saveAdRewardDailyMax:
      patch.saveAdRewardDailyMax !== undefined &&
      patch.saveAdRewardDailyMax !== null
        ? patch.saveAdRewardDailyMax
        : prev.saveAdRewardDailyMax,
    homeFeedAdEvery:
      patch.homeFeedAdEvery !== undefined && patch.homeFeedAdEvery !== null
        ? patch.homeFeedAdEvery
        : prev.homeFeedAdEvery,
    costStatic:
      patch.costStatic !== undefined && patch.costStatic !== null
        ? patch.costStatic
        : prev.costStatic,
    costAnim:
      patch.costAnim !== undefined && patch.costAnim !== null
        ? patch.costAnim
        : prev.costAnim,
    costWallpaper:
      patch.costWallpaper !== undefined && patch.costWallpaper !== null
        ? patch.costWallpaper
        : prev.costWallpaper,
    costAvatar:
      patch.costAvatar !== undefined && patch.costAvatar !== null
        ? patch.costAvatar
        : prev.costAvatar,
    costVideo:
      patch.costVideo !== undefined && patch.costVideo !== null
        ? patch.costVideo
        : prev.costVideo,
  });
  await ensureAppConfigCollection(db);
  try {
    await db
      .collection('app_config')
      .doc('points')
      .set({
        data: {
          ...next,
          updatedAt: db.serverDate(),
          updatedBy: meta.openid || '',
        },
      });
  } catch (e) {
    const msg = String((e && (e.errMsg || e.message)) || e || '');
    if (/COLLECTION_NOT_EXIST|collection not exists|Db or Table not exist/i.test(msg)) {
      await ensureAppConfigCollection(db);
      await db
        .collection('app_config')
        .doc('points')
        .set({
          data: {
            ...next,
            updatedAt: db.serverDate(),
            updatedBy: meta.openid || '',
          },
        });
    } else {
      throw e;
    }
  }
  return next;
}

module.exports = {
  DEFAULTS,
  normalizeSettings,
  getPointsSettings,
  savePointsSettings,
  downloadCostsFromSettings,
  clampPoints,
  clampDownloadCost,
};
