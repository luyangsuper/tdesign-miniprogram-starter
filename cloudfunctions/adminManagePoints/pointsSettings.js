const DEFAULTS = {
  welcomeGiftPoints: 18,
  checkinPoints: 1,
};

function clampPoints(n, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(9999, Math.floor(v)));
}

function normalizeSettings(raw = {}) {
  return {
    welcomeGiftPoints: clampPoints(raw.welcomeGiftPoints, DEFAULTS.welcomeGiftPoints),
    checkinPoints: clampPoints(raw.checkinPoints, DEFAULTS.checkinPoints),
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
