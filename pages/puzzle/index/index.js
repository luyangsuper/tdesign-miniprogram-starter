import { callFunction } from '~/utils/cloud';
import { getUserProfile, resolveIsAdmin } from '~/utils/auth';
import { showPointsReward } from '~/utils/pointsReward';
import {
  DAILY_CLEAR_BONUS,
  DAILY_MAX_CLEARS,
  DIFFICULTIES,
  PLAY_MODE_CHALLENGE,
  PLAY_MODE_TIMER,
  PLAY_SCOPE_DAILY,
  PLAY_SCOPE_PRACTICE,
  applyPuzzleConfig,
  buildHowtoRewards,
  buildHowtoRules,
  buildSolvableBoard,
  calcBgLayout,
  challengeSecondsFor,
  countTilesLeft,
  formatPuzzleTime,
  getDailyClearBonus,
  getDailyMaxClears,
  getDifficulties,
  getDifficulty,
  isBoardSolved,
  pickPuzzleImage,
  readPuzzleProgress,
  readShowPlacedHint,
  resolvePuzzleLocalPath,
  rewardForGrid,
  suggestHintPlan,
  writePuzzleProgress,
  writeShowPlacedHint,
} from '../utils/puzzle';
import { destroyPuzzleAudio, getPuzzleAudio } from '../utils/puzzleAudio';
import {
  isInterstitialAdReady,
  isRewardedAdReady,
  showInterstitialAd,
  showRewardedAd,
} from '~/utils/ad';
import {
  getNativePuzzleAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';
import { getWindowInfoSafe } from '~/utils/systemInfo';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { shareAppMessage, shareTimeline } from '~/utils/share';

const HINT_DIR_ROTATE = {
  up: 'transform:rotate(-90deg);',
  down: 'transform:rotate(90deg);',
  left: 'transform:rotate(180deg);',
  right: 'transform:rotate(0deg);',
};

const GAP = 3;
const PAD = 2;
const COMMIT_RATIO = 0.28;
const TAP_SLOP = 8;
const REF_EXPANDED_KEY = 'puzzle_ref_expanded';

/** 与上方卡片同宽：按页面 16rpx 左右 padding 换算成 px */
function boardPixelSize(grid) {
  const win = getWindowInfoSafe() || {};
  const windowWidth = Number(win.windowWidth) || 375;
  const pagePad = (windowWidth * 16) / 750;
  const maxOuter = Math.max(240, Math.floor(windowWidth - pagePad * 2));
  const g = Math.max(3, Math.floor(Number(grid) || 3));
  const tile = Math.floor((maxOuter - PAD * 2 - GAP * (g - 1)) / g);
  const boardPx = PAD * 2 + tile * g + GAP * (g - 1);
  return { tilePx: tile, boardPx };
}

function readRefExpanded() {
  try {
    return !!wx.getStorageSync(REF_EXPANDED_KEY);
  } catch (e) {
    return false;
  }
}

function writeRefExpanded(on) {
  try {
    wx.setStorageSync(REF_EXPANDED_KEY, !!on);
  } catch (e) {
    /* ignore */
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

Page({
  data: {
    themeStyle: '',
    difficulties: DIFFICULTIES,
    selectedGrid: 3,
    selectedLabel: '入门',
    selectedReward: 1,
    selectedTimeLimit: challengeSecondsFor(3),
    playMode: PLAY_MODE_TIMER,
    playScope: PLAY_SCOPE_PRACTICE,
    isChallenge: false,
    isDaily: false,
    started: false,
    clearCount: 0,
    dailyMax: DAILY_MAX_CLEARS,
    rewardQuotaFull: false,
    dailyBonus: DAILY_CLEAR_BONUS,
    claimedPoints: 0,
    soundMuted: false,
    loading: false,
    reloading: false,
    loadError: '',
    packId: '',
    packTitle: '',
    slotIndex: -1,
    displaySrc: '',
    cells: [],
    boardPx: 300,
    tilePx: 100,
    moves: 0,
    secs: 0,
    timeText: '0:00',
    timeUrgent: false,
    tilesLeft: 0,
    showPlacedHint: true,
    refExpanded: false,
    howtoVisible: false,
    howtoRules: buildHowtoRules(),
    howtoRewards: buildHowtoRewards(DIFFICULTIES),
    winVisible: false,
    failVisible: false,
    rewardTip: '',
    winTimeText: '',
    hintLightReady: false,
    hintStrongReady: false,
    hintBusy: false,
    hintId: '',
    hintDir: '',
    hintArrow: '',
    hintTip: '',
    hintBarShow: false,
    hintShowEmpty: false,
    hintSteps: [],
    rankVisible: false,
    rankLoading: false,
    rankList: [],
    rankEmpty: false,
    rankTitle: '今日排行',
    rankTip: '',
    rankViewMode: PLAY_MODE_TIMER,
    rankRewardFirst: 2,
    rankRewardSecond: 1,
    rankRewardThird: 1,
    rankRewardOn: true,
    streakRewardOn: true,
    streakMinDays: 2,
    streakRewardPoints: 1,
    nativeAdUnitId: '',
    showNativeAd: false,
    hintAdFree: false,
  },

  _tiles: [],
  _emptyR: 0,
  _emptyC: 0,
  _grid: 3,
  _bg: null,
  _timer: null,
  _sourceKey: '',
  _won: false,
  _claiming: false,
  _loadSeq: 0,
  _gap: GAP,
  _pad: PAD,
  _drag: null,
  _lock: false,
  _animT1: null,
  _animT2: null,
  _pendingFinish: null,
  _hintClearT: null,
  /** 缓存的提示全路线，避免每次重算导致来回晃（仅规划用，不会一次全吐出） */
  _hintRoute: null,
  /** 本轮提示已发放的步（轻提示手动跟），跟完即停，需再次点提示 */
  _hintSession: null,
  /** 强提示自动演示中，屏蔽手势 */
  _hintAutoPlaying: false,
  _startAdBusy: false,
  _shuffleSeed: '',
  _seedKey: '',
  _timeLimit: 0,
  _failed: false,

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
    const audio = getPuzzleAudio();
    this.setData({
      soundMuted: audio.isMuted(),
      showPlacedHint: readShowPlacedHint(),
      refExpanded: readRefExpanded(),
    });
    this.refreshProgress();
    this.refreshNativeAd();
    this.refreshHintAdReady();
    this.bootstrap();
  },

  onShow() {
    applyThemeToPage(this);
    this.refreshProgress();
    this.refreshNativeAd();
    this.refreshHintAdReady();
  },

  refreshHintAdReady() {
    const adminFree = resolveIsAdmin();
    this.setData({
      hintLightReady: adminFree || isRewardedAdReady('puzzleHintLight'),
      hintStrongReady: adminFree || isRewardedAdReady('puzzleHintStrong'),
      hintAdFree: adminFree,
    });
  },

  refreshNativeAd() {
    const unitId = getNativePuzzleAdUnitId();
    this.setData({
      nativeAdUnitId: unitId,
      showNativeAd: !!unitId && shouldShowNativeAds(),
    });
  },

  /**
   * 普通用户开局/换图弹插屏；VIP、管理员免广。
   * 插屏失败不阻断开局。
   */
  async ensurePuzzleStartAd() {
    if (!shouldShowNativeAds()) return true;
    if (!isInterstitialAdReady('puzzleStart')) return true;
    try {
      await showInterstitialAd({ page: this, slot: 'puzzleStart' });
    } catch (e) {
      /* ignore */
    }
    return true;
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  async bootstrap() {
    await this.syncConfig();
    const diffs = getDifficulties();
    const selectedGrid =
      diffs.some((d) => d.grid === this.data.selectedGrid)
        ? this.data.selectedGrid
        : (diffs[0] && diffs[0].grid) || 3;
    this.applySelectedGrid(selectedGrid);
  },

  applySelectedGrid(grid) {
    const meta = getDifficulty(grid);
    this.setData({
      selectedGrid: meta.grid,
      selectedLabel: meta.label,
      selectedReward: meta.reward,
      selectedTimeLimit: meta.timeLimit || challengeSecondsFor(meta.grid),
    });
  },

  /** 是否处于对局中（含加载/结算弹窗） */
  isRoundActive() {
    return !!(
      this.data.started ||
      this.data.displaySrc ||
      this.data.loading ||
      this.data.reloading ||
      this.data.winVisible ||
      this.data.failVisible ||
      this._won ||
      this._failed
    );
  },

  /**
   * 切换玩法/题目：空闲直接改；结算弹窗中直接结束并改；对局中确认后结束并改。
   * patch 会合并进 backToIdle 的同一次 setData，避免拆两次导致界面没收干净。
   */
  endRoundThenSwitch(patch, opts = {}) {
    if (this.data.loading || this.data.reloading) {
      wx.showToast({ title: '请稍候再切换', icon: 'none' });
      return;
    }
    const nextPatch = patch && typeof patch === 'object' ? patch : null;
    if (!this.isRoundActive()) {
      if (nextPatch) this.setData(nextPatch);
      return;
    }
    // 时间到 / 已通关：本局已结束，收起后即可切换
    if (this.data.failVisible || this.data.winVisible || this._failed || this._won) {
      this._skipIdleOnPopupClose = true;
      this.backToIdle(this.data.selectedGrid, nextPatch);
      return;
    }
    wx.showModal({
      title: opts.title || '结束本局？',
      content: opts.content || '切换后需重新点开始',
      confirmText: '结束并切换',
      cancelText: '继续玩',
      success: (res) => {
        if (!res.confirm) return;
        this.backToIdle(this.data.selectedGrid, nextPatch);
      },
    });
  },

  onSelectPlayMode(e) {
    const mode = String(e.currentTarget.dataset.mode || PLAY_MODE_TIMER);
    if (mode !== PLAY_MODE_TIMER && mode !== PLAY_MODE_CHALLENGE) return;
    if (mode === this.data.playMode) return;
    this.endRoundThenSwitch(
      {
        playMode: mode,
        isChallenge: mode === PLAY_MODE_CHALLENGE,
      },
      {
        title: '切换玩法？',
        content: '当前对局会结束，切换后需再点开始',
      },
    );
  },

  onSelectPlayScope(e) {
    const scope = String(e.currentTarget.dataset.scope || PLAY_SCOPE_PRACTICE);
    if (scope !== PLAY_SCOPE_PRACTICE && scope !== PLAY_SCOPE_DAILY) return;
    if (scope === this.data.playScope) return;
    const isDaily = scope === PLAY_SCOPE_DAILY;
    this.endRoundThenSwitch(
      {
        playScope: scope,
        isDaily,
        // 练习模式不展示排行，避免误会
        rankVisible: isDaily ? this.data.rankVisible : false,
      },
      {
        title: isDaily ? '切换到每日冲榜？' : '切换到练习随机？',
        content: '当前对局会结束，切换后需再点开始',
      },
    );
  },

  /** 回到选难度态，不自动开局；extra 合并进同一次 setData */
  backToIdle(nextGrid, extra) {
    const seq = (this._loadSeq || 0) + 1;
    this._loadSeq = seq;
    this._won = false;
    this._claiming = false;
    this._hintRoute = null;
    this._hintSession = null;
    this._hintAutoPlaying = false;
    this.clearAnimTimers();
    this.clearHintTimer();
    this.clearHintHideTimer();
    this._pendingFinish = null;
    this._lock = false;
    this._drag = null;
    this._tiles = [];
    this._bg = null;
    this._sourceKey = '';
    this._shuffleSeed = '';
    this._seedKey = '';
    this._timeLimit = 0;
    this._failed = false;
    this.stopTimer();
    const meta = getDifficulty(nextGrid != null ? nextGrid : this.data.selectedGrid);
    this.setData({
      started: false,
      loading: false,
      reloading: false,
      loadError: '',
      winVisible: false,
      failVisible: false,
      rewardTip: '',
      hintId: '',
      hintDir: '',
      hintArrow: '',
      hintTip: '',
      hintBarShow: false,
      hintShowEmpty: false,
      hintSteps: [],
      hintBusy: false,
      packId: '',
      packTitle: '',
      slotIndex: -1,
      displaySrc: '',
      cells: [],
      moves: 0,
      secs: 0,
      timeText: '0:00',
      timeUrgent: false,
      tilesLeft: 0,
      selectedGrid: meta.grid,
      selectedLabel: meta.label,
      selectedReward: meta.reward,
      selectedTimeLimit: meta.timeLimit || challengeSecondsFor(meta.grid),
      ...(extra && typeof extra === 'object' ? extra : {}),
    });
  },

  /** 拉取云端难度/奖励/玩法文案，失败则沿用本地默认 */
  async syncConfig() {
    try {
      const res = await callFunction('puzzleGame', { action: 'status' });
      const data = (res && res.data) || {};
      const applied = applyPuzzleConfig(data);
      const progress = readPuzzleProgress();
      const cloudCount = Math.max(0, Math.floor(Number(data.clearCount) || 0));
      const cloudClaimed = Math.max(0, Math.floor(Number(data.claimedPoints) || 0));
      writePuzzleProgress({
        ...progress,
        clearCount: Math.max(progress.clearCount || 0, cloudCount),
        claimedPoints: Math.max(progress.claimedPoints || 0, cloudClaimed),
        bonusClaimed: !!(progress.bonusClaimed || data.bonusClaimed),
      });
      const rr = data.rankRewards || {};
      this.setData({
        difficulties: applied.difficulties,
        dailyMax: applied.dailyMax,
        dailyBonus: applied.dailyBonus,
        howtoRules: buildHowtoRules(),
        howtoRewards: buildHowtoRewards(applied.difficulties),
        clearCount: Math.max(progress.clearCount || 0, cloudCount),
        claimedPoints: Math.max(progress.claimedPoints || 0, cloudClaimed),
        rewardQuotaFull:
          Math.max(progress.clearCount || 0, cloudCount) >=
          Math.max(1, Number(applied.dailyMax) || DAILY_MAX_CLEARS),
        rankRewardOn: rr.enabled !== false,
        rankRewardFirst: Math.max(0, Number(rr.first) || 0),
        rankRewardSecond: Math.max(0, Number(rr.second) || 0),
        rankRewardThird: Math.max(0, Number(rr.third) || 0),
        streakRewardOn: rr.streakEnabled !== false,
        streakMinDays: Math.max(2, Number(rr.streakMinDays) || 2),
        streakRewardPoints: Math.max(0, Number(rr.streakReward) || 0),
      });
    } catch (e) {
      const fallbackMax = getDailyMaxClears();
      const progress = readPuzzleProgress();
      this.setData({
        difficulties: getDifficulties(),
        dailyMax: fallbackMax,
        dailyBonus: getDailyClearBonus(),
        howtoRewards: buildHowtoRewards(getDifficulties()),
        rewardQuotaFull: (progress.clearCount || 0) >= fallbackMax,
      });
    }
  },

  onUnload() {
    this.clearAnimTimers();
    this.clearHintTimer();
    this.clearHintHideTimer();
    this._pendingFinish = null;
    this._lock = false;
    this._drag = null;
    this.stopTimer();
    destroyPuzzleAudio();
  },

  clearHintTimer() {
    if (this._hintClearT) {
      clearTimeout(this._hintClearT);
      this._hintClearT = null;
    }
  },

  clearHintHideTimer() {
    if (this._hintHideT) {
      clearTimeout(this._hintHideT);
      this._hintHideT = null;
    }
  },

  clearMoveHint(clearRoute) {
    this.clearHintTimer();
    this._hintSession = null;
    if (clearRoute) this._hintRoute = null;
    // 不强行打断正在播的自动演示结束回调，由 playStrongHintAuto 收尾
    const hadBoard =
      !!this.data.hintId || !!(this.data.hintSteps || []).length;
    const hadBar = !!this.data.hintBarShow || !!this.data.hintTip;
    if (!hadBoard && !hadBar) return;

    const next = {
      hintId: '',
      hintDir: '',
      hintArrow: '',
      hintShowEmpty: false,
      hintSteps: [],
      hintBarShow: false,
    };
    if (hadBoard) {
      next.cells = this.buildCells(null, null, null, {
        hintId: '',
        hintDir: '',
        hintShowEmpty: false,
        hintShowArrow: false,
        hintSteps: [],
      });
    }
    this.setData(next);
    // 等收起动画后再清文案，避免闪空
    this.clearHintHideTimer();
    if (hadBar) {
      this._hintHideT = setTimeout(() => {
        this._hintHideT = null;
        if (!this.data.hintBarShow) this.setData({ hintTip: '' });
      }, 280);
    } else {
      this.setData({ hintTip: '' });
    }
  },

  boardHintKey() {
    const g = this._grid;
    const tiles = this._tiles || [];
    let s = `${g}|${this._emptyR},${this._emptyC}|`;
    for (let i = 0; i < tiles.length; i += 1) {
      const t = tiles[i];
      if (!t || t.empty) s += 'e,';
      else s += `${t.or}${t.oc},`;
    }
    return s;
  },

  refreshStepOnBoard(step) {
    if (!step) return null;
    const g = this._grid;
    let r = Number(step.r);
    let c = Number(step.c);
    let tile = this._tiles[r * g + c];
    if (!tile || tile.empty || `t-${tile.or}-${tile.oc}` !== step.id) {
      let found = null;
      for (let rr = 0; rr < g && !found; rr += 1) {
        for (let cc = 0; cc < g; cc += 1) {
          const t = this._tiles[rr * g + cc];
          if (t && !t.empty && `t-${t.or}-${t.oc}` === step.id) {
            found = { r: rr, c: cc, t };
            break;
          }
        }
      }
      if (!found) return null;
      r = found.r;
      c = found.c;
      tile = found.t;
    }
    if (!this.isAdjacentToEmpty(r, c)) return null;
    const er = this._emptyR;
    const ec = this._emptyC;
    const dir =
      er === r && ec > c
        ? 'right'
        : er === r && ec < c
          ? 'left'
          : ec === c && er > r
            ? 'down'
            : 'up';
    return {
      ...step,
      r,
      c,
      dir,
      placesHome: !!(tile && er === tile.or && ec === tile.oc),
    };
  },

  showHintSessionSteps(steps, opts = {}) {
    if (!steps || !steps.length) {
      this.clearMoveHint(false);
      this.setData({ cells: this.buildCells() });
      return;
    }
    this.clearHintTimer();
    this.clearHintHideTimer();
    const normalized = steps.map((s, i) => ({ ...s, step: i + 1 }));
    const first = normalized[0];
    const tip = opts.auto
      ? normalized.length >= 2
        ? '强提示演示：自动走两步'
        : '强提示演示：自动走一步'
      : normalized.length >= 2
        ? '本轮两步：先①后②（跟完需再点提示）'
        : first.placesHome
          ? '本轮一步：滑进空位即可归位'
          : opts.continued
            ? '本轮剩余：顺着箭头滑'
            : '本轮一步：顺着箭头滑进空位';
    this.setData({
      hintId: first.id,
      hintDir: first.dir || '',
      hintArrow: HINT_DIR_ROTATE[first.dir] || HINT_DIR_ROTATE.right,
      hintTip: tip,
      hintBarShow: true,
      hintShowEmpty: true,
      hintSteps: normalized,
      cells: this.buildCells(null, null, null, {
        hintId: first.id,
        hintDir: first.dir || '',
        hintShowEmpty: true,
        hintShowArrow: true,
        hintSteps: normalized,
      }),
    });
    // 自动演示由 playStrongHintAuto 自己清；手动提示才限时消失
    if (!opts.auto) {
      this._hintClearT = setTimeout(
        () => this.clearMoveHint(false),
        normalized.length >= 2 ? 16000 : 12000,
      );
    }
  },

  applyHintPlan(plan) {
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return;
    if (plan.route && Array.isArray(plan.route.moves)) {
      this._hintRoute = {
        key: plan.route.key || this.boardHintKey(),
        moves: plan.route.moves.slice(),
        complete: !!plan.route.complete,
      };
    }
    // 轻提示：只发放本轮步，手动跟着滑
    this._hintSession = plan.steps.map((s) => ({ ...s }));
    this.showHintSessionSteps(this._hintSession, { continued: !!plan.continued });
  },

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * 强提示：自动演示最多两步，让用户看见怎么走。
   */
  async playStrongHintAuto(plan) {
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return;
    if (plan.route && Array.isArray(plan.route.moves)) {
      this._hintRoute = {
        key: plan.route.key || this.boardHintKey(),
        moves: plan.route.moves.slice(),
        complete: !!plan.route.complete,
      };
    }
    this._hintSession = null;
    this._hintAutoPlaying = true;
    this.clearHintTimer();
    this._drag = null;

    const total = Math.min(2, plan.steps.length);
    try {
      for (let i = 0; i < total; i += 1) {
        if (this._won || this._failed || this.data.reloading || !this._hintAutoPlaying) break;
        const raw =
          this._hintRoute && Array.isArray(this._hintRoute.moves) && this._hintRoute.moves[0]
            ? this._hintRoute.moves[0]
            : plan.steps[i];
        const step = this.refreshStepOnBoard(raw);
        if (!step) break;

        // 第一步时尽量同时标出①②预告；之后只标当前步
        let preview = [step];
        if (i === 0 && total >= 2) {
          const secondRaw =
            this._hintRoute && Array.isArray(this._hintRoute.moves) && this._hintRoute.moves[1]
              ? this._hintRoute.moves[1]
              : plan.steps[1];
          if (secondRaw) preview = [step, { ...secondRaw, step: 2 }];
        }
        this.showHintSessionSteps(preview, { auto: true, continued: i > 0 });
        await this.sleep(300);
        if (this._won || this._failed || !this._hintAutoPlaying) break;

        const result = await this.swapAdjacentAnimated(step.r, step.c, step.id, {
          skipHintAdvance: true,
        });
        if (this._hintRoute && Array.isArray(this._hintRoute.moves) && this._hintRoute.moves.length) {
          this._hintRoute.moves.shift();
          this._hintRoute.key = this.boardHintKey();
        }
        if (result && result.won) break;
        if (i + 1 < total) await this.sleep(160);
      }
    } finally {
      this._hintAutoPlaying = false;
      this.clearMoveHint(false);
      if (!this._won && !this._failed) {
        this.setData({ cells: this.buildCells() });
      }
    }
  },

  /**
   * 玩家滑对了本轮提示的当前步 → 若本轮还有下一步则展示；
   * 本轮用完即停（需再次点提示）；滑错则清空规划。
   */
  advanceHintAfterMove(movedId, fromR, fromC) {
    if (this._hintAutoPlaying) return;
    const session = this._hintSession || [];
    const steps = this.data.hintSteps || [];
    if (!session.length || !steps.length) return;

    const first = steps[0];
    const matched =
      first &&
      first.id === movedId &&
      Number(first.r) === Number(fromR) &&
      Number(first.c) === Number(fromC);
    if (!matched) {
      this.clearMoveHint(true);
      this.setData({ cells: this.buildCells() });
      return;
    }

    // 同步消费全路线缓存（供下次点提示接着走，避免重算来回晃）
    if (this._hintRoute && Array.isArray(this._hintRoute.moves) && this._hintRoute.moves.length) {
      this._hintRoute.moves.shift();
      this._hintRoute.key = this.boardHintKey();
    }

    // 消费本轮第一步
    this._hintSession = session.slice(1);
    if (!this._hintSession.length) {
      // 本轮额度用尽：清界面，保留路线缓存供下次点提示接着规划
      this.clearMoveHint(false);
      this.setData({ cells: this.buildCells() });
      return;
    }

    const next = this.refreshStepOnBoard(this._hintSession[0]);
    if (!next) {
      // 盘面与本轮剩余步对不上：丢掉本轮，保留/清空路线下次重算
      this._hintSession = null;
      this._hintRoute = null;
      this.clearMoveHint(false);
      this.setData({ cells: this.buildCells() });
      return;
    }
    this._hintSession[0] = next;
    this.showHintSessionSteps(this._hintSession, { continued: true });
  },

  onHintLightTap() {
    this.requestHint('light');
  },

  onHintStrongTap() {
    this.requestHint('strong');
  },

  async requestHint(level) {
    const isLight = level === 'light';
    const slot = isLight ? 'puzzleHintLight' : 'puzzleHintStrong';
    if (
      this._won ||
      this._failed ||
      this.data.loading ||
      this.data.reloading ||
      this.data.hintBusy ||
      !this.data.displaySrc
    ) {
      return;
    }
    // 每日冲榜禁用提示，保证公平
    if (this.data.playScope === PLAY_SCOPE_DAILY || this.data.isDaily) {
      wx.showToast({ title: '冲榜模式不可用提示', icon: 'none' });
      return;
    }
    if (this.data.tilesLeft <= 0) {
      wx.showToast({ title: '已经拼好了', icon: 'none' });
      return;
    }

    // 管理员视图免广告，方便自测；「预览普通用户」时仍走广告
    const adminFree = resolveIsAdmin();
    if (!adminFree) {
      if (!isRewardedAdReady(slot)) {
        wx.showToast({ title: '暂未配置该提示广告', icon: 'none' });
        return;
      }
      const confirm = await new Promise((resolve) => {
        wx.showModal({
          title: isLight ? '看广告 · 轻提示' : '看广告 · 强提示',
          content: isLight
            ? '完整观看后，标出下一步该往哪滑'
            : '完整观看后，自动帮你演示走两步',
          confirmText: '去观看',
          cancelText: '取消',
          success: (res) => resolve(!!res.confirm),
          fail: () => resolve(false),
        });
      });
      if (!confirm) return;
    }

    this.setData({ hintBusy: true });
    try {
      if (!adminFree) {
        const watched = await showRewardedAd({ page: this, slot });
        if (!watched) {
          wx.showToast({ title: '需完整观看才能获得提示', icon: 'none' });
          return;
        }
      }
      if (this._won || this._failed || this.data.reloading) return;
      // 让出一帧，先画出 hintBusy，避免 4×4+ 规划时界面假死无反馈
      await this.sleep(16);
      if (this._won || this._failed || this.data.reloading) return;
      // 同一盘面复用缓存路线，连续点提示不会重新贪心导致来回晃
      const plan = suggestHintPlan(
        this._tiles,
        this._emptyR,
        this._emptyC,
        this._grid,
        isLight ? 'light' : 'strong',
        this._hintRoute,
      );
      if (!plan) {
        this._hintRoute = null;
        wx.showToast({ title: '暂时没有可提示的走法', icon: 'none' });
        return;
      }
      if (isLight) {
        // 文案只走棋盘底部提示条，避免再弹 toast 叠两条
        this.applyHintPlan(plan);
      } else {
        // 演示期间保持 busy，防止连点；文案由棋盘提示条展示
        await this.playStrongHintAuto(plan);
      }
    } finally {
      this.setData({ hintBusy: false });
    }
  },

  refreshProgress() {
    const progress = readPuzzleProgress();
    const clearCount = progress.clearCount || 0;
    const dailyMax = Math.max(1, Number(this.data.dailyMax) || getDailyMaxClears());
    this.setData({
      clearCount,
      claimedPoints: progress.claimedPoints || 0,
      rewardQuotaFull: clearCount >= dailyMax,
    });
  },

  onToggleMute() {
    const audio = getPuzzleAudio();
    const next = !audio.isMuted();
    audio.setMuted(next);
    this.setData({ soundMuted: next });
  },

  onPlacedHintChange(e) {
    const on = !!(e && e.detail && e.detail.value);
    writeShowPlacedHint(on);
    this.setData({ showPlacedHint: on });
  },

  onToggleRef() {
    const next = !this.data.refExpanded;
    writeRefExpanded(next);
    this.setData({ refExpanded: next });
  },

  onOpenHowto() {
    this.setData({ howtoVisible: true });
  },

  onCloseHowto() {
    this.setData({ howtoVisible: false });
  },

  onHowtoVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    if (!visible) this.setData({ howtoVisible: false });
  },

  onSelectDifficulty(e) {
    const grid = Math.floor(Number(e.currentTarget.dataset.grid) || 3);
    if (grid === this.data.selectedGrid && !this.data.started && !this.data.loading) {
      return;
    }
    if (!this.data.started && !this.data.loading && !this.data.reloading && !this.data.displaySrc) {
      this.applySelectedGrid(grid);
      return;
    }
    if (grid === this.data.selectedGrid) return;
    // 已失败/通关：直接回空闲并换难度
    if (this.data.failVisible || this.data.winVisible || this._failed || this._won) {
      this.backToIdle(grid);
      return;
    }
    wx.showModal({
      title: '切换难度？',
      content: '当前这一局会结束，切换后需再点开始',
      confirmText: '切换',
      success: (res) => {
        if (!res.confirm) return;
        this.backToIdle(grid);
      },
    });
  },

  async onStartRound() {
    if (this.data.loading || this.data.reloading || this.data.hintBusy || this._startAdBusy) {
      return;
    }
    this._startAdBusy = true;
    try {
      if (!(await this.ensurePuzzleStartAd())) return;
      this.loadRound(this.data.selectedGrid);
    } finally {
      this._startAdBusy = false;
    }
  },

  /** 实测 board-wrap 宽度，保证与上方卡片同宽 */
  measureBoardSize(grid) {
    const fallback = boardPixelSize(grid);
    return new Promise((resolve) => {
      wx.nextTick(() => {
        wx.createSelectorQuery()
          .in(this)
          .select('.puzzle__board-wrap')
          .boundingClientRect((rect) => {
            const w = rect && Number(rect.width) > 0 ? Math.floor(rect.width) : 0;
            if (!w) {
              resolve(fallback);
              return;
            }
            const g = Math.max(3, Math.floor(Number(grid) || 3));
            const tile = Math.floor((w - PAD * 2 - GAP * (g - 1)) / g);
            const boardPx = PAD * 2 + tile * g + GAP * (g - 1);
            resolve({ tilePx: tile, boardPx: Math.min(boardPx, w) });
          })
          .exec();
      });
    });
  },

  isLoadStale(seq) {
    return seq !== this._loadSeq;
  },

  async loadRound(grid) {
    const seq = (this._loadSeq || 0) + 1;
    this._loadSeq = seq;

    this._won = false;
    this._failed = false;
    this._claiming = false;
    this._hintRoute = null;
    this._hintSession = null;
    this._hintAutoPlaying = false;
    this.clearAnimTimers();
    this._pendingFinish = null;
    this._lock = false;
    this._drag = null;
    this.stopTimer();

    const meta = getDifficulty(grid);
    const isChallenge = this.data.playMode === PLAY_MODE_CHALLENGE;
    const isDaily = this.data.playScope === PLAY_SCOPE_DAILY;
    const timeLimit = meta.timeLimit || challengeSecondsFor(meta.grid);
    this._timeLimit = isChallenge ? timeLimit : 0;
    this._shuffleSeed = '';
    this._seedKey = '';

    let { tilePx, boardPx } = boardPixelSize(meta.grid);
    this._gap = GAP;
    this._pad = PAD;

    // 已有内容时软刷新：保留布局与原图区，棋盘上叠「换图中」，避免整页只剩 loading
    const soft = !!this.data.displaySrc;
    const initSecs = isChallenge ? timeLimit : 0;
    this.clearHintTimer();
    this.clearHintHideTimer();
    this.setData({
      selectedGrid: meta.grid,
      selectedLabel: meta.label,
      selectedReward: meta.reward,
      selectedTimeLimit: timeLimit,
      isChallenge,
      isDaily,
      started: true,
      loading: soft ? false : true,
      reloading: soft,
      loadError: '',
      winVisible: false,
      failVisible: false,
      rewardTip: '',
      hintId: '',
      hintDir: '',
      hintArrow: '',
      hintTip: '',
      hintBarShow: false,
      hintShowEmpty: false,
      hintSteps: [],
      moves: 0,
      secs: initSecs,
      timeText: formatPuzzleTime(initSecs),
      timeUrgent: false,
      tilesLeft: 0,
      tilePx,
      boardPx,
      cells: [],
      ...(soft
        ? {}
        : {
            packTitle: '',
            packId: '',
            displaySrc: '',
          }),
    });

    try {
      let picked;
      if (isDaily) {
        const res = await callFunction('puzzleGame', {
          action: 'dailyBoard',
          grid: meta.grid,
          mode: this.data.playMode,
        });
        const data = (res && res.data) || {};
        if (!data.imageUrl) throw new Error((res && res.message) || '今日题目加载失败');
        const localPath = await resolvePuzzleLocalPath(data.imageUrl);
        picked = {
          packId: data.packId,
          packTitle: data.packTitle || '今日同题',
          slotIndex: data.slotIndex,
          imageUrl: data.imageUrl,
          localPath,
          sourceKey: `${data.packId}:${data.slotIndex}`,
          shuffleSeed: data.shuffleSeed,
          seedKey: data.seedKey,
          timeLimit: data.timeLimit || timeLimit,
        };
        this._shuffleSeed = String(data.shuffleSeed || '');
        this._seedKey = String(data.seedKey || '');
        if (isChallenge && picked.timeLimit) {
          this._timeLimit = picked.timeLimit;
        }
      } else {
        const progress = readPuzzleProgress();
        picked = await pickPuzzleImage(progress.usedKeys || []);
      }
      if (this.isLoadStale(seq)) return;

      const info = await new Promise((resolve, reject) => {
        wx.getImageInfo({
          src: picked.localPath || picked.imageUrl,
          success: resolve,
          fail: reject,
        });
      });
      if (this.isLoadStale(seq)) return;

      const startSecs = isChallenge ? this._timeLimit || timeLimit : 0;
      this.setData({
        packId: picked.packId,
        packTitle: picked.packTitle,
        slotIndex: picked.slotIndex,
        displaySrc: picked.localPath || picked.imageUrl,
        loading: false,
        secs: startSecs,
        timeText: formatPuzzleTime(startSecs),
        selectedTimeLimit: this._timeLimit || timeLimit,
      });

      const measured = await this.measureBoardSize(meta.grid);
      if (this.isLoadStale(seq)) return;
      tilePx = measured.tilePx;
      boardPx = measured.boardPx;
      this.setData({ tilePx, boardPx });

      const contentSize = tilePx * meta.grid;
      const bg = calcBgLayout(info.width, info.height, contentSize);
      this._bg = bg;
      this._sourceKey = picked.sourceKey;
      this.startBoard(
        meta.grid,
        picked.localPath || picked.imageUrl,
        bg,
        tilePx,
        this._shuffleSeed || null,
      );
      if (this.isLoadStale(seq)) return;
      this.setData({ reloading: false, loading: false, loadError: '' });
      this.startTimer();
    } catch (e) {
      if (this.isLoadStale(seq)) return;
      this.setData({
        started: false,
        loading: false,
        reloading: false,
        displaySrc: '',
        cells: [],
        loadError: (e && e.message) || '加载失败，请重试',
      });
    }
  },

  startBoard(grid, src, bg, tilePx, shuffleSeed) {
    const built = buildSolvableBoard(grid, shuffleSeed || undefined);
    this._tiles = built.tiles;
    this._emptyR = built.emptyR;
    this._emptyC = built.emptyC;
    this._grid = built.grid;
    this._drag = null;
    this._hintRoute = null;
    this._hintSession = null;
    this._hintAutoPlaying = false;
    this.clearHintTimer();
    this.clearHintHideTimer();
    this.setData({
      hintId: '',
      hintDir: '',
      hintArrow: '',
      hintTip: '',
      hintBarShow: false,
      hintShowEmpty: false,
      hintSteps: [],
      cells: this.buildCells(src, bg, tilePx),
      moves: 0,
      tilesLeft: countTilesLeft(this._tiles, this._grid),
    });
  },

  cellOrigin(r, c, tilePx) {
    const size = tilePx || this.data.tilePx;
    return {
      left: this._pad + c * (size + this._gap),
      top: this._pad + r * (size + this._gap),
    };
  },

  buildCells(src, bg, tilePx, opts = {}) {
    const g = this._grid;
    const tiles = this._tiles;
    const url = src || this.data.displaySrc;
    const layout = bg || this._bg;
    const size = tilePx || this.data.tilePx;
    if (!layout || !url) return [];

    const dragId = opts.dragId || '';
    const animatingId = opts.animatingId || '';
    const activeId = opts.activeId || dragId || '';
    const hintId = opts.hintId != null ? opts.hintId : this.data.hintId;
    const hintDir = opts.hintDir != null ? opts.hintDir : this.data.hintDir;
    const hintShowEmpty =
      opts.hintShowEmpty != null ? opts.hintShowEmpty : this.data.hintShowEmpty;
    const hintSteps =
      opts.hintSteps != null ? opts.hintSteps : this.data.hintSteps || [];
    const hintById = new Map();
    (hintSteps || []).forEach((s) => {
      if (s && s.id) hintById.set(s.id, s);
    });
    const hintShowArrow =
      opts.hintShowArrow != null
        ? opts.hintShowArrow
        : !!(hintId && hintDir);
    const posMap = opts.pos || null;
    const safeUrl = String(url).replace(/["'\\]/g, '');

    const cells = [];
    for (let r = 0; r < g; r += 1) {
      for (let c = 0; c < g; c += 1) {
        const t = tiles[r * g + c];
        const id = t.empty ? 'empty' : `t-${t.or}-${t.oc}`;
        const origin = this.cellOrigin(r, c, size);
        const override = posMap && posMap[id];
        const left = override && override.left != null ? override.left : origin.left;
        const top = override && override.top != null ? override.top : origin.top;
        const dragging = !t.empty && dragId === id;
        const active = !t.empty && activeId === id;
        const stepInfo = !t.empty ? hintById.get(id) : null;
        const hinted = !t.empty && (!!stepInfo || (!!hintId && hintId === id));
        const hintPrimary = !!(hinted && ((stepInfo && stepInfo.step === 1) || (!stepInfo && hintId === id)));
        const hintStepNo = stepInfo ? stepInfo.step : hinted ? 1 : 0;
        const stepDir = (stepInfo && stepInfo.dir) || (hintPrimary ? hintDir : '');
        const tx = dragging ? Number(opts.tx) || 0 : override && override.tx != null ? override.tx : 0;
        const ty = dragging ? Number(opts.ty) || 0 : override && override.ty != null ? override.ty : 0;
        const scale = dragging ? 1.04 : 1;

        if (t.empty) {
          cells.push({
            id,
            r,
            c,
            empty: true,
            dragging: false,
            animating: false,
            active: false,
            hinted: false,
            hintPrimary: false,
            hintStepNo: 0,
            hintTarget: !!(hintId && hintShowEmpty),
            hintArrow: '',
            style: `left:${origin.left}px;top:${origin.top}px;width:${size}px;height:${size}px;`,
          });
          continue;
        }

        const posX = -(t.oc * size + layout.offsetX);
        const posY = -(t.or * size + layout.offsetY);
        const style = [
          `left:${left}px`,
          `top:${top}px`,
          `width:${size}px`,
          `height:${size}px`,
          `transform:translate(${tx}px,${ty}px) scale(${scale})`,
          `background-image:url("${safeUrl}")`,
          `background-size:${layout.scaledW}px ${layout.scaledH}px`,
          `background-position:${posX}px ${posY}px`,
        ].join(';');

        cells.push({
          id,
          r,
          c,
          empty: false,
          dragging,
          active,
          hinted,
          hintPrimary,
          hintStepNo,
          hintTarget: false,
          hintArrow:
            hintPrimary && hintShowArrow && stepDir
              ? HINT_DIR_ROTATE[stepDir] || HINT_DIR_ROTATE.right
              : '',
          placed: t.or === r && t.oc === c,
          animating: animatingId === id,
          style,
        });
      }
    }
    return cells;
  },

  startTimer() {
    this.stopTimer();
    const isChallenge = this.data.playMode === PLAY_MODE_CHALLENGE;
    this._timer = setInterval(() => {
      if (this._won || this._failed) return;
      if (isChallenge) {
        const left = Math.max(0, (this.data.secs || 0) - 1);
        this.setData({
          secs: left,
          timeText: formatPuzzleTime(left),
          timeUrgent: left <= 10,
        });
        if (left <= 0) this.onTimeUp();
        return;
      }
      const secs = (this.data.secs || 0) + 1;
      this.setData({ secs, timeText: formatPuzzleTime(secs), timeUrgent: false });
    }, 1000);
  },

  elapsedSeconds() {
    if (this.data.playMode === PLAY_MODE_CHALLENGE) {
      return Math.max(0, (this._timeLimit || 0) - (this.data.secs || 0));
    }
    return Math.max(0, this.data.secs || 0);
  },

  onTimeUp() {
    if (this._won || this._failed || this._claiming) return;
    this._failed = true;
    this.stopTimer();
    this.flushLock();
    getPuzzleAudio().playBounce();
    this.setData({
      failVisible: true,
      secs: 0,
      timeText: '0:00',
      timeUrgent: true,
    });
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  isAdjacentToEmpty(r, c) {
    const er = this._emptyR;
    const ec = this._emptyC;
    const dr = Math.abs(r - er);
    const dc = Math.abs(c - ec);
    return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
  },

  clearAnimTimers() {
    if (this._animT1) {
      clearTimeout(this._animT1);
      this._animT1 = null;
    }
    if (this._animT2) {
      clearTimeout(this._animT2);
      this._animT2 = null;
    }
  },

  /** 上一段动画未结束时立刻收尾，避免连点无响应 */
  flushLock() {
    this.clearAnimTimers();
    const finish = this._pendingFinish;
    this._pendingFinish = null;
    if (typeof finish === 'function') {
      try {
        finish();
      } catch (e) {
        /* ignore */
      }
    }
    this._lock = false;
    this._drag = null;
  },

  onBoardTouchMove() {},

  onTileTouchStart(e) {
    if (
      this._won ||
      this._failed ||
      this.data.loading ||
      this.data.reloading ||
      this._hintAutoPlaying ||
      this.data.hintBusy
    ) {
      return;
    }
    if (this._lock) this.flushLock();
    if (this._drag) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const r = Number(e.currentTarget.dataset.r);
    const c = Number(e.currentTarget.dataset.c);
    const id = e.currentTarget.dataset.id;
    if (!id || id === 'empty') return;
    if (!this.isAdjacentToEmpty(r, c)) return;

    const axis = r === this._emptyR ? 'x' : 'y';
    const dir =
      axis === 'x'
        ? this._emptyC > c
          ? 1
          : -1
        : this._emptyR > r
          ? 1
          : -1;

    this._drag = {
      id,
      r,
      c,
      axis,
      dir,
      maxTravel: this.data.tilePx + this._gap,
      startX: touch.clientX,
      startY: touch.clientY,
      tx: 0,
      ty: 0,
      moved: false,
    };
    // 按下即高亮当前块
    this.setData({
      cells: this.buildCells(null, null, null, {
        dragId: id,
        activeId: id,
        tx: 0,
        ty: 0,
      }),
    });
  },

  onTileTouchMove(e) {
    const drag = this._drag;
    if (!drag || this._lock) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;

    let tx = touch.clientX - drag.startX;
    let ty = touch.clientY - drag.startY;

    if (drag.axis === 'x') {
      ty = 0;
      tx = drag.dir > 0 ? clamp(tx, 0, drag.maxTravel) : clamp(tx, -drag.maxTravel, 0);
    } else {
      tx = 0;
      ty = drag.dir > 0 ? clamp(ty, 0, drag.maxTravel) : clamp(ty, -drag.maxTravel, 0);
    }

    drag.tx = tx;
    drag.ty = ty;
    const travel = Math.abs(tx) + Math.abs(ty);
    if (travel > TAP_SLOP) drag.moved = true;

    this.setData({
      cells: this.buildCells(null, null, null, {
        dragId: drag.id,
        activeId: drag.id,
        tx,
        ty,
      }),
    });
  },

  onTileTouchEnd() {
    const drag = this._drag;
    if (!drag) return;
    // 动画锁期间的 touchend 直接丢掉，等下次 touchstart 会 flush
    if (this._lock) {
      this._drag = null;
      return;
    }
    this._drag = null;

    const travel = drag.axis === 'x' ? Math.abs(drag.tx) : Math.abs(drag.ty);
    const commit = travel >= drag.maxTravel * COMMIT_RATIO;
    const isTap = !drag.moved && travel < TAP_SLOP;

    if (isTap || commit) {
      this.animateThenSwap(drag);
      return;
    }

    getPuzzleAudio().playBounce();
    this.clearAnimTimers();
    this._lock = true;
    const origin = this.cellOrigin(drag.r, drag.c);
    const unlock = () => {
      this._pendingFinish = null;
      this._lock = false;
      this.setData({ cells: this.buildCells() });
    };
    this._pendingFinish = unlock;
    this.setData({
      cells: this.buildCells(null, null, null, {
        animatingId: drag.id,
        pos: {
          [drag.id]: { left: origin.left, top: origin.top, tx: drag.tx, ty: drag.ty },
        },
      }),
    });
    this._animT1 = setTimeout(() => {
      this.setData({
        cells: this.buildCells(null, null, null, { animatingId: drag.id }),
      });
      this._animT2 = setTimeout(unlock, 170);
    }, 16);
  },

  /**
   * 把 (r,c) 滑进空位并播动画；返回 Promise<{won}>。
   * skipHintAdvance：强提示自动演示时不要走「跟提示」逻辑。
   */
  swapAdjacentAnimated(r, c, id, opts = {}) {
    return new Promise((resolve) => {
      if (this._won || this._failed) {
        resolve({ won: false, skipped: true });
        return;
      }
      if (!this.isAdjacentToEmpty(r, c)) {
        resolve({ won: false, skipped: true });
        return;
      }
      if (this._lock) this.flushLock();

      const axis = r === this._emptyR ? 'x' : 'y';
      const dir =
        axis === 'x'
          ? this._emptyC > c
            ? 1
            : -1
          : this._emptyR > r
            ? 1
            : -1;
      const maxTravel = this.data.tilePx + this._gap;
      const tx = Number(opts.tx) || 0;
      const ty = Number(opts.ty) || 0;
      const targetTx = axis === 'x' ? dir * maxTravel : 0;
      const targetTy = axis === 'y' ? dir * maxTravel : 0;
      const already = Math.abs((axis === 'x' ? tx : ty) || 0) >= maxTravel * 0.92;

      this.clearAnimTimers();
      this._lock = true;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this._pendingFinish = null;
        this.clearAnimTimers();
        const g = this._grid;
        const er = this._emptyR;
        const ec = this._emptyC;
        const ei = er * g + ec;
        const ti = r * g + c;
        const tmp = this._tiles[ei];
        this._tiles[ei] = this._tiles[ti];
        this._tiles[ti] = tmp;
        this._emptyR = r;
        this._emptyC = c;
        const moves = (this.data.moves || 0) + 1;
        this._lock = false;
        getPuzzleAudio().playSnap();
        const won = isBoardSolved(this._tiles, g);
        this.setData({
          moves,
          tilesLeft: countTilesLeft(this._tiles, g),
        });
        if (!opts.skipHintAdvance && (this.data.hintSteps || []).length) {
          this.advanceHintAfterMove(id, r, c);
        } else if (!this._hintAutoPlaying) {
          this.setData({ cells: this.buildCells() });
        } else {
          // 自动演示中：保持当前高亮，外层会继续刷
          this.setData({ cells: this.buildCells() });
        }
        if (won) this.onWin();
        resolve({ won });
      };

      this._pendingFinish = finish;
      if (already) {
        finish();
        return;
      }

      const origin = this.cellOrigin(r, c);
      this.setData({
        cells: this.buildCells(null, null, null, {
          animatingId: id,
          hintId: this.data.hintId,
          hintDir: this.data.hintDir,
          hintShowEmpty: this.data.hintShowEmpty,
          hintShowArrow: true,
          hintSteps: this.data.hintSteps,
          pos: {
            [id]: { left: origin.left, top: origin.top, tx: tx || 0, ty: ty || 0 },
          },
        }),
      });
      this._animT1 = setTimeout(() => {
        this.setData({
          cells: this.buildCells(null, null, null, {
            animatingId: id,
            hintId: this.data.hintId,
            hintDir: this.data.hintDir,
            hintShowEmpty: this.data.hintShowEmpty,
            hintShowArrow: true,
            hintSteps: this.data.hintSteps,
            pos: {
              [id]: { left: origin.left, top: origin.top, tx: targetTx, ty: targetTy },
            },
          }),
        });
        this._animT2 = setTimeout(finish, 200);
      }, 16);
    });
  },

  animateThenSwap(drag) {
    if (this._won || this._failed || this._hintAutoPlaying) return;
    const { r, c, id, tx, ty } = drag;
    this.swapAdjacentAnimated(r, c, id, { tx, ty });
  },

  async onWin() {
    if (this._won || this._failed || this._claiming) return;
    this._won = true;
    this._claiming = true;
    this.stopTimer();
    getPuzzleAudio().playWin();

    const grid = this.data.selectedGrid;
    const elapsed = this.elapsedSeconds();
    const progress = readPuzzleProgress();
    const reward = rewardForGrid(grid, progress);
    const usedKeys = [...(progress.usedKeys || [])];
    if (this._sourceKey && !usedKeys.includes(this._sourceKey)) {
      usedKeys.push(this._sourceKey);
    }

    let awarded = 0;
    let rewardTip = '';
    try {
      const res = await callFunction('puzzleGame', {
        action: 'complete',
        grid,
        moves: this.data.moves,
        seconds: elapsed,
        packId: this.data.packId,
        slotIndex: this.data.slotIndex,
      });
      awarded = Math.max(0, Number(res.points || (res.data && res.data.points)) || 0);
      const cloudBonus = Math.max(0, Number(res.bonus || (res.data && res.data.bonus)) || 0);
      const quotaFull = !!(res.data && res.data.quotaFull) || !!(res.data && res.data.already);
      const cloudCount = quotaFull
        ? Math.max(
            progress.clearCount || 0,
            Number(res.data && res.data.clearCount) || 0,
          )
        : Math.max(
            (progress.clearCount || 0) + 1,
            Number(res.data && res.data.clearCount) || 0,
          );
      if (awarded > 0) {
        rewardTip =
          cloudBonus > 0
            ? `获得 ${awarded} 积分（含每日全通 +${cloudBonus}）`
            : `获得 ${awarded} 积分`;
        showPointsReward({
          host: this,
          points: awarded,
          title: '拼图奖励',
          tip: rewardTip,
        });
      } else if (quotaFull || reward.quotaFull) {
        rewardTip =
          res.message || '今日计奖次数已用完，本局无通关积分，仍可继续玩和冲榜';
      } else {
        rewardTip = res.message || '本局无通关积分';
      }
      writePuzzleProgress({
        ...progress,
        clearCount: Math.max(progress.clearCount || 0, cloudCount),
        claimedPoints: (progress.claimedPoints || 0) + awarded,
        bonusClaimed: progress.bonusClaimed || cloudBonus > 0 || reward.allDone,
        usedKeys,
      });
    } catch (e) {
      const nextLocal = reward.quotaFull
        ? progress.clearCount || 0
        : Math.min(getDailyMaxClears(), (progress.clearCount || 0) + 1);
      writePuzzleProgress({
        ...progress,
        clearCount: nextLocal,
        claimedPoints: progress.claimedPoints || 0,
        bonusClaimed: progress.bonusClaimed || reward.allDone,
        usedKeys,
      });
      const msg = (e && e.message) || '';
      const undeployed =
        (e && e.code === 'FUNCTION_NOT_FOUND') || /未部署|FUNCTION_NOT_FOUND/i.test(msg);
      if (reward.quotaFull) {
        rewardTip = '今日计奖次数已用完，本局无通关积分，仍可继续玩和冲榜';
      } else {
        rewardTip = undeployed
          ? `体验通关（预计 +${reward.total} 积分，部署云函数后可实发）`
          : `已通关 · ${msg || '积分稍后再领'}`;
      }
    } finally {
      this._claiming = false;
    }

    if (this.data.playScope === PLAY_SCOPE_DAILY && this._seedKey) {
      try {
        const profile = getUserProfile() || {};
        const rankRes = await callFunction('puzzleGame', {
          action: 'rankSubmit',
          grid,
          mode: this.data.playMode,
          moves: this.data.moves,
          seconds: elapsed,
          seedKey: this._seedKey,
          nickName: profile.nickName || '玩家',
          avatarUrl: profile.avatarUrl || '',
        });
        const improved = !!(rankRes && rankRes.data && rankRes.data.improved);
        const rankMsg = improved ? '已刷新日榜成绩' : '未超过个人今日最佳';
        rewardTip = rewardTip ? `${rewardTip} · ${rankMsg}` : rankMsg;
      } catch (e) {
        /* 上榜失败不影响通关 */
      }
    } else if (this.data.playScope !== PLAY_SCOPE_DAILY) {
      rewardTip = rewardTip
        ? `${rewardTip} · 练习局不进排行榜`
        : '练习局不进排行榜，选「每日冲榜」才能上榜';
    }

    this.refreshProgress();
    this.setData({
      winVisible: true,
      rewardTip,
      winTimeText: formatPuzzleTime(elapsed),
    });
  },

  async reloadRound() {
    if (this.data.loading || this.data.reloading || this._startAdBusy) return;
    if (this.data.playScope === PLAY_SCOPE_DAILY) {
      // 每日同题只重开同一题，不换图
      this.onPlayAgain();
      return;
    }
    this._startAdBusy = true;
    try {
      if (!(await this.ensurePuzzleStartAd())) return;
      this.loadRound(this.data.selectedGrid);
    } finally {
      this._startAdBusy = false;
    }
  },

  /** 每日冲榜：同题重开（不换图、不重排种子） */
  onRestartSame() {
    if (this.data.loading || this.data.reloading) return;
    wx.showModal({
      title: '重新开始？',
      content: '今日同题会重置步数和用时，题目不变',
      confirmText: '重新开始',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        if (this.data.loading || this.data.reloading) return;
        this.onPlayAgain();
      },
    });
  },

  /** 主动结束本局，回到选难度空闲态 */
  onEndRound() {
    if (
      this.data.loading ||
      this.data.reloading ||
      this.data.hintBusy ||
      this._hintAutoPlaying ||
      this._startAdBusy
    ) {
      return;
    }
    if (!this.data.started && !this.data.displaySrc) return;
    if (this.data.winVisible || this.data.failVisible || this._won || this._failed) {
      this._skipIdleOnPopupClose = true;
      this.backToIdle(this.data.selectedGrid);
      return;
    }
    wx.showModal({
      title: '结束本局？',
      content: '进度不会保存，结束后可重新选难度开始',
      confirmText: '结束',
      cancelText: '继续玩',
      success: (res) => {
        if (!res.confirm) return;
        if (this.data.loading || this.data.reloading) return;
        this._hintAutoPlaying = false;
        this.backToIdle(this.data.selectedGrid);
      },
    });
  },

  onReshuffle() {
    if (this.data.loading || this.data.reloading || !this.data.displaySrc) return;
    if (this.data.playScope === PLAY_SCOPE_DAILY) {
      wx.showToast({ title: '每日同题不可重排，保证公平', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '重新打乱？',
      content: '步数和用时会重置',
      success: (res) => {
        if (!res.confirm) return;
        if (this.data.reloading || this.data.loading) return;
        this._won = false;
        this._failed = false;
        this._claiming = false;
        this.clearAnimTimers();
        this._pendingFinish = null;
        this._drag = null;
        this._lock = false;
        const isChallenge = this.data.playMode === PLAY_MODE_CHALLENGE;
        const startSecs = isChallenge ? this._timeLimit || this.data.selectedTimeLimit : 0;
        this.setData({
          winVisible: false,
          failVisible: false,
          secs: startSecs,
          timeText: formatPuzzleTime(startSecs),
          timeUrgent: false,
        });
        this.startBoard(this._grid, this.data.displaySrc, this._bg, this.data.tilePx);
        this.startTimer();
      },
    });
  },

  async onPlayAgain() {
    if (this.data.loading || this.data.reloading || this._startAdBusy) return;
    this._startAdBusy = true;
    try {
      if (!(await this.ensurePuzzleStartAd())) return;
      // 再开一局：关掉弹窗时不要走「回空闲」
      this._skipIdleOnPopupClose = true;
      this._failed = false;
      this._won = false;
      this.setData({ winVisible: false, failVisible: false });
      this.loadRound(this.data.selectedGrid);
    } finally {
      this._startAdBusy = false;
    }
  },

  onWinClose() {
    this._skipIdleOnPopupClose = true;
    this.backToIdle(this.data.selectedGrid);
  },

  onFailClose() {
    this._skipIdleOnPopupClose = true;
    this.backToIdle(this.data.selectedGrid);
  },

  onFailVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    if (visible) return;
    if (this._skipIdleOnPopupClose) {
      this._skipIdleOnPopupClose = false;
      this.setData({ failVisible: false });
      return;
    }
    // 点遮罩关闭 = 结束本局回选难度（避免 started 卡住无法切换）
    this.backToIdle(this.data.selectedGrid);
  },

  goPack() {
    const id = this.data.packId;
    if (!id) return;
    wx.navigateTo({ url: `/pages/pack/detail/index?id=${id}` });
  },

  onWinVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    if (visible) return;
    if (this._skipIdleOnPopupClose) {
      this._skipIdleOnPopupClose = false;
      this.setData({ winVisible: false });
      return;
    }
    this.backToIdle(this.data.selectedGrid);
  },

  buildRankTip(rewards) {
    const rr = rewards || {};
    const parts = [];
    if (rr.enabled === false) {
      parts.push('前三奖励已关闭');
    } else {
      const a = Math.max(0, Number(rr.first != null ? rr.first : this.data.rankRewardFirst) || 0);
      const b = Math.max(0, Number(rr.second != null ? rr.second : this.data.rankRewardSecond) || 0);
      const c = Math.max(0, Number(rr.third != null ? rr.third : this.data.rankRewardThird) || 0);
      parts.push(`前三次日到账：第1 +${a} · 第2 +${b} · 第3 +${c}（同分并列同名次）`);
    }
    const streakOn =
      rr.streakEnabled != null ? rr.streakEnabled !== false : this.data.streakRewardOn !== false;
    if (streakOn) {
      const min = Math.max(
        2,
        Number(rr.streakMinDays != null ? rr.streakMinDays : this.data.streakMinDays) || 2,
      );
      const pts = Math.max(
        0,
        Number(rr.streakReward != null ? rr.streakReward : this.data.streakRewardPoints) || 0,
      );
      parts.push(pts > 0 ? `连冠满${min}天起额外 +${pts}/日` : `连冠满${min}天显示标识`);
    }
    return parts.join('；');
  },

  async onOpenRank() {
    if (this.data.playScope !== PLAY_SCOPE_DAILY) {
      wx.showToast({ title: '请先选择「每日冲榜」', icon: 'none' });
      return;
    }
    const mode = this.data.playMode || PLAY_MODE_TIMER;
    this.setData({ rankVisible: true, rankViewMode: mode });
    this.loadRankList(mode);
  },

  onRankModeTap(e) {
    const mode =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) ||
      (e.target && e.target.dataset && e.target.dataset.mode) ||
      '';
    if (mode !== PLAY_MODE_TIMER && mode !== PLAY_MODE_CHALLENGE) return;
    if (mode === this.data.rankViewMode) return;
    this.setData({ rankViewMode: mode });
    this.loadRankList(mode, this.data.selectedGrid);
  },

  async loadRankList(modeOverride, gridOverride) {
    const mode = modeOverride || this.data.rankViewMode || this.data.playMode;
    const grid = gridOverride || this.data.selectedGrid;
    const modeLabel = mode === PLAY_MODE_CHALLENGE ? '挑战限时' : '计时测速';
    this.setData({ rankLoading: true, rankEmpty: false, rankViewMode: mode });
    try {
      const res = await callFunction('puzzleGame', {
        action: 'rankList',
        grid,
        mode,
      });
      const data = (res && res.data) || {};
      const list = Array.isArray(data.list) ? data.list : [];
      const rr = data.rankRewards || {};
      this.setData({
        rankList: list,
        rankEmpty: !list.length,
        rankTitle: `今日${modeLabel} · ${grid}×${grid}`,
        rankTip: this.buildRankTip(rr),
        rankLoading: false,
        rankRewardOn: rr.enabled !== false,
        rankRewardFirst: Math.max(0, Number(rr.first) || 0),
        rankRewardSecond: Math.max(0, Number(rr.second) || 0),
        rankRewardThird: Math.max(0, Number(rr.third) || 0),
        streakRewardOn: rr.streakEnabled !== false,
        streakMinDays: Math.max(2, Number(rr.streakMinDays) || 2),
        streakRewardPoints: Math.max(0, Number(rr.streakReward) || 0),
      });
    } catch (e) {
      this.setData({
        rankList: [],
        rankEmpty: true,
        rankLoading: false,
        rankTitle: '今日排行',
        rankTip: this.buildRankTip(),
      });
      wx.showToast({ title: (e && e.message) || '排行加载失败', icon: 'none' });
    }
  },

  onCloseRank() {
    this.setData({ rankVisible: false });
  },

  onRankVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    if (!visible) this.setData({ rankVisible: false });
  },

  onShareAppMessage: shareAppMessage,
  onShareTimeline: shareTimeline,
});
