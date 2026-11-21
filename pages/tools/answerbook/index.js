import { getCustomNavMetrics } from '~/utils/systemInfo';
import {
  applyThemeToPage,
  getThemeBrand,
  getThemeStyle,
} from '~/utils/theme';
import {
  getActiveFestival,
  getFestivalAssets,
  loadFestivalConfig,
} from '~/utils/festival';
import {
  getNativeWorkshopAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';
import ANSWERS from './answers';
import {
  destroyAnswerbookAudio,
  getAnswerbookAudio,
} from './answerbookAudio';

const COVER_MS = 720;
const TURN_MS = 420;
const RIFFLE_MS_MIN = 2000;
const RIFFLE_MS_MAX = 2600;
const SETTLE_MS = 320;

const COPY = {
  hintClosed: '准备好了就轻触书本',
  hintOpening: '书本正在打开…',
  hintTurning: '书页快速翻过…',
  hintRevealed: '轻触书本可合上 · 或再问一次',
  statusOpening: '正在打开书本',
  statusTurning: '书页快速翻过',
  statusClosing: '正在合上书本',
  primaryClosed: '翻开答案之书',
  primaryRevealed: '再问一次',
  secondaryClosed: '轻触书本',
  secondaryRevealed: '合上书',
};

function pickAnswer(prev) {
  if (!ANSWERS.length) return '静心等待';
  if (ANSWERS.length === 1) return ANSWERS[0];
  let next = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
  let guard = 0;
  while (next === prev && guard < 12) {
    next = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    guard += 1;
  }
  return next;
}

function randRiffleMs() {
  return (
    RIFFLE_MS_MIN + Math.floor(Math.random() * (RIFFLE_MS_MAX - RIFFLE_MS_MIN + 1))
  );
}

function answerSizeOf(text) {
  const len = [...String(text || '')].length;
  if (len > 14) return 'sm';
  if (len > 8) return 'md';
  return 'lg';
}

/** 逐字揭晓：与 answer-book-text-animation 同款 stagger */
function splitAnswerChars(text, animId) {
  const id = animId || 0;
  return [...String(text || '')].map((ch, i) => ({
    key: `${id}-${i}`,
    ch: ch === ' ' ? '\u00a0' : ch,
    delay: `${i * 105}ms`,
  }));
}

function phaseClass(phase, hasAnswer) {
  const list = [];
  if (phase === 'open' || phase === 'turning' || phase === 'settling' || phase === 'revealed') {
    list.push('is-open');
  }
  if (phase === 'turning') list.push('is-turning');
  if (phase === 'settling') list.push('is-settling');
  if (phase === 'closing') list.push('is-closing');
  if (hasAnswer && (phase === 'revealed' || phase === 'closing')) list.push('has-answer');
  return list.join(' ');
}

Page({
  data: {
    themeStyle: '',
    themeBrand: '#07c160',
    navHeight: 64,
    navBarStyle: '',
    festivalActive: true,
    festivalId: '',
    festivalClass: '',
    festivalStyle: '',
    festHeaderPx: 88,

    phase: 'closed',
    phaseClass: '',
    busy: false,
    hasAnswer: false,
    answer: '',
    answerChars: [],
    answerSize: 'lg',
    turnMs: TURN_MS,
    coverMs: COVER_MS,
    hintText: COPY.hintClosed,
    statusText: '',
    primaryText: COPY.primaryClosed,
    secondaryText: COPY.secondaryClosed,

    nativeAdUnitId: '',
    showNativeAd: false,
    soundMuted: false,
  },

  syncSoundMuted() {
    const audio = getAnswerbookAudio();
    this.setData({ soundMuted: audio.isMuted() });
  },

  onToggleSound() {
    const audio = getAnswerbookAudio();
    const next = !audio.isMuted();
    audio.setMuted(next);
    this.setData({ soundMuted: next });
  },

  refreshNativeAd() {
    const unitId = getNativeWorkshopAdUnitId();
    this.setData({
      nativeAdUnitId: unitId,
      showNativeAd: !!unitId && shouldShowNativeAds(),
    });
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  onLoad() {
    this.updateNavHeight();
    this.syncThemeUi();
    this.refreshNativeAd();
    this.syncSoundMuted();
    this._onFestivalChange = () => this.updateNavHeight();
    this._onThemeChange = () => this.syncThemeUi();
    this._onEntitlementChange = () => this.refreshNativeAd();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('festivalChange', this._onFestivalChange);
        app.eventBus.on('themeChange', this._onThemeChange);
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  onUnload() {
    this.clearTimers();
    try {
      getAnswerbookAudio().stopRiffle();
    } catch (e) {
      /* ignore */
    }
    destroyAnswerbookAudio();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onFestivalChange) app.eventBus.off('festivalChange', this._onFestivalChange);
        if (this._onThemeChange) app.eventBus.off('themeChange', this._onThemeChange);
        if (this._onEntitlementChange) {
          app.eventBus.off('entitlementChange', this._onEntitlementChange);
        }
      }
    } catch (e) {
      /* ignore */
    }
  },

  onShow() {
    this.refreshNativeAd();
    this.syncSoundMuted();
    if (!this.data.festivalActive) this.setData({ festivalActive: true });
    this.refreshFestivalDecor();
    loadFestivalConfig({ silent: true }).then(() => this.refreshFestivalDecor());
  },

  onHide() {
    try {
      getAnswerbookAudio().stopRiffle();
    } catch (e) {
      /* ignore */
    }
    this.setData({ festivalActive: false });
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/workshop/index' }) });
  },

  syncThemeUi() {
    applyThemeToPage(this);
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
    });
  },

  updateNavHeight() {
    try {
      const m = getCustomNavMetrics();
      this.setData(
        {
          navHeight: m.navHeight,
          navBarStyle: m.navBarStyle,
        },
        () => this.refreshFestivalDecor(),
      );
    } catch (e) {
      this.setData(
        {
          navHeight: 64,
          navBarStyle: '--td-navbar-padding-top:20px;--td-navbar-height:44px',
        },
        () => this.refreshFestivalDecor(),
      );
    }
  },

  refreshFestivalDecor() {
    const fest = getActiveFestival();
    const nav = Number(this.data.navHeight) || 64;
    const assets = fest ? getFestivalAssets(fest.id) : {};
    const hasBanner = !!(assets && assets.banner);
    const festHeaderPx = Math.max(48, Math.round(nav));
    const festivalStyle = fest
      ? [
          `--fest-accent:${fest.accent || 'var(--td-brand-color)'}`,
          hasBanner ? `--fest-nav-color:${fest.navColor || '#ffffff'}` : '',
        ]
          .filter(Boolean)
          .join(';')
      : '';
    const festivalClass = fest
      ? [hasBanner ? 'ab-page--fest' : '', `ab-page--fest-${fest.id}`]
          .filter(Boolean)
          .join(' ')
      : '';
    this.setData({
      festivalId: fest ? fest.id : '',
      festivalClass,
      festivalStyle,
      festHeaderPx,
    });
    const decor = this.selectComponent('#festivalDecor');
    if (decor && typeof decor.refresh === 'function') decor.refresh();
  },

  clearTimers() {
    ['_coverTimer', '_turnTimer', '_settleTimer', '_closeTimer'].forEach((k) => {
      if (this[k]) {
        clearTimeout(this[k]);
        this[k] = null;
      }
    });
    try {
      getAnswerbookAudio().stopRiffle();
    } catch (e) {
      /* ignore */
    }
  },

  setPhase(phase, extra = {}) {
    const hasAnswer = extra.hasAnswer != null ? extra.hasAnswer : this.data.hasAnswer;
    this.setData({
      phase,
      phaseClass: phaseClass(phase, hasAnswer),
      ...extra,
    });
  },

  applyClosedUi(extra = {}) {
    this.setPhase('closed', {
      hasAnswer: false,
      answer: '',
      answerChars: [],
      answerSize: 'lg',
      busy: false,
      statusText: '',
      hintText: COPY.hintClosed,
      primaryText: COPY.primaryClosed,
      secondaryText: COPY.secondaryClosed,
      ...extra,
    });
  },

  /** 合上：先淡出答案，再合封面，最后清内容 */
  closeBookOnly() {
    if (this.data.busy) return;
    if (this.data.phase === 'closed') return;
    this.clearTimers();
    getAnswerbookAudio().playClose();
    this.setData({
      busy: true,
      statusText: COPY.statusClosing,
      hintText: COPY.statusClosing,
    });
    // 合上过程仍短暂保留 hasAnswer，让文字淡出与封面合上同步
    this.setPhase('closing', { hasAnswer: true });

    this._closeTimer = setTimeout(() => {
      this._closeTimer = null;
      this.applyClosedUi();
    }, COVER_MS);
  },

  /** 再问：顺滑合上后直接再翻，中间不硬切 */
  closeThenRead() {
    if (this.data.busy) return;
    this.clearTimers();
    getAnswerbookAudio().playClose();
    this.setData({
      busy: true,
      statusText: COPY.statusClosing,
      hintText: COPY.statusClosing,
    });
    this.setPhase('closing', { hasAnswer: true });

    this._closeTimer = setTimeout(() => {
      this._closeTimer = null;
      this.applyClosedUi({ busy: true });
      this.openAndTurn();
    }, COVER_MS + 40);
  },

  openAndTurn() {
    // 再问链路里也会进来：先清掉残留定时器，避免叠动画
    this.clearTimers();
    const answer = pickAnswer(this._lastAnswer);
    this._lastAnswer = answer;
    const riffleMs = randRiffleMs();
    const answerSize = answerSizeOf(answer);
    this._pending = { answer, answerSize, riffleMs };

    getAnswerbookAudio().playOpen();
    this.setData({
      busy: true,
      hasAnswer: false,
      answer: '',
      answerChars: [],
      answerSize: 'lg',
      hintText: COPY.hintOpening,
      statusText: COPY.statusOpening,
      primaryText: '翻页中…',
      secondaryText: COPY.secondaryClosed,
    });
    this.setPhase('open', { hasAnswer: false });

    this._coverTimer = setTimeout(() => {
      this._coverTimer = null;
      getAnswerbookAudio().playRiffle(riffleMs);
      this.setPhase('turning', {
        hasAnswer: false,
        statusText: COPY.statusTurning,
        hintText: COPY.hintTurning,
      });
      this._turnTimer = setTimeout(() => {
        this._turnTimer = null;
        this.finishReading();
      }, riffleMs);
    }, COVER_MS);
  },

  finishReading() {
    const pending = this._pending || {};
    const answer = pending.answer || '';
    const answerSize = pending.answerSize || answerSizeOf(answer);
    this._answerAnimId = (this._answerAnimId || 0) + 1;
    const answerChars = splitAnswerChars(answer, this._answerAnimId);

    getAnswerbookAudio().stopRiffle();
    // 先停翻页并淡出页叶，再淡入答案
    this.setPhase('settling', {
      hasAnswer: false,
      statusText: '',
      answer: '',
      answerChars: [],
    });

    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      getAnswerbookAudio().playReveal();
      this.setPhase('revealed', {
        hasAnswer: true,
        answer,
        answerChars,
        answerSize,
        busy: false,
        hintText: COPY.hintRevealed,
        primaryText: COPY.primaryRevealed,
        secondaryText: COPY.secondaryRevealed,
      });
    }, SETTLE_MS);
  },

  onBookTap() {
    if (this.data.busy) return;
    if (this.data.phase === 'revealed') {
      this.closeBookOnly();
      return;
    }
    if (this.data.phase === 'closed') {
      this.openAndTurn();
    }
  },

  onPrimary() {
    if (this.data.busy) return;
    if (this.data.phase === 'closed') {
      this.openAndTurn();
      return;
    }
    if (this.data.phase === 'revealed') {
      this.closeThenRead();
    }
  },

  onSecondary() {
    if (this.data.busy) return;
    if (this.data.phase === 'closed') {
      this.openAndTurn();
      return;
    }
    if (this.data.phase === 'revealed') {
      this.closeBookOnly();
    }
  },
});
