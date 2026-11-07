import { callFunction } from '~/utils/cloud';
import { setCachedEntitlement } from '~/utils/entitlement';
import {
  defaultSaveAdRewardPoints,
  fetchAdRewardStatus,
  formatAdClaimToast,
  isCheckinAdRewardEnabled,
  watchAdAndClaimPoints,
} from '~/utils/adReward';
import { getFestivalConfettiColors } from '~/utils/festival';
import { showPointsReward } from '~/utils/pointsReward';
import { getThemeStyle } from '~/utils/theme';
import { defaultCheckinPoints } from '~/utils/giftHint';

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function shiftMonth(monthKey, delta) {
  const parts = String(monthKey || '').split('-');
  let y = Number(parts[0]);
  let m = Number(parts[1]);
  if (!y || !m) {
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth() + 1;
  }
  m += delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function formatMonthTitle(monthKey) {
  const parts = String(monthKey || '').split('-');
  if (parts.length < 2) return monthKey || '';
  return `${parts[0]}年${Number(parts[1])}月`;
}

function formatDateLabel(dateKey) {
  const parts = String(dateKey || '').split('-');
  if (parts.length !== 3) return dateKey || '';
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    themeStyle: '',
    loading: false,
    checking: false,
    weekLabels: WEEK_LABELS,
    monthKey: '',
    monthTitle: '',
    todayKey: '',
    currentMonthKey: '',
    isCurrentMonth: true,
    weeks: [],
    checkedToday: false,
    canCheckinNow: false,
    checkinBtnText: '立即签到',
    checkedCount: 0,
    checkinPoints: defaultCheckinPoints(),
    points: 0,
    canPrev: true,
    canNext: false,
    makeupLeftToday: 1,
    makeupLeftMonth: 3,
    makeupMaxPerDay: 1,
    makeupMaxPerMonth: 3,
    canMakeupNow: false,
    nextMakeupDateKey: '',
    nextMakeupLabel: '',
    adBonusVisible: false,
    adBonusClaiming: false,
    adBonusPoints: defaultSaveAdRewardPoints(),
    adBonusLeftToday: 0,
    adBonusBtnText: '看广告再领 +1',
  },

  observers: {
    visible(v) {
      if (v) {
        this.setData({ themeStyle: getThemeStyle() });
        this.loadStatus(this.data.monthKey || '');
      }
    },
  },

  methods: {
    buildCheckinBtnText({ isCurrentMonth, checkedToday, checkinPoints }) {
      if (!isCurrentMonth) return '仅可签到本月';
      if (checkedToday) return '今日已签到';
      return `立即签到 +${checkinPoints}`;
    },

    buildAdBonusBtnText(points, leftToday) {
      const p = Math.max(1, Number(points) || defaultSaveAdRewardPoints());
      const left = Math.max(0, Number(leftToday) || 0);
      if (left <= 0) return '今日已领过广告奖励';
      return `看广告再领 +${p}`;
    },

    /**
     * @param {boolean} [checkedTodayOverride] setData 未落地时传入，避免读到旧的 checkedToday
     */
    async refreshAdBonusStatus(checkedTodayOverride) {
      if (!isCheckinAdRewardEnabled()) {
        this.setData({
          adBonusVisible: false,
          adBonusPoints: defaultSaveAdRewardPoints(),
          adBonusLeftToday: 0,
          adBonusBtnText: '看广告再领 +1',
        });
        return;
      }
      // 签到专用 slot：云端日限 1 次（广告单元与全站同为约 30s）
      const status = await fetchAdRewardStatus('checkin');
      const points = Math.max(
        1,
        Number(status && status.points) || defaultSaveAdRewardPoints(),
      );
      const leftToday = Math.max(0, Number(status && status.leftToday) || 0);
      const enabled = !!(status && status.enabled) && leftToday > 0;
      const checkedToday =
        checkedTodayOverride != null
          ? !!checkedTodayOverride
          : !!this.data.checkedToday;
      // 今日已签到（或刚签完）才露出「再领」入口，避免抢签到主按钮
      const visible = enabled && checkedToday;
      this.setData({
        adBonusVisible: visible,
        adBonusPoints: points,
        adBonusLeftToday: leftToday,
        adBonusBtnText: this.buildAdBonusBtnText(points, leftToday),
      });
    },

    applyStatus(data, fallbackMonthKey) {
      const mk = data.monthKey || fallbackMonthKey;
      const todayKey = data.todayKey || this.data.todayKey || '';
      const currentMonthKey =
        (todayKey && todayKey.slice(0, 7)) ||
        (() => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        })();
      const isCurrentMonth = !!mk && mk === currentMonthKey;
      const checkedToday = !!data.checkedToday;
      const rawPts = Number(data.checkinPoints);
      const checkinPoints = Number.isFinite(rawPts)
        ? Math.max(0, rawPts)
        : defaultCheckinPoints();
      const nextMakeupDateKey = data.nextMakeupDateKey || '';
      const weeks = Array.isArray(data.weeks) && data.weeks.length ? data.weeks : this.data.weeks;
      this.setData({
        monthKey: mk,
        monthTitle: formatMonthTitle(mk),
        todayKey,
        currentMonthKey,
        isCurrentMonth,
        weeks,
        checkedToday,
        canCheckinNow: isCurrentMonth && !checkedToday && checkinPoints > 0,
        checkinBtnText:
          checkinPoints <= 0
            ? '签到暂未开放'
            : this.buildCheckinBtnText({
                isCurrentMonth,
                checkedToday,
                checkinPoints,
              }),
        checkedCount: Number(data.checkedCount) || 0,
        checkinPoints,
        points:
          Number(
            (data.entitlement && data.entitlement.points) != null
              ? data.entitlement.points
              : data.points,
          ) || 0,
        canPrev: true,
        canNext: !!mk && mk < currentMonthKey,
        makeupLeftToday: Number(data.makeupLeftToday) || 0,
        makeupLeftMonth: Number(data.makeupLeftMonth) || 0,
        makeupMaxPerDay: Number(data.makeupMaxPerDay) || 1,
        makeupMaxPerMonth: Number(data.makeupMaxPerMonth) || 3,
        canMakeupNow: !!data.canMakeupNow,
        nextMakeupDateKey,
        nextMakeupLabel: formatDateLabel(nextMakeupDateKey),
      });
      this.refreshAdBonusStatus(checkedToday);
    },

    async loadStatus(monthKey) {
      const seq = (this._statusSeq = (this._statusSeq || 0) + 1);
      this._loading = true;
      this.setData({ loading: true });
      try {
        const res = await callFunction('userCheckin', {
          action: 'status',
          monthKey: monthKey || undefined,
        });
        if (seq !== this._statusSeq) return;
        this.applyStatus((res && res.data) || {}, monthKey);
      } catch (e) {
        if (seq !== this._statusSeq) return;
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
      } finally {
        if (seq === this._statusSeq) {
          this._loading = false;
          this.setData({ loading: false });
        }
      }
    },

    onVisibleChange(e) {
      const visible = !!(e.detail && e.detail.visible);
      this.triggerEvent('visible-change', { visible });
      if (!visible) this.triggerEvent('close');
    },

    onClose() {
      this.triggerEvent('visible-change', { visible: false });
      this.triggerEvent('close');
    },

    onPrevMonth() {
      if (!this.data.monthKey || this.data.loading || this._loading) return;
      this.loadStatus(shiftMonth(this.data.monthKey, -1));
    },

    onNextMonth() {
      if (!this.data.canNext || this.data.loading || this._loading) return;
      this.loadStatus(shiftMonth(this.data.monthKey, 1));
    },

    playConfetti() {
      const confetti = this.selectComponent('#confetti');
      if (confetti && typeof confetti.burst === 'function') {
        const colors = getFestivalConfettiColors();
        confetti.burst({ count: 48, colors: colors || undefined });
      }
    },

    async doCheckin(isMakeup) {
      if (this._checking || this.data.checking || this.data.loading || this._loading) {
        return;
      }
      if (isMakeup && !this.data.canMakeupNow) {
        const tip =
          this.data.makeupLeftMonth <= 0
            ? '本月补签已用完'
            : this.data.makeupLeftToday <= 0
              ? '今日补签已用完'
              : '暂无漏签可补';
        wx.showToast({ title: tip, icon: 'none' });
        return;
      }
      if (!isMakeup) {
        if (this.data.checkinPoints <= 0) {
          wx.showToast({ title: '签到暂未开放', icon: 'none' });
          return;
        }
        if (!this.data.isCurrentMonth) {
          wx.showToast({ title: '仅可签到本月', icon: 'none' });
          return;
        }
        if (this.data.checkedToday) return;
      }

      this._checking = true;
      this.setData({ checking: true });
      try {
        const stayMonth = this.data.monthKey;
        const res = await callFunction('userCheckin', {
          action: isMakeup ? 'makeup' : 'checkin',
        });
        const data = (res && res.data) || {};
        if (data.entitlement) {
          setCachedEntitlement(data.entitlement);
        }
        // 优先用响应里的 status，再按当前查看月份对齐
        if (data.weeks || data.monthKey) {
          this.applyStatus(data, stayMonth);
        }
        if (stayMonth && data.monthKey && stayMonth !== data.monthKey) {
          await this.loadStatus(stayMonth);
        } else if (!data.weeks) {
          await this.loadStatus(stayMonth || undefined);
        }
        this.playConfetti();
        const added = Math.max(
          0,
          Number(data.added) || this.data.checkinPoints || 0,
        );
        this.triggerEvent('success', {
          isMakeup: !!isMakeup,
          added,
          entitlement: data.entitlement || null,
          message: res.message || '',
        });
        showPointsReward({
          host: this,
          points: added,
          title: isMakeup ? '补签成功' : '签到成功',
          tip: res.message || '',
        });
        // 签到/补签成功后必已签到，显式传入避免 setData 竞态
        this.refreshAdBonusStatus(true);
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '签到失败', icon: 'none' });
      } finally {
        this._checking = false;
        this.setData({ checking: false });
      }
    },

    onCheckin() {
      this.doCheckin(false);
    },

    onMakeup() {
      this.doCheckin(true);
    },

    async onWatchAdBonus() {
      if (this.data.adBonusClaiming || this.data.checking) return;
      if (!this.data.adBonusVisible) {
        wx.showToast({ title: '暂不可领取', icon: 'none' });
        return;
      }
      if (this.data.adBonusLeftToday <= 0) {
        wx.showToast({ title: '今日已领过广告奖励', icon: 'none' });
        return;
      }

      this.setData({ adBonusClaiming: true });
      try {
        const pages =
          typeof getCurrentPages === 'function' ? getCurrentPages() : [];
        const page = pages.length ? pages[pages.length - 1] : null;
        const res = await watchAdAndClaimPoints({ page, slot: 'checkin' });
        if (!res || !res.ok) {
          if (res && res.reason === 'SKIPPED') return;
          wx.showToast({
            title: (res && res.message) || '领取失败',
            icon: 'none',
          });
          if (res && res.data) {
            const left = Math.max(0, Number(res.data.leftToday) || 0);
            const points = Math.max(
              1,
              Number(res.data.points) || this.data.adBonusPoints,
            );
            this.setData({
              adBonusVisible: left > 0 && !!this.data.checkedToday,
              adBonusLeftToday: left,
              adBonusPoints: points,
              adBonusBtnText: this.buildAdBonusBtnText(points, left),
            });
          } else {
            this.refreshAdBonusStatus();
          }
          return;
        }
        if (res.entitlement) {
          setCachedEntitlement(res.entitlement);
          this.setData({
            points: Math.max(0, Number(res.entitlement.points) || 0),
          });
        }
        const gained = Math.max(
          0,
          Number(res.points) || this.data.adBonusPoints || 0,
        );
        this.triggerEvent('success', {
          isMakeup: false,
          added: gained,
          entitlement: res.entitlement || null,
          message: res.message || '',
          fromAd: true,
        });
        showPointsReward({
          host: this,
          points: gained,
          title: '看广告再领',
          tip:
            formatAdClaimToast({ gained }) ||
            (gained ? `已到账 +${gained}` : ''),
        });
        this.refreshAdBonusStatus();
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '领取失败', icon: 'none' });
        this.refreshAdBonusStatus();
      } finally {
        this.setData({ adBonusClaiming: false });
      }
    },
  },
});
