import { callFunction } from '~/utils/cloud';
import { canBeAdmin } from '~/utils/auth';
import { getLotteryAudio } from '~/utils/lotteryAudio';

const ART = {
  miss: '/static/lottery/miss.png',
  1: '/static/lottery/pts1.png',
  2: '/static/lottery/pts2.png',
  4: '/static/lottery/pts4.png',
  8: '/static/lottery/pts8.png',
  12: '/static/lottery/pts12.png',
  18: '/static/lottery/pts18.png',
};

function artFor(pts) {
  if (pts >= 18) return ART[18];
  if (pts >= 12) return ART[12];
  if (pts >= 8) return ART[8];
  if (pts >= 4) return ART[4];
  if (pts >= 2) return ART[2];
  if (pts >= 1) return ART[1];
  return ART.miss;
}

function decorate(p) {
  const pts = Math.max(0, Number(p.points) || 0);
  let tone = 'miss';
  if (pts >= 18) tone = 'jackpot';
  else if (pts >= 12) tone = 'epic';
  else if (pts >= 8) tone = 'big';
  else if (pts >= 4) tone = 'mid';
  else if (pts >= 2) tone = 'small';
  else if (pts >= 1) tone = 'tiny';
  return {
    ...p,
    id: p.id || '',
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
    points: pts,
    art: artFor(pts),
    tone,
    cellLabel: String(p.name || '').trim() || (pts > 0 ? `+${pts} 积分` : '谢谢参与'),
    label: String(p.name || '').trim() || (pts > 0 ? `${pts} 积分` : '谢谢参与'),
  };
}

function withFlags(prizes, activeIndex, winIndex, missIndex, drawPulse) {
  return (prizes || []).map((raw, i) => {
    const p = decorate(raw);
    return {
      ...p,
      id: p.id || `p${i}`,
      active: i === activeIndex,
      win: winIndex >= 0 && i === winIndex,
      miss: missIndex >= 0 && i === missIndex,
      drawPulse: i === activeIndex ? drawPulse : '',
    };
  });
}

Component({
  data: {
    loading: true,
    ready: false,
    enabled: false,
    spinning: false,
    goPhase: 'idle',
    costPoints: 2,
    dailyLimit: 20,
    remainCount: 0,
    todayCount: 0,
    points: 0,
    vipMonthQuota: 0,
    wallet: 0,
    prizes: [],
    cells: [],
    activeIndex: -1,
    winIndex: -1,
    missIndex: -1,
    boardShake: false,
    fxShow: false,
    fxWin: false,
    fxTitle: '',
    fxSub: '',
    fxArt: '/static/lottery/pts18.png',
    goLiveArt: '/static/lottery/go.png',
    goArtPulse: '',
    soundMuted: false,
    isAdmin: false,
    resetting: false,
  },

  lifetimes: {
    attached() {
      const audio = getLotteryAudio();
      this.setData({ soundMuted: audio.isMuted(), isAdmin: canBeAdmin() });
      this.loadConfig();
    },
    detached() {
      this._clearSpin();
      this._clearFx();
    },
  },

  pageLifetimes: {
    show() {
      const audio = getLotteryAudio();
      this.setData({ soundMuted: audio.isMuted(), isAdmin: canBeAdmin() });
      if (!this.data.spinning) this.loadConfig({ silent: true });
    },
  },

  methods: {
    _clearSpin() {
      if (this._spinTimer) {
        clearTimeout(this._spinTimer);
        this._spinTimer = null;
      }
    },

    _clearFx() {
      if (this._fxTimer) {
        clearTimeout(this._fxTimer);
        this._fxTimer = null;
      }
    },

    _sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    async loadConfig(opts = {}) {
      if (this.data.spinning) return;
      if (!opts.silent) this.setData({ loading: true });
      try {
        const res = await callFunction('gridLottery', { action: 'get' });
        const d = (res && res.data) || {};
        const prizes = Array.isArray(d.prizes) ? d.prizes : [];
        this.setData({
          loading: false,
          ready: true,
          enabled: d.enabled !== false,
          costPoints: Number(d.costPoints) || 2,
          dailyLimit: Number(d.dailyLimit) || 20,
          remainCount: Number(d.remainCount) || 0,
          todayCount: Number(d.todayCount) || 0,
          points: Number(d.points) || 0,
          vipMonthQuota: Number(d.vipMonthQuota) || 0,
          wallet: Number(d.wallet) || Number(d.points) || 0,
          prizes,
          goLiveArt: '/static/lottery/go.png',
          goArtPulse: '',
          cells: withFlags(prizes, -1, this.data.winIndex, this.data.missIndex, ''),
        });
      } catch (e) {
        this.setData({
          loading: false,
          ready: true,
          enabled: false,
        });
      }
    },

    onToggleSound() {
      const audio = getLotteryAudio();
      const next = !audio.isMuted();
      audio.setMuted(next);
      this.setData({ soundMuted: next });
    },

    async onResetToday() {
      if (!this.data.isAdmin || this.data.resetting || this.data.spinning) return;
      this.setData({ resetting: true });
      try {
        const res = await callFunction('gridLottery', { action: 'adminResetToday' });
        const d = (res && res.data) || {};
        this.setData({
          resetting: false,
          remainCount: Number(d.remainCount) || this.data.dailyLimit,
          todayCount: Number(d.todayCount) || 0,
          points: Number(d.points) || this.data.points,
          vipMonthQuota: Number(d.vipMonthQuota) || this.data.vipMonthQuota,
          wallet: Number(d.wallet) || this.data.wallet,
        });
        wx.showToast({ title: '次数已重置', icon: 'success' });
      } catch (e) {
        this.setData({ resetting: false });
        wx.showToast({ title: (e && e.message) || '重置失败', icon: 'none' });
      }
    },

    async onDraw() {
      if (this.data.goPhase !== 'idle' || !this.data.enabled) return;
      if (this.data.remainCount <= 0) {
        wx.showToast({ title: '今日次数已用完', icon: 'none' });
        return;
      }
      const audio = getLotteryAudio();
      audio.playStart();
      this._clearFx();
      this.setData({
        spinning: true,
        goPhase: 'windup',
        winIndex: -1,
        missIndex: -1,
        boardShake: false,
        fxShow: false,
        activeIndex: -1,
      });
      this._paint(-1, -1, -1);

      const req = callFunction('gridLottery', { action: 'draw' });
      await this._sleep(340);
      this.setData({ goPhase: 'spin' });

      let result;
      try {
        result = await req;
      } catch (e) {
        this._clearSpin();
        getLotteryAudio().unduck();
        this.setData({
          spinning: false,
          goPhase: 'idle',
          activeIndex: -1,
          goLiveArt: '/static/lottery/go.png',
          goArtPulse: '',
        });
        this._paint(-1, -1, -1);
        const msg = (e && e.message) || '抽奖失败';
        if (/积分不足/.test(msg)) {
          const go = await new Promise((resolve) => {
            wx.showModal({
              title: '可用积分不足',
              content: `${msg}。包月额度也可抽，可到「我的」开通或购买。`,
              confirmText: '去我的',
              success: (r) => resolve(!!r.confirm),
              fail: () => resolve(false),
            });
          });
          if (go) wx.switchTab({ url: '/pages/my/index' });
        } else {
          wx.showToast({ title: msg, icon: 'none' });
        }
        this.loadConfig({ silent: true });
        return;
      }

      const data = (result && result.data) || {};
      const winIndex = Math.max(0, Number(data.index) || 0);
      await this._spinTo(winIndex);
      const prize = data.prize || {};
      const gain = Number(prize.points) || 0;
      const visual = decorate({ ...prize, points: gain });
      this.setData({
        spinning: false,
        remainCount: Number(data.remainCount) || 0,
        todayCount: Number(data.todayCount) || 0,
        points: Number(data.points) || 0,
        vipMonthQuota: Number(data.vipMonthQuota) || 0,
        wallet: Number(data.wallet) || Number(data.points) || 0,
      });
      this._showResult(winIndex, gain > 0, visual, gain);
    },

    noop() {},

    _showResult(prizeIndex, won, visual, gain) {
      try {
        wx.vibrateShort({ type: won ? 'medium' : 'light' });
      } catch (e) {
        /* ignore */
      }
      const audio = getLotteryAudio();
      if (won) audio.playWin();
      else audio.playMiss();
      if (won) {
        this._paint(-1, prizeIndex, -1);
        const burst = this.selectComponent('#gridConfetti');
        if (burst && typeof burst.burst === 'function') {
          burst.burst({ count: gain >= 8 ? 56 : 36, durationMs: 1200 });
        }
        this.setData({
          goPhase: 'win',
          fxShow: true,
          fxWin: true,
          fxTitle: visual.label || `获得 ${gain} 积分`,
          fxSub: '已打入账户',
          fxArt: visual.art || ART[18],
        });
      } else {
        this._paint(-1, -1, prizeIndex);
        this.setData({
          goPhase: 'miss',
          boardShake: true,
          fxShow: true,
          fxWin: false,
          fxTitle: '谢谢参与',
          fxSub: '再试一次吧',
          fxArt: ART.miss,
        });
      }
      this._clearFx();
      this._fxTimer = setTimeout(() => {
        this.setData({
          fxShow: false,
          boardShake: false,
          goPhase: 'idle',
          goLiveArt: '/static/lottery/go.png',
          goArtPulse: '',
        });
        this._paint(-1, -1, -1);
        this._fxTimer = null;
      }, won ? 1400 : 1100);
    },

    _paint(activeIndex, winIndex, missIndex) {
      const miss = missIndex == null ? this.data.missIndex : missIndex;
      const prizes = this.data.prizes || [];
      let drawPulse = '';
      let goLiveArt = this.data.goLiveArt;
      let goArtPulse = this.data.goArtPulse;
      if (activeIndex >= 0 && prizes[activeIndex]) {
        this._drawFlip = !this._drawFlip;
        drawPulse = this._drawFlip ? 'a' : 'b';
        goLiveArt = decorate(prizes[activeIndex]).art;
        goArtPulse = drawPulse;
      } else if (winIndex >= 0 && prizes[winIndex]) {
        goLiveArt = decorate(prizes[winIndex]).art;
        goArtPulse = 'a';
      }
      this.setData({
        activeIndex,
        winIndex,
        missIndex: miss,
        goLiveArt,
        goArtPulse,
        cells: withFlags(prizes, activeIndex, winIndex, miss, drawPulse),
      });
    },

    _spinTo(winIndex) {
      return new Promise((resolve) => {
        const n = Math.max(1, (this.data.prizes || []).length);
        const loops = 3;
        const total = loops * n + (winIndex % n);
        let step = 0;
        const tick = () => {
          const active = step % n;
          const done = step >= total;
          if (done) {
            this._paint(winIndex, winIndex, -1);
            this._spinTimer = setTimeout(() => {
              this._spinTimer = null;
              resolve();
            }, 360);
            return;
          }
          this._paint(active, -1, -1);
          getLotteryAudio().playTick();
          step += 1;
          const remain = total - step;
          const delay = remain < 8 ? 140 + (8 - remain) * 48 : 88;
          this._spinTimer = setTimeout(tick, delay);
        };
        tick();
      });
    },
  },
});
