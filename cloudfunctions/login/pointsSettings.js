const DEFAULTS = {
  welcomeGiftPoints: 18,
  checkinPoints: 1,
  oaBonusPoints: 1,
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
    oaBonusPoints: clampPoints(raw.oaBonusPoints, DEFAULTS.oaBonusPoints),
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

module.exports = {
  DEFAULTS,
  normalizeSettings,
  getPointsSettings,
  clampPoints,
};
