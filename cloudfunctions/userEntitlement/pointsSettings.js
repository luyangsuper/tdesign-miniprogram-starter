const DEFAULTS = {
  welcomeGiftPoints: 18,
  checkinPoints: 1,
  oaBonusPoints: 1,
  /** 主动看广告（约 30s）奖励；0 关闭 */
  adRewardPoints: 2,
  /** 主动看广告每日上限；0 关闭 */
  adRewardDailyMax: 5,
  /** 救急短广告（约 15s）奖励；0 关闭 */
  saveAdRewardPoints: 1,
  /** 救急短广告每日上限；0 关闭 */
  saveAdRewardDailyMax: 8,
  /** 首页信息流每隔多少个合集插一条原生广告；0=关闭；建议 6～8 */
  homeFeedAdEvery: 6,
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
  clampPoints,
};
