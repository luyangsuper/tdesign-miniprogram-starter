const cloud = require('wx-server-sdk');
const { dayjs, TZ } = require('./time');
const { applyUserPoints } = require('./pointsLog');
const { resolveTempUrls } = require('./tempUrlCache');
const { normalizeContentType } = require('./contentType');
const {
  loadPuzzleConfig,
  savePuzzleConfig,
  publicDifficulties,
  publicRankRewards,
  timeLimitFor,
  hashSeed,
  dailySeedKey,
} = require('./puzzleConfig');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTION = 'puzzle_daily';
const RANK_COLLECTION = 'puzzle_ranks';
const SETTLE_COLLECTION = 'puzzle_rank_settlements';
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function todayKey() {
  return dayjs().tz(TZ).format('YYYY-MM-DD');
}

function yesterdayKey() {
  return dayjs().tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');
}

function prevDateKey(dateKey) {
  const d = dayjs.tz(String(dateKey || ''), TZ);
  if (!d.isValid()) return yesterdayKey();
  return d.subtract(1, 'day').format('YYYY-MM-DD');
}

function settleDocId(dateKey, grid, mode) {
  return `${dateKey}_${grid}_${mode}`;
}

function dailyClearCount(daily) {
  if (daily && daily.clearCount != null) {
    return Math.max(0, Math.floor(Number(daily.clearCount) || 0));
  }
  const cleared = Array.isArray(daily && daily.cleared) ? daily.cleared : [];
  return cleared.length;
}

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION);
  } catch (e) {
    /* exists */
  }
}

async function loadDaily(openid, dateKey) {
  const id = `${openid}_${dateKey}`;
  try {
    const snap = await db.collection(COLLECTION).doc(id).get();
    if (snap && snap.data) return { id, ...(snap.data || {}) };
  } catch (e) {
    /* missing */
  }
  return {
    id,
    openid,
    dateKey,
    cleared: [],
    claimedPoints: 0,
    bonusClaimed: false,
    usedKeys: [],
  };
}

async function saveDaily(doc) {
  await ensureCollection();
  // snap.data 常带 _id；update 不能改主键，必须剥掉
  const { id, _id, _openid, ...rest } = doc || {};
  const payload = {
    ...rest,
    updatedAt: db.serverDate(),
  };
  try {
    await db.collection(COLLECTION).doc(id).set({
      data: {
        ...payload,
        createdAt: rest.createdAt || db.serverDate(),
      },
    });
  } catch (e) {
    await db.collection(COLLECTION).doc(id).update({ data: payload });
  }
}

async function pickImage(usedKeys = []) {
  const used = new Set((usedKeys || []).map(String));
  const snap = await db
    .collection('packs')
    .where({ status: 'published' })
    .orderBy('createdAt', 'desc')
    .limit(48)
    .get();

  const packs = (snap.data || []).filter((p) => {
    if (!p || !Array.isArray(p.emojiFileIDs) || !p.emojiFileIDs.length) return false;
    const ct = normalizeContentType(p.contentType);
    return ct === 'emoji' || !p.contentType;
  });
  if (!packs.length) {
    return { ok: false, code: 'NO_PACK', message: '暂无可用合集' };
  }

  const shuffled = packs.slice().sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(12, shuffled.length); i += 1) {
    const pack = shuffled[i];
    const staticIds = Array.isArray(pack.emojiFileIDs) ? pack.emojiFileIDs : [];
    const count = staticIds.length;
    const indexes = [];
    for (let idx = 0; idx < count; idx += 1) {
      const key = `${pack._id}:${idx}`;
      if (used.has(key)) continue;
      if (String(staticIds[idx] || '').trim()) indexes.push(idx);
    }
    const pool = indexes.length
      ? indexes
      : Array.from({ length: count }, (_, idx) => idx).filter((idx) =>
          String(staticIds[idx] || '').trim(),
        );
    if (!pool.length) continue;

    const slotIndex = pool[Math.floor(Math.random() * pool.length)];
    const fileID = String(staticIds[slotIndex] || '').trim();
    if (!fileID) continue;
    const urlMap = await resolveTempUrls(cloud, [fileID]);
    const imageUrl = urlMap[fileID] || '';
    if (!imageUrl) continue;

    return {
      ok: true,
      data: {
        packId: pack._id,
        packTitle: pack.title || '合集',
        slotIndex,
        imageUrl,
        contentType: normalizeContentType(pack.contentType),
        sourceKey: `${pack._id}:${slotIndex}`,
      },
    };
  }

  return { ok: false, code: 'NO_IMAGE', message: '抽图失败，请重试' };
}

async function status(openid) {
  const cfg = await loadPuzzleConfig(db);
  // 懒结算：过了 0 点后，有人打开拼图就补发昨日日榜前三奖励
  try {
    await settleRankDay(yesterdayKey(), cfg);
  } catch (e) {
    console.error('[puzzleGame] settle on status', e);
  }
  const dateKey = todayKey();
  const daily = await loadDaily(openid, dateKey);
  const clearCount = dailyClearCount(daily);
  return {
    ok: true,
    data: {
      dateKey,
      enabled: cfg.enabled !== false,
      difficulties: publicDifficulties(cfg),
      dailyMax: cfg.dailyMaxClears,
      dailyBonus: cfg.dailyClearBonus,
      rankRewards: publicRankRewards(cfg),
      clearCount,
      cleared: daily.cleared || [],
      claimedPoints: daily.claimedPoints || 0,
      bonusClaimed: !!daily.bonusClaimed,
    },
  };
}

async function complete(openid, event) {
  const cfg = await loadPuzzleConfig(db);
  if (cfg.enabled === false) {
    return { ok: false, code: 'CLOSED', message: '趣味拼图暂未开放' };
  }

  const grid = Math.floor(Number(event.grid) || 0);
  const meta = (cfg.difficulties || []).find((d) => d && d.grid === grid);
  if (!meta) {
    return { ok: false, code: 'BAD_GRID', message: '难度无效' };
  }

  const dateKey = todayKey();
  const daily = await loadDaily(openid, dateKey);
  const clearCount = dailyClearCount(daily);
  const dailyMax = cfg.dailyMaxClears;
  // 计奖次数用尽：不发通关积分，但允许继续玩 / 冲榜
  if (clearCount >= dailyMax) {
    return {
      ok: true,
      points: 0,
      bonus: 0,
      already: true,
      message: '今日计奖次数已用完，本局无通关积分，仍可继续玩和冲榜',
      data: {
        points: 0,
        bonus: 0,
        already: true,
        quotaFull: true,
        clearCount,
        dailyMax,
      },
    };
  }

  let points = meta.reward;
  let bonus = 0;
  const nextCount = clearCount + 1;
  if (nextCount >= dailyMax && !daily.bonusClaimed) {
    bonus = cfg.dailyClearBonus;
  }
  const total = points + bonus;

  const usedKeys = Array.isArray(daily.usedKeys) ? daily.usedKeys.slice() : [];
  const packId = String(event.packId || '').trim();
  const slotIndex = Number(event.slotIndex);
  if (packId && Number.isFinite(slotIndex)) {
    const key = `${packId}:${slotIndex}`;
    if (!usedKeys.includes(key)) usedKeys.push(key);
  }

  if (total > 0) {
    await applyUserPoints(db, _, {
      openid,
      delta: total,
      reason: 'puzzle',
      title: bonus > 0 ? '拼图通关（含全通奖励）' : `拼图${meta.label}${meta.grid}×${meta.grid}`,
      meta: {
        grid: meta.grid,
        moves: Math.max(0, Math.floor(Number(event.moves) || 0)),
        seconds: Math.max(0, Math.floor(Number(event.seconds) || 0)),
        packId,
        slotIndex: Number.isFinite(slotIndex) ? slotIndex : -1,
        bonus,
        clearCount: nextCount,
      },
    });
  }

  const nextCleared = Array.isArray(daily.cleared) ? daily.cleared.slice() : [];
  nextCleared.push(nextCount);

  await saveDaily({
    ...daily,
    openid,
    dateKey,
    clearCount: nextCount,
    cleared: nextCleared,
    claimedPoints: Math.max(0, Number(daily.claimedPoints) || 0) + total,
    bonusClaimed: !!daily.bonusClaimed || bonus > 0,
    usedKeys,
  });

  try {
    await db.collection('puzzle_runs').add({
      data: {
        openid,
        dateKey,
        grid: meta.grid,
        moves: Math.max(0, Math.floor(Number(event.moves) || 0)),
        seconds: Math.max(0, Math.floor(Number(event.seconds) || 0)),
        packId,
        slotIndex: Number.isFinite(slotIndex) ? slotIndex : -1,
        points: total,
        clearCount: nextCount,
        createdAt: db.serverDate(),
      },
    });
  } catch (e) {
    try {
      await db.createCollection('puzzle_runs');
    } catch (e2) {
      /* ignore */
    }
  }

  return {
    ok: true,
    points: total,
    bonus,
    already: false,
    data: { points: total, bonus, already: false, clearCount: nextCount },
  };
}

async function listPublishedPacks() {
  const snap = await db
    .collection('packs')
    .where({ status: 'published' })
    .orderBy('createdAt', 'desc')
    .limit(80)
    .get();
  return (snap.data || []).filter((p) => {
    if (!p || !Array.isArray(p.emojiFileIDs) || !p.emojiFileIDs.length) return false;
    const ct = normalizeContentType(p.contentType);
    return ct === 'emoji' || !p.contentType;
  });
}

/**
 * 每日同题：同一天 + 难度 + 模式 → 同一张图 + 同一打乱种子（保证排行公平）
 */
async function dailyBoard(event) {
  const cfg = await loadPuzzleConfig(db);
  const grid = Math.floor(Number(event.grid) || 3);
  if (![3, 4].includes(grid)) {
    return { ok: false, code: 'BAD_GRID', message: '难度无效' };
  }
  const mode = String(event.mode || '') === 'challenge' ? 'challenge' : 'timer';
  const dateKey = todayKey();
  const seedKey = dailySeedKey(dateKey, grid, mode);
  const shuffleSeed = String(hashSeed(`${seedKey}|shuffle`));

  const packs = await listPublishedPacks();
  if (!packs.length) {
    return { ok: false, code: 'NO_PACK', message: '暂无可用合集' };
  }

  const pack = packs[hashSeed(`${seedKey}|pack`) % packs.length];
  const staticIds = Array.isArray(pack.emojiFileIDs) ? pack.emojiFileIDs : [];
  const validIdx = [];
  for (let i = 0; i < staticIds.length; i += 1) {
    if (String(staticIds[i] || '').trim()) validIdx.push(i);
  }
  if (!validIdx.length) {
    return { ok: false, code: 'NO_IMAGE', message: '今日题目图无效，请稍后再试' };
  }
  const slotIndex = validIdx[hashSeed(`${seedKey}|slot`) % validIdx.length];
  const fileID = String(staticIds[slotIndex] || '').trim();
  const urlMap = await resolveTempUrls(cloud, [fileID]);
  const imageUrl = urlMap[fileID] || '';
  if (!imageUrl) {
    return { ok: false, code: 'NO_IMAGE', message: '今日题目加载失败' };
  }

  return {
    ok: true,
    data: {
      dateKey,
      grid,
      mode,
      seedKey,
      shuffleSeed,
      packId: pack._id,
      packTitle: pack.title || '合集',
      slotIndex,
      imageUrl,
      timeLimit: timeLimitFor(cfg, grid),
      contentType: normalizeContentType(pack.contentType),
    },
  };
}

function rankBetter(mode, a, b) {
  // 步数少优先；同步数用时少优先
  if (a.moves !== b.moves) return a.moves < b.moves;
  return a.seconds < b.seconds;
}

async function ensureRankCollection() {
  try {
    await db.createCollection(RANK_COLLECTION);
  } catch (e) {
    /* exists */
  }
}

async function rankSubmit(openid, event) {
  const cfg = await loadPuzzleConfig(db);
  const grid = Math.floor(Number(event.grid) || 0);
  if (![3, 4].includes(grid)) {
    return { ok: false, code: 'BAD_GRID', message: '难度无效' };
  }
  const mode = String(event.mode || '') === 'challenge' ? 'challenge' : 'timer';
  const dateKey = todayKey();
  const seedKey = dailySeedKey(dateKey, grid, mode);
  if (String(event.seedKey || '') !== seedKey) {
    return { ok: false, code: 'BAD_SEED', message: '非今日同题，无法上榜' };
  }
  const moves = Math.max(0, Math.floor(Number(event.moves) || 0));
  const seconds = Math.max(0, Math.floor(Number(event.seconds) || 0));
  const timeLimit = timeLimitFor(cfg, grid);
  if (mode === 'challenge' && seconds > timeLimit) {
    return { ok: false, code: 'TIMEOUT', message: '超时成绩不计入挑战榜' };
  }
  if (moves <= 0) {
    return { ok: false, code: 'BAD_SCORE', message: '成绩无效' };
  }

  const nickName = String(event.nickName || '玩家').trim().slice(0, 20) || '玩家';
  const avatarUrl = String(event.avatarUrl || '').trim().slice(0, 500);
  const id = `${openid}_${dateKey}_${grid}_${mode}`;
  await ensureRankCollection();

  let prev = null;
  try {
    const snap = await db.collection(RANK_COLLECTION).doc(id).get();
    if (snap && snap.data) prev = snap.data;
  } catch (e) {
    /* missing */
  }

  const next = {
    openid,
    nickName,
    avatarUrl,
    dateKey,
    grid,
    mode,
    moves,
    seconds,
    timeLimit,
    seedKey,
    updatedAt: db.serverDate(),
  };

  if (prev && !rankBetter(mode, next, prev)) {
    return {
      ok: true,
      data: {
        improved: false,
        best: { moves: prev.moves, seconds: prev.seconds },
        current: { moves, seconds },
      },
      message: '未刷新个人最佳',
    };
  }

  await db.collection(RANK_COLLECTION).doc(id).set({
    data: {
      ...next,
      createdAt: (prev && prev.createdAt) || db.serverDate(),
    },
  });

  return {
    ok: true,
    data: {
      improved: true,
      best: { moves, seconds },
      current: { moves, seconds },
    },
    message: '已更新日榜成绩',
  };
}

function rankMoves(row) {
  return Math.max(0, Number(row && row.moves) || 0);
}

function rankSeconds(row) {
  return Math.max(0, Number(row && row.seconds) || 0);
}

function rankScoreEqual(a, b) {
  return rankMoves(a) === rankMoves(b) && rankSeconds(a) === rankSeconds(b);
}

function rankUpdatedMs(row) {
  const t = row && (row.updatedAt || row.createdAt);
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'object' && t.$date) return Number(t.$date) || 0;
  const parsed = Date.parse(String(t));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 步数少优先，同步数用时短优先；完全同分则更早提交靠前（仅排序，名次可并列） */
function compareRankRows(a, b) {
  const am = rankMoves(a);
  const bm = rankMoves(b);
  if (am !== bm) return am - bm;
  const as = rankSeconds(a);
  const bs = rankSeconds(b);
  if (as !== bs) return as - bs;
  const at = rankUpdatedMs(a);
  const bt = rankUpdatedMs(b);
  if (at !== bt) return at - bt;
  return String((a && a.openid) || '').localeCompare(String((b && b.openid) || ''));
}

/**
 * 奥林匹克并列：同分同名次，下一名跳号。
 * 例：成绩 10/10/12 → 名次 1/1/3
 */
function withCompetitionRanks(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  let lastRank = 0;
  return list.map((row, i) => {
    let rank;
    if (i === 0) {
      rank = 1;
    } else if (rankScoreEqual(row, list[i - 1])) {
      rank = lastRank;
    } else {
      rank = i + 1;
    }
    lastRank = rank;
    return { ...row, rank };
  });
}

async function fetchRankRows(dateKey, grid, mode) {
  await ensureRankCollection();
  try {
    const snap = await db
      .collection(RANK_COLLECTION)
      .where({ dateKey, grid, mode })
      .limit(100)
      .get();
    const rows = snap.data || [];
    rows.sort(compareRankRows);
    return rows;
  } catch (e) {
    return [];
  }
}

async function rankList(event) {
  const cfg = await loadPuzzleConfig(db);
  try {
    await settleRankDay(yesterdayKey(), cfg);
  } catch (e) {
    console.error('[puzzleGame] settle on rankList', e);
  }

  let grid = Math.floor(Number(event.grid) || 3);
  if (![3, 4].includes(grid)) grid = 3;
  const mode = String(event.mode || '') === 'challenge' ? 'challenge' : 'timer';
  const dateKey = String(event.dateKey || todayKey()).trim() || todayKey();
  const rows = withCompetitionRanks(await fetchRankRows(dateKey, grid, mode));
  const rewards = publicRankRewards(cfg);
  // 并列第一时：榜首展示连冠取排序第一人（更早提交）
  const firstOpenid = rows[0] && rows[0].openid ? String(rows[0].openid) : '';
  let liveStreak = 0;
  if (firstOpenid) {
    try {
      liveStreak = await resolveChampionStreak(dateKey, grid, mode, firstOpenid);
    } catch (e) {
      liveStreak = 1;
    }
  }
  const streakBadge =
    rewards.streakEnabled &&
    liveStreak >= Math.max(2, Number(rewards.streakMinDays) || 2);

  const list = rows.slice(0, 50).map((row) => {
    const rank = Math.max(1, Number(row.rank) || 1);
    let rewardPoints = 0;
    if (rewards.enabled) {
      if (rank === 1) rewardPoints = rewards.first;
      else if (rank === 2) rewardPoints = rewards.second;
      else if (rank === 3) rewardPoints = rewards.third;
    }
    const isChamp = rank === 1 && firstOpenid && String(row.openid) === firstOpenid;
    let streak = 0;
    let streakRewardPoints = 0;
    if (isChamp && liveStreak > 0) {
      streak = liveStreak;
      if (
        rewards.streakEnabled &&
        liveStreak >= Math.max(2, Number(rewards.streakMinDays) || 2) &&
        rewards.streakReward > 0
      ) {
        streakRewardPoints = rewards.streakReward;
      }
    }
    return {
      rank,
      openid: row.openid,
      nickName: row.nickName || '玩家',
      avatarUrl: row.avatarUrl || '',
      moves: rankMoves(row),
      seconds: rankSeconds(row),
      rewardPoints,
      streak,
      streakBadge: !!(isChamp && streakBadge),
      streakRewardPoints,
    };
  });

  return {
    ok: true,
    data: {
      dateKey,
      grid,
      mode,
      list,
      rankRewards: rewards,
      championStreak: liveStreak,
    },
  };
}

async function ensureSettleCollection() {
  try {
    await db.createCollection(SETTLE_COLLECTION);
  } catch (e) {
    /* exists */
  }
}

async function loadSettleDoc(dateKey, grid, mode) {
  await ensureSettleCollection();
  try {
    const snap = await db.collection(SETTLE_COLLECTION).doc(settleDocId(dateKey, grid, mode)).get();
    if (snap && snap.data) return snap.data;
  } catch (e) {
    /* missing */
  }
  return null;
}

/**
 * 计算某日某板第一名的连续霸榜天数（含当日）。
 * 优先读前一日结算记录；若尚未结算则回看前一日榜首。
 */
async function resolveChampionStreak(dateKey, grid, mode, championOpenid) {
  const openid = String(championOpenid || '').trim();
  if (!openid) return 0;
  const prevKey = prevDateKey(dateKey);
  const prevSettle = await loadSettleDoc(prevKey, grid, mode);
  if (prevSettle && String(prevSettle.championOpenid || '') === openid) {
    return Math.max(1, Math.floor(Number(prevSettle.championStreak) || 1)) + 1;
  }
  if (!prevSettle) {
    const prevRows = await fetchRankRows(prevKey, grid, mode);
    const prevFirst = prevRows[0];
    if (prevFirst && String(prevFirst.openid || '') === openid) {
      const prev2 = await loadSettleDoc(prevDateKey(prevKey), grid, mode);
      if (prev2 && String(prev2.championOpenid || '') === openid) {
        return Math.max(1, Math.floor(Number(prev2.championStreak) || 1)) + 2;
      }
      return 2;
    }
  }
  return 1;
}

/**
 * 结算某一日某一难度×玩法的前三 + 连冠奖励（幂等）。
 * 计时榜 / 挑战榜分开结算。
 */
async function settleOneBoard(dateKey, grid, mode, cfg) {
  const settleId = settleDocId(dateKey, grid, mode);
  await ensureSettleCollection();
  try {
    const snap = await db.collection(SETTLE_COLLECTION).doc(settleId).get();
    if (snap && snap.data) return { skipped: true, settleId };
  } catch (e) {
    /* missing → continue */
  }

  const rewards = [
    Math.max(0, Number(cfg.rankRewardFirst) || 0),
    Math.max(0, Number(cfg.rankRewardSecond) || 0),
    Math.max(0, Number(cfg.rankRewardThird) || 0),
  ];
  const topEnabled = cfg.rankRewardEnabled !== false;
  const streakEnabled = cfg.streakRewardEnabled !== false;
  const streakMin = Math.max(2, Math.floor(Number(cfg.streakMinDays) || 2));
  const streakPts = Math.max(0, Math.floor(Number(cfg.streakRewardPoints) || 0));
  const rows = withCompetitionRanks(await fetchRankRows(dateKey, grid, mode));
  const awards = [];
  const first = rows[0] || null;
  const championOpenid = first && first.openid ? String(first.openid) : '';
  const championStreak = championOpenid
    ? await resolveChampionStreak(dateKey, grid, mode, championOpenid)
    : 0;

  if (topEnabled) {
    // 按并列名次发奖：两人并列第 1 都拿第 1 档；若无人第 2 名则第 2 档空缺
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rank = Math.max(1, Number(row.rank) || 1);
      if (rank > 3) break;
      const points = rewards[rank - 1];
      if (!row || !row.openid || points <= 0) continue;
      try {
        await applyUserPoints(db, _, {
          openid: row.openid,
          delta: points,
          reason: 'puzzle_rank',
          title: `拼图日榜第${rank}名`,
          meta: {
            dateKey,
            grid,
            mode,
            rank,
            moves: row.moves,
            seconds: row.seconds,
            settleId,
            tied: i > 0 && rankScoreEqual(row, rows[i - 1]),
          },
        });
        awards.push({
          openid: row.openid,
          nickName: row.nickName || '',
          rank,
          points,
          type: 'top',
        });
      } catch (e) {
        console.error('[puzzleGame] rank award', settleId, rank, e);
      }
    }
  }

  let streakAward = null;
  if (
    streakEnabled &&
    championOpenid &&
    championStreak >= streakMin &&
    streakPts > 0
  ) {
    try {
      await applyUserPoints(db, _, {
        openid: championOpenid,
        delta: streakPts,
        reason: 'puzzle_streak',
        title: `拼图连冠×${championStreak}`,
        meta: {
          dateKey,
          grid,
          mode,
          streak: championStreak,
          settleId,
        },
      });
      streakAward = {
        openid: championOpenid,
        nickName: (first && first.nickName) || '',
        streak: championStreak,
        points: streakPts,
        type: 'streak',
      };
      awards.push(streakAward);
    } catch (e) {
      console.error('[puzzleGame] streak award', settleId, e);
    }
  }

  await db.collection(SETTLE_COLLECTION).doc(settleId).set({
    data: {
      dateKey,
      grid,
      mode,
      enabled: topEnabled,
      streakEnabled,
      championOpenid,
      championNickName: (first && first.nickName) || '',
      championStreak,
      awards,
      streakAward,
      settledAt: db.serverDate(),
    },
  });
  return {
    skipped: false,
    settleId,
    awards,
    championStreak,
    championOpenid,
  };
}

async function settleRankDay(dateKey, cfgInput) {
  const cfg = cfgInput || (await loadPuzzleConfig(db));
  const grids = [3, 4];
  const modes = ['timer', 'challenge'];
  const results = [];
  for (let gi = 0; gi < grids.length; gi += 1) {
    for (let mi = 0; mi < modes.length; mi += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await settleOneBoard(dateKey, grids[gi], modes[mi], cfg);
      results.push(r);
    }
  }
  return { ok: true, data: { dateKey, results } };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = String(event.action || event.Type || 'status').trim();

  // 定时触发 / 显式结算：不强制登录
  if (action === 'Timer' || action === 'settleRanks' || event.TriggerName) {
    try {
      const day = String(event.dateKey || '').trim() || yesterdayKey();
      return await settleRankDay(day);
    } catch (e) {
      console.error('[puzzleGame] settleRanks', e);
      return { ok: false, code: 'ERROR', message: (e && e.message) || '结算失败' };
    }
  }

  if (!OPENID) {
    return { ok: false, code: 'NO_AUTH', message: '请先登录' };
  }

  try {
    if (action === 'adminGet' || action === 'adminSave') {
      if (!getAdminList().includes(OPENID)) {
        return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
      }
      if (action === 'adminGet') {
        const cfg = await loadPuzzleConfig(db);
        return { ok: true, data: cfg };
      }
      const saved = await savePuzzleConfig(db, event.config || event, OPENID);
      return { ok: true, data: saved, message: '已保存' };
    }

    if (action === 'status') return await status(OPENID);
    if (action === 'pick') {
      const dateKey = todayKey();
      const daily = await loadDaily(OPENID, dateKey);
      return await pickImage(daily.usedKeys || []);
    }
    if (action === 'dailyBoard') return await dailyBoard(event);
    if (action === 'rankSubmit') return await rankSubmit(OPENID, event);
    if (action === 'rankList') return await rankList(event);
    if (action === 'complete') return await complete(OPENID, event);
    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error('[puzzleGame]', action, e);
    return {
      ok: false,
      code: 'ERROR',
      message: (e && e.message) || '服务异常',
    };
  }
};
