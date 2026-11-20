/**
 * 趣味拼图：难度配置、本地进度、客户端抽图、滑动棋盘工具。
 * 难度/积分默认值可被云端 app_config/puzzle 覆盖（puzzleGame status）。
 */

import { callFunction } from '~/utils/cloud';

const STORAGE_KEY = 'puzzle_daily_v1';
const PLACED_HINT_KEY = 'puzzle_show_placed_hint';

const STYLE_BY_GRID = {
  3: { icon: 'smile', color: '#07c160', shadow: '#059669' },
  4: { icon: 'sparkles', color: '#0052D9', shadow: '#0034a5' },
};

function styleForGrid(grid) {
  return STYLE_BY_GRID[grid] || { icon: 'puzzle', color: '#0052D9', shadow: '#0034a5' };
}

/** 挑战（倒计时）默认时限：秒（仅 3×3 / 4×4） */
export const CHALLENGE_SECONDS = {
  3: 90,
  4: 150,
};

export function challengeSecondsFor(grid) {
  const g = Math.max(3, Math.min(4, Math.floor(Number(grid) || 3)));
  return CHALLENGE_SECONDS[g] || 120;
}

/**
 * 本地默认难度（云端未部署/失败时回退）。
 * 仅保留 3×3 / 4×4，便于 A* 提示可靠求解。
 * 管理端可改 reward / timeLimit；样式按 grid 固定。
 */
export const DIFFICULTIES = [
  { grid: 3, reward: 1, label: '入门', timeLimit: CHALLENGE_SECONDS[3], ...styleForGrid(3) },
  { grid: 4, reward: 2, label: '进阶', timeLimit: CHALLENGE_SECONDS[4], ...styleForGrid(4) },
];

export const DAILY_MAX_CLEARS = 5;
export const DAILY_CLEAR_BONUS = 2;
export const DEFAULT_HOWTO_MOVE = '只移动挨着空位的那一块：点一下，或拖过去，就能滑进去';

/** 计时测速 | 挑战限时 */
export const PLAY_MODE_TIMER = 'timer';
export const PLAY_MODE_CHALLENGE = 'challenge';

/** 练习随机（不进榜）| 每日同题（进日榜） */
export const PLAY_SCOPE_PRACTICE = 'practice';
export const PLAY_SCOPE_DAILY = 'daily';

export function hashSeed(input) {
  let h = 2166136261;
  const s = String(input || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSeededRandom(seed) {
  let s = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  if (!s) s = 1;
  return function rng() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function dailySeedKey(dateKey, grid, mode) {
  return `${dateKey}|${Math.floor(Number(grid) || 3)}|${mode === PLAY_MODE_CHALLENGE ? PLAY_MODE_CHALLENGE : PLAY_MODE_TIMER}`;
}

let runtimeDifficulties = DIFFICULTIES.map((d) => ({ ...d }));
let runtimeDailyMax = DAILY_MAX_CLEARS;
let runtimeDailyBonus = DAILY_CLEAR_BONUS;

/** @deprecated 兼容旧关卡语义 */
export const DAILY_LEVELS = DIFFICULTIES.map((d, i) => ({
  level: i + 1,
  grid: d.grid,
  reward: d.reward,
  label: d.label,
}));

export function decorateDifficulty(row) {
  const grid = Math.max(3, Math.min(4, Math.floor(Number(row && row.grid) || 3)));
  const style = styleForGrid(grid);
  const fallback = DIFFICULTIES.find((d) => d.grid === grid) || DIFFICULTIES[0];
  const timeLimit = Math.max(
    30,
    Math.floor(
      Number(
        row && row.timeLimit != null ? row.timeLimit : fallback.timeLimit || challengeSecondsFor(grid),
      ) || challengeSecondsFor(grid),
    ),
  );
  return {
    grid: fallback.grid,
    reward: Math.max(
      0,
      Math.floor(Number(row && row.reward != null ? row.reward : fallback.reward) || 0),
    ),
    label: fallback.label,
    timeLimit,
    icon: style.icon,
    color: style.color,
    shadow: style.shadow,
  };
}

/** 合并云端积分/时限到固定两档（3 / 4） */
export function mergeDifficulties(remoteList) {
  const byGrid = new Map();
  if (Array.isArray(remoteList)) {
    remoteList.forEach((row) => {
      if (!row) return;
      const grid = Math.floor(Number(row.grid) || 0);
      if (![3, 4].includes(grid)) return;
      byGrid.set(grid, row);
    });
  }
  return DIFFICULTIES.map((d) => decorateDifficulty({ ...d, ...(byGrid.get(d.grid) || {}) }));
}
export function getDifficulties() {
  return runtimeDifficulties.slice();
}

export function getDailyMaxClears() {
  return runtimeDailyMax;
}

export function getDailyClearBonus() {
  return runtimeDailyBonus;
}

/** 应用 puzzleGame status / admin 下发的配置 */
export function applyPuzzleConfig(cfg = {}) {
  runtimeDifficulties = mergeDifficulties(cfg.difficulties);

  const max = Math.floor(Number(cfg.dailyMax != null ? cfg.dailyMax : cfg.dailyMaxClears));
  if (Number.isFinite(max) && max >= 1) runtimeDailyMax = Math.min(30, max);

  const bonus = Math.floor(Number(cfg.dailyBonus != null ? cfg.dailyBonus : cfg.dailyClearBonus));
  if (Number.isFinite(bonus) && bonus >= 0) runtimeDailyBonus = Math.min(99, bonus);

  return {
    difficulties: getDifficulties(),
    dailyMax: runtimeDailyMax,
    dailyBonus: runtimeDailyBonus,
    enabled: cfg.enabled !== false,
  };
}

export function buildHowtoRules() {
  return [
    {
      icon: 'play',
      color: '#07c160',
      text: DEFAULT_HOWTO_MOVE,
    },
    {
      icon: 'timer',
      color: '#E37318',
      text: '两种玩法：计时测速比谁更快；挑战限时要在倒计时结束前拼完',
    },
    {
      icon: 'smile',
      color: '#07c160',
      text: '练习随机：图随便抽、可看提示，成绩不上榜，放心练手',
    },
    {
      icon: 'crown',
      color: '#0052D9',
      text: '每日冲榜：当天同难度全员同一张图、同一打乱，才能公平比拼上榜；冲榜局不能用提示',
    },
    {
      icon: 'play-circle',
      color: '#0052D9',
      text: '练习局卡住了可看广告：轻提示教滑一步，强提示连教两步',
    },
    {
      icon: 'eye',
      color: '#E37318',
      text: '右上角「剩余」= 还没摆对的块数；打开归位高亮，对上会有颜色提示',
    },
  ];
}

export function buildHowtoRewards(list = runtimeDifficulties) {
  return (list || []).map((d) => ({
    grid: d.grid,
    label: d.label,
    reward: d.reward,
    icon: d.icon,
    color: d.color,
  }));
}
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyProgress(dateKey = todayKey()) {
  return {
    dateKey,
    clearCount: 0,
    cleared: [],
    claimedPoints: 0,
    bonusClaimed: false,
    usedKeys: [],
  };
}

function normalizeProgress(raw, dateKey) {
  const cleared = Array.isArray(raw.cleared)
    ? raw.cleared.map(Number).filter((n) => n > 0)
    : [];
  const clearCount = Math.max(
    0,
    Math.floor(Number(raw.clearCount != null ? raw.clearCount : cleared.length) || 0),
  );
  return {
    dateKey,
    clearCount,
    cleared,
    claimedPoints: Math.max(0, Number(raw.claimedPoints) || 0),
    bonusClaimed: !!raw.bonusClaimed,
    usedKeys: Array.isArray(raw.usedKeys) ? raw.usedKeys.map(String) : [],
  };
}

export function readPuzzleProgress() {
  const key = todayKey();
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && typeof raw === 'object' && raw.dateKey === key) {
      return normalizeProgress(raw, key);
    }
  } catch (e) {
    /* ignore */
  }
  return emptyProgress(key);
}

export function writePuzzleProgress(progress) {
  const next = normalizeProgress(progress || {}, progress.dateKey || todayKey());
  try {
    wx.setStorageSync(STORAGE_KEY, next);
  } catch (e) {
    /* ignore */
  }
  return next;
}

export function getDifficulty(grid) {
  const g = Math.max(3, Math.min(4, Math.floor(Number(grid) || 3)));
  const list = runtimeDifficulties.length ? runtimeDifficulties : DIFFICULTIES;
  return list.find((x) => x.grid === g) || list[0] || DIFFICULTIES[0];
}

/** 尚未归位的块数（对应源码 Left = total - solved） */
export function countTilesLeft(tiles, grid) {
  const g = Math.max(1, Math.floor(Number(grid) || 1));
  let left = 0;
  for (let r = 0; r < g; r += 1) {
    for (let c = 0; c < g; c += 1) {
      const t = tiles[r * g + c];
      if (!t || t.empty) continue;
      if (t.or !== r || t.oc !== c) left += 1;
    }
  }
  return left;
}

export function rewardForGrid(grid, progress) {
  const meta = getDifficulty(grid);
  const clearCount = Math.max(0, Number(progress.clearCount) || 0);
  const quotaFull = clearCount >= runtimeDailyMax;
  // 计奖次数用尽后仍可玩 / 冲榜，只是不再发通关积分
  if (quotaFull) {
    return {
      points: 0,
      bonus: 0,
      total: 0,
      allDone: true,
      nextCount: clearCount,
      quotaFull: true,
    };
  }
  const points = meta.reward;
  let bonus = 0;
  const nextCount = clearCount + 1;
  const allDone = nextCount >= runtimeDailyMax;
  if (allDone && !progress.bonusClaimed) {
    bonus = runtimeDailyBonus;
  }
  return { points, bonus, total: points + bonus, allDone, nextCount, quotaFull: false };
}

/**
 * 从已发布合集随机抽一张「静态原图」（emojiFileIDs）。
 * 走 getPackDetail resolveSlotUrls，不扣下载积分。
 */
export async function pickPuzzleImage(usedKeys = []) {
  const used = new Set((usedKeys || []).map(String));
  const res = await callFunction('listPacks', {
    page: 1,
    pageSize: 20,
    contentType: 'emoji',
    mode: 'mixed',
  });
  const list = (res.data && res.data.list) || res.list || [];
  const candidates = list.filter((p) => p && p._id && Number(p.emojiCount) > 0);
  if (!candidates.length) {
    throw new Error('暂时没有可用合集，稍后再试');
  }

  const order = candidates
    .map((_, i) => i)
    .sort(() => Math.random() - 0.5);

  let lastErr = null;
  for (let attempt = 0; attempt < Math.min(8, order.length); attempt += 1) {
    const pack = candidates[order[attempt]];
    try {
      const detail = await callFunction('getPackDetail', { packId: pack._id });
      const data = detail.data || {};
      const count = Math.max(
        0,
        Math.floor(Number(data.emojiCount) || (Array.isArray(data.slots) ? data.slots.length : 0) || 0),
      );
      if (count <= 0) continue;

      const indexes = [];
      for (let i = 0; i < count; i += 1) {
        if (!used.has(`${pack._id}:${i}`)) indexes.push(i);
      }
      const pool = indexes.length
        ? indexes
        : Array.from({ length: count }, (_, i) => i);
      const slotIndex = pool[Math.floor(Math.random() * pool.length)];

      const resolved = await callFunction('getPackDetail', {
        packId: pack._id,
        action: 'resolveSlotUrls',
        indexes: [slotIndex],
        variant: 'static',
      });
      const row = ((resolved.data && resolved.data.slots) || []).find(
        (s) => s && Number(s.index) === slotIndex,
      );
      const imageUrl = String((row && row.staticUrl) || '').trim();
      if (!imageUrl) continue;

      const localPath = await downloadPuzzleImage(imageUrl);
      return {
        packId: pack._id,
        packTitle: data.title || pack.title || '合集',
        slotIndex,
        imageUrl,
        localPath,
        sourceKey: `${pack._id}:${slotIndex}`,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('抽图失败，请重试');
}

function downloadPuzzleImage(url) {
  const src = String(url || '').trim();
  if (!src) return Promise.reject(new Error('图片地址无效'));
  if (/^wxfile:|^https?:\/\/tmp\//i.test(src) || src.startsWith('/')) {
    return Promise.resolve(src);
  }
  return new Promise((resolve) => {
    wx.downloadFile({
      url: src,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
        } else {
          resolve(src);
        }
      },
      fail: () => resolve(src),
    });
  });
}

export function resolvePuzzleLocalPath(imageUrl) {
  return downloadPuzzleImage(imageUrl);
}

/**
 * 生成可解的滑动棋盘：从完成态做合法随机移动。
 * @param {number} grid
 * @param {string|number|function} [seedOrRng] 种子或 rng；每日挑战传入同一种子保证同题
 */
export function buildSolvableBoard(grid, seedOrRng) {
  const g = Math.max(3, Math.min(8, Math.floor(Number(grid) || 3)));
  const rng =
    typeof seedOrRng === 'function'
      ? seedOrRng
      : seedOrRng != null && seedOrRng !== ''
        ? createSeededRandom(seedOrRng)
        : Math.random;
  const tiles = [];
  for (let r = 0; r < g; r += 1) {
    for (let c = 0; c < g; c += 1) {
      tiles.push({
        or: r,
        oc: c,
        empty: r === g - 1 && c === g - 1,
      });
    }
  }
  let emptyR = g - 1;
  let emptyC = g - 1;
  const moves = g * g * 40;
  for (let i = 0; i < moves; i += 1) {
    const neighbors = [];
    if (emptyR > 0) neighbors.push({ r: emptyR - 1, c: emptyC });
    if (emptyR < g - 1) neighbors.push({ r: emptyR + 1, c: emptyC });
    if (emptyC > 0) neighbors.push({ r: emptyR, c: emptyC - 1 });
    if (emptyC < g - 1) neighbors.push({ r: emptyR, c: emptyC + 1 });
    const pick = neighbors[Math.floor(rng() * neighbors.length)];
    const ei = emptyR * g + emptyC;
    const ti = pick.r * g + pick.c;
    const tmp = tiles[ei];
    tiles[ei] = tiles[ti];
    tiles[ti] = tmp;
    emptyR = pick.r;
    emptyC = pick.c;
  }
  if (isBoardSolved(tiles, g)) {
    if (emptyC > 0) {
      const ei = emptyR * g + emptyC;
      const ti = emptyR * g + (emptyC - 1);
      const tmp = tiles[ei];
      tiles[ei] = tiles[ti];
      tiles[ti] = tmp;
      emptyC -= 1;
    }
  }
  return { tiles, emptyR, emptyC, grid: g };
}

export function isBoardSolved(tiles, grid) {
  const g = grid;
  for (let r = 0; r < g; r += 1) {
    for (let c = 0; c < g; c += 1) {
      const t = tiles[r * g + c];
      if (t.empty) {
        if (r !== g - 1 || c !== g - 1) return false;
      } else if (t.or !== r || t.oc !== c) {
        return false;
      }
    }
  }
  return true;
}

function puzzleNeighbors(emptyR, emptyC, grid) {
  const list = [];
  if (emptyR > 0) list.push({ r: emptyR - 1, c: emptyC });
  if (emptyR < grid - 1) list.push({ r: emptyR + 1, c: emptyC });
  if (emptyC > 0) list.push({ r: emptyR, c: emptyC - 1 });
  if (emptyC < grid - 1) list.push({ r: emptyR, c: emptyC + 1 });
  return list;
}

/** —— 提示求解（参考 liukaren/slider-puzzle：A* + 曼哈顿 + 线性冲突）—— */

function hintDirOf(fromR, fromC, emptyR, emptyC) {
  if (emptyR === fromR && emptyC > fromC) return 'right';
  if (emptyR === fromR && emptyC < fromC) return 'left';
  if (emptyC === fromC && emptyR > fromR) return 'down';
  if (emptyC === fromC && emptyR < fromR) return 'up';
  return 'right';
}

function makeHintMove(tiles, fromR, fromC, emptyR, emptyC, grid) {
  const t = tiles[fromR * grid + fromC];
  if (!t || t.empty) return null;
  return {
    r: fromR,
    c: fromC,
    id: `t-${t.or}-${t.oc}`,
    dir: hintDirOf(fromR, fromC, emptyR, emptyC),
    placesHome: t.or === emptyR && t.oc === emptyC,
  };
}

function puzzleStateKey(tiles) {
  let s = '';
  for (let i = 0; i < tiles.length; i += 1) {
    const t = tiles[i];
    if (!t || t.empty) s += 'e,';
    else s += `${t.or}${t.oc},`;
  }
  return s;
}

function routeBoardKey(tiles, emptyR, emptyC, grid) {
  return `${grid}|${emptyR},${emptyC}|${puzzleStateKey(tiles)}`;
}

/** 业务 tiles → 数字盘（1..n^2-1，空位=0） */
function tilesToNumericBoard(tiles, grid) {
  const g = grid;
  const board = new Array(g * g);
  let blank = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const t = tiles[i];
    if (!t || t.empty) {
      board[i] = 0;
      blank = i;
    } else {
      board[i] = t.or * g + t.oc + 1;
    }
  }
  return { board, blank };
}

function boardKey(board) {
  return board.join(',');
}

/** 曼哈顿（参考开源） */
function manhattanNumeric(board, g) {
  let distance = 0;
  for (let i = 0; i < board.length; i += 1) {
    const tile = board[i];
    if (!tile) continue;
    const goal = tile - 1;
    const gr = Math.floor(goal / g);
    const gc = goal % g;
    const r = Math.floor(i / g);
    const c = i % g;
    distance += Math.abs(gr - r) + Math.abs(gc - c);
  }
  return distance;
}

/** 线性冲突（同行/列目标块顺序颠倒，各计 1，启发里 *2） */
function linearConflictNumeric(board, g) {
  let conflicts = 0;
  for (let row = 0; row < g; row += 1) {
    for (let c1 = 0; c1 < g; c1 += 1) {
      const t1 = board[row * g + c1];
      if (!t1) continue;
      const goal1 = t1 - 1;
      if (Math.floor(goal1 / g) !== row) continue;
      for (let c2 = c1 + 1; c2 < g; c2 += 1) {
        const t2 = board[row * g + c2];
        if (!t2) continue;
        const goal2 = t2 - 1;
        if (Math.floor(goal2 / g) !== row) continue;
        if (goal1 % g > goal2 % g) conflicts += 1;
      }
    }
  }
  for (let col = 0; col < g; col += 1) {
    for (let r1 = 0; r1 < g; r1 += 1) {
      const t1 = board[r1 * g + col];
      if (!t1) continue;
      const goal1 = t1 - 1;
      if (goal1 % g !== col) continue;
      for (let r2 = r1 + 1; r2 < g; r2 += 1) {
        const t2 = board[r2 * g + col];
        if (!t2) continue;
        const goal2 = t2 - 1;
        if (goal2 % g !== col) continue;
        if (Math.floor(goal1 / g) > Math.floor(goal2 / g)) conflicts += 1;
      }
    }
  }
  return conflicts;
}

function heuristicNumeric(board, g) {
  return manhattanNumeric(board, g) + 2 * linearConflictNumeric(board, g);
}

/**
 * 启发权重 >1：更快找到解（不一定最短）。
 * 与 https://github.com/liukaren/slider-puzzle 的 HEURISTIC_FACTOR 一致。
 */
const HEURISTIC_FACTOR = 2;

function swapBoard(board, a, b) {
  const t = board[a];
  board[a] = board[b];
  board[b] = t;
}

/**
 * A* 求解 3×3 / 4×4。
 * @returns {number[]|null} 每一步后空位下标序列（不含起始）
 */
function solveNumericAStar(startBoard, startBlank, g, nodeLimit) {
  if (manhattanNumeric(startBoard, g) === 0) return [];

  const heap = [];
  const push = (node) => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      const tmp = heap[p];
      heap[p] = heap[i];
      heap[i] = tmp;
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (!heap.length || last == null) return top;
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < heap.length && heap[l].f < heap[s].f) s = l;
      if (r < heap.length && heap[r].f < heap[s].f) s = r;
      if (s === i) break;
      const tmp = heap[i];
      heap[i] = heap[s];
      heap[s] = tmp;
      i = s;
    }
    return top;
  };

  const startH = heuristicNumeric(startBoard, g);
  push({
    board: startBoard.slice(),
    blank: startBlank,
    steps: 0,
    h: startH,
    f: startH * HEURISTIC_FACTOR,
    prevBlank: -1,
    parent: null,
  });
  const bestG = new Map([[boardKey(startBoard), 0]]);
  let expanded = 0;
  const deltas = [-g, g, -1, 1];

  while (heap.length && expanded < nodeLimit) {
    const cur = pop();
    expanded += 1;
    if (cur.h === 0) {
      const path = [];
      let n = cur;
      while (n && n.parent) {
        path.push(n.blank);
        n = n.parent;
      }
      path.reverse();
      return path;
    }

    const br = Math.floor(cur.blank / g);
    const bc = cur.blank % g;
    for (let di = 0; di < 4; di += 1) {
      const d = deltas[di];
      const nb = cur.blank + d;
      if (nb < 0 || nb >= g * g) continue;
      const nr = Math.floor(nb / g);
      const nc = nb % g;
      if (Math.abs(nr - br) + Math.abs(nc - bc) !== 1) continue;
      if (nb === cur.prevBlank) continue;

      const nextBoard = cur.board.slice();
      swapBoard(nextBoard, cur.blank, nb);
      const nextSteps = cur.steps + 1;
      const key = boardKey(nextBoard);
      const known = bestG.get(key);
      if (known != null && known <= nextSteps) continue;
      bestG.set(key, nextSteps);
      const h = heuristicNumeric(nextBoard, g);
      push({
        board: nextBoard,
        blank: nb,
        steps: nextSteps,
        h,
        f: h * HEURISTIC_FACTOR + nextSteps,
        prevBlank: cur.blank,
        parent: cur,
      });
    }
  }
  return null;
}

function blankPathToHintMoves(tiles, emptyR, emptyC, grid, blankPath) {
  const g = grid;
  const moves = [];
  let tilesCur = tiles;
  let er = emptyR;
  let ec = emptyC;
  for (let i = 0; i < blankPath.length; i += 1) {
    const nb = blankPath[i];
    const nr = Math.floor(nb / g);
    const nc = nb % g;
    const move = makeHintMove(tilesCur, nr, nc, er, ec, g);
    if (!move) return moves;
    moves.push(move);
    const next = tilesCur.slice();
    const ei = er * g + ec;
    const ti = nr * g + nc;
    next[ei] = tilesCur[ti];
    next[ti] = tilesCur[ei];
    tilesCur = next;
    er = nr;
    ec = nc;
  }
  return moves;
}

/**
 * 算完整可解路线（3×3 / 4×4）。
 * 参考开源 A*，缓存后按需取 1～2 步作提示，避免贪心来回晃。
 */
export function computePuzzleRoute(tiles, emptyR, emptyC, grid, opts = {}) {
  const g = Math.max(3, Math.min(4, Math.floor(Number(grid) || 3)));
  const maxMoves = Math.max(1, Math.floor(Number(opts.maxMoves) || 64));
  if (!Array.isArray(tiles) || tiles.length !== g * g) {
    return { moves: [], complete: false, key: '' };
  }
  const key = routeBoardKey(tiles, emptyR, emptyC, g);
  if (isBoardSolved(tiles, g)) {
    return { moves: [], complete: true, key };
  }

  const { board, blank } = tilesToNumericBoard(tiles, g);
  const nodeLimit = g <= 3 ? 120000 : 250000;
  const blankPath = solveNumericAStar(board, blank, g, nodeLimit);
  if (blankPath && blankPath.length) {
    const moves = blankPathToHintMoves(tiles, emptyR, emptyC, g, blankPath);
    return {
      moves: moves.slice(0, maxMoves),
      complete: moves.length <= maxMoves && blankPath.length === moves.length,
      key,
    };
  }

  // 搜索失败兜底：邻块归位 / 启发下降
  const home = puzzleNeighbors(emptyR, emptyC, g).find((n) => {
    const t = tiles[n.r * g + n.c];
    return t && !t.empty && t.or === emptyR && t.oc === emptyC;
  });
  if (home) {
    const m = makeHintMove(tiles, home.r, home.c, emptyR, emptyC, g);
    if (m) return { moves: [m], complete: false, key };
  }
  const baseH = heuristicNumeric(board, g);
  let best = null;
  let bestScore = Infinity;
  puzzleNeighbors(emptyR, emptyC, g).forEach((n) => {
    const m = makeHintMove(tiles, n.r, n.c, emptyR, emptyC, g);
    if (!m) return;
    const nextBoard = board.slice();
    const from = n.r * g + n.c;
    swapBoard(nextBoard, blank, from);
    const h = heuristicNumeric(nextBoard, g);
    if (h < bestScore) {
      bestScore = h;
      best = m;
    }
  });
  if (best && bestScore <= baseH) return { moves: [best], complete: false, key };
  if (best) return { moves: [best], complete: false, key };
  return { moves: [], complete: false, key };
}

/**
 * 从已有路线取出接下来的提示步（light=1 / strong=2）。
 * 页面缓存完整 A* 路线，连续点提示不会重算导致来回晃。
 */
export function suggestHintPlan(tiles, emptyR, emptyC, grid, level = 'light', cachedRoute) {
  const g = Math.max(3, Math.min(4, Math.floor(Number(grid) || 3)));
  if (!Array.isArray(tiles) || tiles.length !== g * g) return null;
  if (isBoardSolved(tiles, g)) return null;

  const want = level === 'strong' ? 2 : 1;
  const key = routeBoardKey(tiles, emptyR, emptyC, g);
  let route = cachedRoute;
  if (!route || route.key !== key || !Array.isArray(route.moves) || !route.moves.length) {
    route = computePuzzleRoute(tiles, emptyR, emptyC, g, { maxMoves: 120 });
  }
  if (!route.moves.length) return null;

  const steps = route.moves.slice(0, want).map((m, i) => ({ ...m, step: i + 1 }));
  return {
    level: level === 'strong' ? 'strong' : 'light',
    steps,
    fromSolve: !!route.complete,
    route: {
      key: route.key,
      moves: route.moves.slice(),
      complete: !!route.complete,
    },
  };
}

/** @deprecated 兼容旧调用：返回第一步 */
export function suggestNextMove(tiles, emptyR, emptyC, grid, level = 'strong') {
  const plan = suggestHintPlan(tiles, emptyR, emptyC, grid, level);
  if (!plan || !plan.steps.length) return null;
  const first = plan.steps[0];
  return {
    ...first,
    level: plan.level,
    showArrow: true,
    showEmptyTarget: true,
    steps: plan.steps,
  };
}

export function calcBgLayout(imgW, imgH, boardPx) {
  const w = Math.max(1, Number(imgW) || boardPx);
  const h = Math.max(1, Number(imgH) || boardPx);
  const board = Math.max(1, Number(boardPx) || 300);
  const scale = Math.max(board / w, board / h);
  const scaledW = w * scale;
  const scaledH = h * scale;
  const offsetX = (scaledW - board) / 2;
  const offsetY = (scaledH - board) / 2;
  return { scaledW, scaledH, offsetX, offsetY, board };
}

export function formatPuzzleTime(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 是否展示「已归位」高亮，默认开 */
export function readShowPlacedHint() {
  try {
    const v = wx.getStorageSync(PLACED_HINT_KEY);
    if (v === false || v === 0 || v === '0') return false;
    if (v === true || v === 1 || v === '1') return true;
  } catch (e) {
    /* ignore */
  }
  return true;
}

export function writeShowPlacedHint(on) {
  const next = !!on;
  try {
    wx.setStorageSync(PLACED_HINT_KEY, next);
  } catch (e) {
    /* ignore */
  }
  return next;
}
