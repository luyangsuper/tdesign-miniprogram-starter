/**
 * 趣味拼图全局配置：存 app_config/puzzle。
 * 两档难度固定（3/4）；日榜前三奖励可配。
 */

const CONFIG_DOC = 'puzzle';
/** 裁掉 5/6 后旧 sanitize 曾把 grid 夹成 4，污染 4×4 积分；升到 2 时恢复默认 */
const DIFF_SCHEMA_VER = 2;

const DEFAULT_DIFFICULTIES = [
  { grid: 3, reward: 1, label: '入门', timeLimit: 90 },
  { grid: 4, reward: 2, label: '进阶', timeLimit: 150 },
];

const DEFAULTS = {
  enabled: true,
  dailyMaxClears: 5,
  dailyClearBonus: 2,
  /** 日榜前三奖励（每个难度×玩法各结算一份；次日 0 点后发放） */
  rankRewardEnabled: true,
  rankRewardFirst: 2,
  rankRewardSecond: 1,
  rankRewardThird: 1,
  /** 连续霸榜（同难度×同玩法第一名） */
  streakRewardEnabled: true,
  streakMinDays: 2,
  streakRewardPoints: 1,
  difficulties: DEFAULT_DIFFICULTIES,
  diffSchemaVer: DIFF_SCHEMA_VER,
};

function clampInt(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function exactGrid(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : 0;
}

function sanitizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const listIn = Array.isArray(src.difficulties) ? src.difficulties : [];
  const rewardByGrid = new Map();
  listIn.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    // 必须精确匹配 3/4，不能 clamp：否则旧 6×6(reward:4) 会盖掉 4×4
    const grid = exactGrid(row.grid);
    if (![3, 4].includes(grid)) return;
    rewardByGrid.set(grid, clampInt(row.reward, 0, 99, 0));
  });

  const timeByGrid = new Map();
  listIn.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const grid = exactGrid(row.grid);
    if (![3, 4].includes(grid)) return;
    if (row.timeLimit != null) {
      timeByGrid.set(grid, clampInt(row.timeLimit, 30, 900, 0));
    }
  });

  const difficulties = DEFAULT_DIFFICULTIES.map((d) => ({
    grid: d.grid,
    label: d.label,
    reward: rewardByGrid.has(d.grid) ? rewardByGrid.get(d.grid) : d.reward,
    timeLimit:
      timeByGrid.has(d.grid) && timeByGrid.get(d.grid) > 0
        ? timeByGrid.get(d.grid)
        : d.timeLimit,
  }));

  return {
    enabled: src.enabled !== false,
    dailyMaxClears: clampInt(src.dailyMaxClears, 1, 30, DEFAULTS.dailyMaxClears),
    dailyClearBonus: clampInt(src.dailyClearBonus, 0, 99, DEFAULTS.dailyClearBonus),
    rankRewardEnabled: src.rankRewardEnabled !== false,
    rankRewardFirst: clampInt(src.rankRewardFirst, 0, 99, DEFAULTS.rankRewardFirst),
    rankRewardSecond: clampInt(src.rankRewardSecond, 0, 99, DEFAULTS.rankRewardSecond),
    rankRewardThird: clampInt(src.rankRewardThird, 0, 99, DEFAULTS.rankRewardThird),
    streakRewardEnabled: src.streakRewardEnabled !== false,
    streakMinDays: clampInt(src.streakMinDays, 2, 30, DEFAULTS.streakMinDays),
    streakRewardPoints: clampInt(src.streakRewardPoints, 0, 99, DEFAULTS.streakRewardPoints),
    difficulties,
    diffSchemaVer: clampInt(src.diffSchemaVer, 0, 99, 0),
  };
}

/** 裁档后恢复 3×3=1 / 4×4=2（保留已改时限） */
function migrateDifficultyRewards(cfg) {
  const byGrid = new Map((cfg.difficulties || []).map((d) => [d.grid, d]));
  return {
    ...cfg,
    difficulties: DEFAULT_DIFFICULTIES.map((d) => {
      const cur = byGrid.get(d.grid);
      return {
        grid: d.grid,
        label: d.label,
        reward: d.reward,
        timeLimit: cur && cur.timeLimit > 0 ? cur.timeLimit : d.timeLimit,
      };
    }),
    diffSchemaVer: DIFF_SCHEMA_VER,
  };
}

function publicDifficulties(cfg) {
  return (cfg.difficulties || []).map((d) => ({
    grid: d.grid,
    reward: d.reward,
    label: d.label,
    timeLimit: d.timeLimit,
  }));
}

function publicRankRewards(cfg) {
  return {
    enabled: cfg.rankRewardEnabled !== false,
    first: Math.max(0, Number(cfg.rankRewardFirst) || 0),
    second: Math.max(0, Number(cfg.rankRewardSecond) || 0),
    third: Math.max(0, Number(cfg.rankRewardThird) || 0),
    streakEnabled: cfg.streakRewardEnabled !== false,
    streakMinDays: Math.max(2, Number(cfg.streakMinDays) || 2),
    streakReward: Math.max(0, Number(cfg.streakRewardPoints) || 0),
  };
}

function timeLimitFor(cfg, grid) {
  const row = (cfg.difficulties || []).find((d) => d && d.grid === grid);
  if (row && row.timeLimit) return row.timeLimit;
  const fb = DEFAULT_DIFFICULTIES.find((d) => d.grid === grid);
  return (fb && fb.timeLimit) || 120;
}

function hashSeed(input) {
  let h = 2166136261;
  const s = String(input || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dailySeedKey(dateKey, grid, mode) {
  const m = mode === 'challenge' ? 'challenge' : 'timer';
  return `${dateKey}|${grid}|${m}`;
}

async function loadPuzzleConfig(db) {
  try {
    const snap = await db.collection('app_config').doc(CONFIG_DOC).get();
    if (snap && snap.data) {
      const raw = snap.data;
      let next = sanitizeConfig(raw);
      const listIn = Array.isArray(raw.difficulties) ? raw.difficulties : [];
      const hasLegacyGrid = listIn.some((row) => {
        const g = exactGrid(row && row.grid);
        return g === 5 || g === 6;
      });
      if ((next.diffSchemaVer || 0) < DIFF_SCHEMA_VER || hasLegacyGrid) {
        next = migrateDifficultyRewards(next);
        try {
          await savePuzzleConfig(db, next, 'diff-schema-migrate');
        } catch (e) {
          /* 读仍可用；下次再写 */
        }
      }
      return next;
    }
  } catch (e) {
    /* missing */
  }
  return sanitizeConfig(DEFAULTS);
}

async function savePuzzleConfig(db, raw, openid) {
  const next = sanitizeConfig(raw);
  // 管理端保存也标到当前 schema，避免再次被迁移覆盖
  next.diffSchemaVer = Math.max(next.diffSchemaVer || 0, DIFF_SCHEMA_VER);
  const payload = {
    ...next,
    updatedAt: db.serverDate(),
    updatedBy: String(openid || '').trim(),
  };
  try {
    await db.collection('app_config').doc(CONFIG_DOC).set({ data: payload });
  } catch (e) {
    try {
      await db.createCollection('app_config');
    } catch (e2) {
      /* exists */
    }
    await db.collection('app_config').doc(CONFIG_DOC).set({ data: payload });
  }
  return next;
}

module.exports = {
  DEFAULTS,
  DEFAULT_DIFFICULTIES,
  DIFF_SCHEMA_VER,
  sanitizeConfig,
  publicDifficulties,
  publicRankRewards,
  timeLimitFor,
  hashSeed,
  dailySeedKey,
  loadPuzzleConfig,
  savePuzzleConfig,
};
