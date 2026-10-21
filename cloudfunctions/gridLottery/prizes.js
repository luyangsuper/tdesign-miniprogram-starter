/** 顺时针 8 格（中间是抽奖按钮） */
const SLOT_XY = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 2, y: 2 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
  { x: 0, y: 1 },
];

const DEFAULT_COST = 2;
const DEFAULT_DAILY_LIMIT = 20;

function prizeName(points) {
  return points > 0 ? `${points} 积分` : '谢谢参与';
}

function defaultPrizes() {
  // 两个谢谢放对角（右上 / 左下），避免并排
  const names = [
    { name: prizeName(18), points: 18, weight: 1 },
    { name: prizeName(2), points: 2, weight: 140 },
    { name: prizeName(0), points: 0, weight: 400 },
    { name: prizeName(8), points: 8, weight: 24 },
    { name: prizeName(4), points: 4, weight: 60 },
    { name: prizeName(12), points: 12, weight: 6 },
    { name: prizeName(0), points: 0, weight: 150 },
    { name: prizeName(1), points: 1, weight: 200 },
  ];
  return names.map((p, i) => ({
    id: `p${i}`,
    ...SLOT_XY[i],
    ...p,
  }));
}

function normalizePrizes(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 8) : [];
  while (list.length < 8) {
    list.push({ name: prizeName(0), points: 0, weight: 1 });
  }
  const mapped = list.map((p, i) => {
    const points = Math.max(0, Math.min(999, Math.floor(Number(p.points) || 0)));
    const weight = Math.max(0, Math.min(99999, Math.floor(Number(p.weight) || 0)));
    const fallback = prizeName(points);
    const name = String(p.name || fallback)
      .trim()
      .slice(0, 12);
    return {
      id: String(p.id || `p${i}`).slice(0, 24),
      ...SLOT_XY[i],
      name: name || fallback,
      points,
      weight: weight || 0,
    };
  });
  return mapped;
}

function expectedValue(prizes) {
  const list = Array.isArray(prizes) ? prizes : [];
  const total = list.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);
  if (!total) return 0;
  const sum = list.reduce(
    (s, p) => s + Math.max(0, Number(p.weight) || 0) * Math.max(0, Number(p.points) || 0),
    0,
  );
  return sum / total;
}

function pickPrize(prizes) {
  const list = Array.isArray(prizes) ? prizes : [];
  const total = list.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);
  if (!total) {
    const i = list.findIndex((p) => p);
    return { index: Math.max(0, i), prize: list[Math.max(0, i)] || null };
  }
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i += 1) {
    r -= Math.max(0, Number(list[i].weight) || 0);
    if (r <= 0) return { index: i, prize: list[i] };
  }
  const last = list.length - 1;
  return { index: last, prize: list[last] };
}

function publicPrizes(prizes) {
  return (prizes || []).map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    name: p.name,
    points: Number(p.points) || 0,
  }));
}

function defaultConfig() {
  return {
    enabled: true,
    costPoints: DEFAULT_COST,
    dailyLimit: DEFAULT_DAILY_LIMIT,
    prizes: defaultPrizes(),
  };
}

module.exports = {
  SLOT_XY,
  DEFAULT_COST,
  DEFAULT_DAILY_LIMIT,
  defaultPrizes,
  defaultConfig,
  normalizePrizes,
  expectedValue,
  pickPrize,
  publicPrizes,
};
