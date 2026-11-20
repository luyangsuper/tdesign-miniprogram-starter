/**
 * 管理端「积分与活动」用的拼图默认值（与云端 puzzleConfig / 拼图分包对齐）。
 * 放在 admin 分包内，避免主包残留仅分包使用的 JS。
 */

const STYLE_BY_GRID = {
  3: { icon: 'smile', color: '#07c160', shadow: '#059669' },
  4: { icon: 'sparkles', color: '#0052D9', shadow: '#0034a5' },
};

const CHALLENGE_SECONDS = {
  3: 90,
  4: 150,
};

function styleForGrid(grid) {
  return STYLE_BY_GRID[grid] || { icon: 'puzzle', color: '#0052D9', shadow: '#0034a5' };
}

function challengeSecondsFor(grid) {
  const g = Math.max(3, Math.min(4, Math.floor(Number(grid) || 3)));
  return CHALLENGE_SECONDS[g] || 120;
}

export const DAILY_MAX_CLEARS = 5;
export const DAILY_CLEAR_BONUS = 2;

export const DIFFICULTIES = [
  { grid: 3, reward: 1, label: '入门', timeLimit: CHALLENGE_SECONDS[3], ...styleForGrid(3) },
  { grid: 4, reward: 2, label: '进阶', timeLimit: CHALLENGE_SECONDS[4], ...styleForGrid(4) },
];

export function decorateDifficulty(row) {
  const grid = Math.max(3, Math.min(4, Math.floor(Number(row && row.grid) || 3)));
  const style = styleForGrid(grid);
  const fallback = DIFFICULTIES.find((d) => d.grid === grid) || DIFFICULTIES[0];
  const timeLimit = Math.max(
    30,
    Math.floor(
      Number(
        row && row.timeLimit != null
          ? row.timeLimit
          : fallback.timeLimit || challengeSecondsFor(grid),
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

export function mergeDifficulties(remoteList) {
  const byGrid = new Map();
  if (Array.isArray(remoteList)) {
    remoteList.forEach((row) => {
      if (!row) return;
      const g = Math.floor(Number(row.grid) || 0);
      if (![3, 4].includes(g)) return;
      byGrid.set(g, row);
    });
  }
  return DIFFICULTIES.map((d) => decorateDifficulty({ ...d, ...(byGrid.get(d.grid) || {}) }));
}
