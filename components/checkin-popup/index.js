import { callFunction } from '~/utils/cloud';
import { setCachedEntitlement } from '~/utils/entitlement';
import { getFestivalConfettiColors } from '~/utils/festival';
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
        this.triggerEvent('success', {
          isMakeup: !!isMakeup,
          added: data.added || this.data.checkinPoints,
          entitlement: data.entitlement || null,
          message: res.message || '',
        });
        wx.showToast({
          title:
            res.message ||
            (isMakeup
              ? `补签成功 +${data.added || this.data.checkinPoints}`
              : `+${data.added || this.data.checkinPoints} 积分`),
          icon: 'success',
        });
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
  },
});
