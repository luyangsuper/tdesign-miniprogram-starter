import { callFunction } from '~/utils/cloud';
import { formatDate } from '~/utils/time';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultDrawAtLocal() {
  return formatLocalDateTime(new Date(Date.now() + 60 * 60 * 1000));
}

function drawAtPickerRange() {
  const start = new Date(Date.now() + 60 * 1000);
  const end = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  return {
    drawAtStart: formatLocalDateTime(start),
    drawAtEnd: formatLocalDateTime(end),
  };
}

function parseLocalDateTime(s) {
  const m = String(s || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return 0;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0,
  );
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

function statusLabel(status) {
  if (status === 'open') return '报名中';
  if (status === 'drawing') return '开奖中';
  if (status === 'drawn') return '已开奖';
  if (status === 'cancelled') return '已取消';
  return status || '';
}

function statusTheme(status) {
  if (status === 'open') return 'primary';
  if (status === 'drawn') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'warning';
}

Page({
  data: {
    themeStyle: '',
    loading: true,
    creating: false,
    userCount: 0,
    title: '',
    poolPoints: '100',
    winnerCount: '5',
    drawAtText: defaultDrawAtLocal(),
    drawAtPickerVisible: false,
    drawAtStart: '',
    drawAtEnd: '',
    list: [],
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('adminManageLottery', { action: 'list' });
      const data = (res && res.data) || {};
      const list = (Array.isArray(data.list) ? data.list : []).map((item) => ({
        ...item,
        drawAtText: formatDate(item.drawAt, 'YYYY-MM-DD HH:mm'),
        statusLabel: statusLabel(item.status),
        statusTheme: statusTheme(item.status),
      }));
      this.setData({
        userCount: Number(data.userCount) || 0,
        list,
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onTitleChange(e) {
    this.setData({ title: (e.detail && e.detail.value) || '' });
  },
  onPoolChange(e) {
    this.setData({ poolPoints: (e.detail && e.detail.value) || '' });
  },
  onWinnerCountChange(e) {
    this.setData({ winnerCount: (e.detail && e.detail.value) || '' });
  },
  onOpenDrawAtPicker() {
    const range = drawAtPickerRange();
    let drawAtText = this.data.drawAtText;
    const current = parseLocalDateTime(drawAtText);
    const minAt = parseLocalDateTime(range.drawAtStart);
    if (!current || current < minAt) {
      drawAtText = defaultDrawAtLocal();
    }
    this.setData({
      ...range,
      drawAtText,
      drawAtPickerVisible: true,
    });
  },

  onCloseDrawAtPicker() {
    this.setData({ drawAtPickerVisible: false });
  },

  onDrawAtConfirm(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({
      drawAtText: value,
      drawAtPickerVisible: false,
    });
  },

  async onCreate() {
    if (this.data.creating) return;
    const title = String(this.data.title || '').trim();
    const poolPoints = Number(this.data.poolPoints);
    const winnerCount = Number(this.data.winnerCount);
    const drawAt = parseLocalDateTime(this.data.drawAtText);
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!Number.isFinite(poolPoints) || poolPoints < 1) {
      wx.showToast({ title: '奖池积分无效', icon: 'none' });
      return;
    }
    if (!Number.isFinite(winnerCount) || winnerCount < 1) {
      wx.showToast({ title: '中奖人数无效', icon: 'none' });
      return;
    }
    if (!drawAt) {
      wx.showToast({ title: '请选择开奖时间', icon: 'none' });
      return;
    }

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '确认创建抽奖',
        content: `「${title}」奖池 ${poolPoints} 积分 · ${winnerCount} 人中奖，将通知约 ${this.data.userCount} 名已注册用户。开奖后奖池按随机份额发给中奖者。`,
        confirmText: '确认创建',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ creating: true });
    wx.showLoading({ title: '创建中', mask: true });
    try {
      const res = await callFunction('adminManageLottery', {
        action: 'create',
        title,
        poolPoints,
        winnerCount,
        drawAt,
      });
      wx.hideLoading();
      wx.showModal({
        title: '已创建',
        content: res.message || '已通知用户',
        showCancel: false,
      });
      this.setData({
        title: '',
        drawAtText: defaultDrawAtLocal(),
      });
      this.loadList();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '创建失败', icon: 'none' });
    } finally {
      this.setData({ creating: false });
    }
  },

  async onCancel(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.creating) return;
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '取消活动',
        content: '取消后无法再参与，已参与用户不会开奖。确定？',
        confirmText: '取消活动',
        confirmColor: '#e34d59',
        success: (r) => resolve(!!r.confirm),
      });
    });
    if (!ok) return;
    try {
      await callFunction('adminManageLottery', { action: 'cancel', lotteryId: id });
      wx.showToast({ title: '已取消', icon: 'success' });
      this.loadList();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
    }
  },
});
