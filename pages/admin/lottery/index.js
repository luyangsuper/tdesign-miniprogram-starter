import { callFunction } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { getSubscribeMpState } from '~/utils/subscribe';
import { formatDate } from '~/utils/time';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

const GRID_SLOT_XY = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 2, y: 2 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
  { x: 0, y: 1 },
];
const GRID_SLOT_LABEL = ['左上', '上', '右上', '右', '右下', '下', '左下', '左'];

function gridArt(pts) {
  const n = Math.max(0, Number(pts) || 0);
  if (n >= 18) return '/static/lottery/pts18.png';
  if (n >= 12) return '/static/lottery/pts12.png';
  if (n >= 8) return '/static/lottery/pts8.png';
  if (n >= 4) return '/static/lottery/pts4.png';
  if (n >= 2) return '/static/lottery/pts2.png';
  if (n >= 1) return '/static/lottery/pts1.png';
  return '/static/lottery/miss.png';
}

function defaultGridPrizes() {
  const raw = [
    { name: '18 积分', points: 18, weight: 1 },
    { name: '2 积分', points: 2, weight: 140 },
    { name: '谢谢参与', points: 0, weight: 400 },
    { name: '8 积分', points: 8, weight: 24 },
    { name: '4 积分', points: 4, weight: 60 },
    { name: '12 积分', points: 12, weight: 6 },
    { name: '谢谢参与', points: 0, weight: 150 },
    { name: '1 积分', points: 1, weight: 200 },
  ];
  return decorateGridPrizes(
    raw.map((p, i) => ({
      id: `p${i}`,
      name: p.name,
      points: String(p.points),
      weight: String(p.weight),
    })),
  );
}

function decorateGridPrizes(prizes) {
  return (prizes || []).slice(0, 8).map((p, i) => {
    const points = String(p.points != null ? p.points : 0);
    return {
      id: p.id || `p${i}`,
      name: p.name || '',
      points,
      weight: String(p.weight != null ? p.weight : 0),
      slot: GRID_SLOT_LABEL[i] || `格${i + 1}`,
      art: gridArt(points),
      ...GRID_SLOT_XY[i],
    };
  });
}

function gridEvText(prizes, costPoints) {
  const list = prizes || [];
  const total = list.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);
  const cost = Number(costPoints);
  if (!total || !Number.isFinite(cost) || cost <= 0) return '填写消耗和权重后显示期望返还';
  const ev =
    list.reduce(
      (s, p) => s + Math.max(0, Number(p.weight) || 0) * Math.max(0, Number(p.points) || 0),
      0,
    ) / total;
  const rtp = (ev / cost) * 100;
  const warn = ev >= cost ? ' · 期望须小于消耗才能保存' : '';
  return `期望 ${ev.toFixed(2)} 积分/次 · 返还 ${rtp.toFixed(1)}%${warn}`;
}

function gridBoard(prizes) {
  const list = decorateGridPrizes(prizes);
  const cells = [];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      if (x === 1 && y === 1) {
        cells.push({ id: 'go', go: true, label: '抽' });
        continue;
      }
      const p = list.find((it) => it.x === x && it.y === y);
      cells.push({
        id: (p && p.id) || `c${x}${y}`,
        go: false,
        art: (p && p.art) || '/static/lottery/miss.png',
        label: (p && p.name) || '',
      });
    }
  }
  return cells;
}

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
    lotteryType: 'free',
    costPoints: '4',
    payoutPercent: '50',
    poolPoints: '100',
    winnerCount: '5',
    drawAtText: defaultDrawAtLocal(),
    drawAtPickerVisible: false,
    drawAtStart: '',
    drawAtEnd: '',
    list: [],
    gridEnabled: true,
    gridCost: '2',
    gridDailyLimit: '20',
    gridPrizes: [],
    gridBoard: [],
    gridEvText: '',
    gridSaving: false,
    gridResetting: false,
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    if (!guardAdminPage()) return;
    applyThemeToPage(this);
    this.loadList();
    this.loadGrid();
  },

  mapGrid(data) {
    const prizes = decorateGridPrizes(
      Array.isArray(data.prizes) && data.prizes.length
        ? data.prizes
        : defaultGridPrizes(),
    );
    const gridCost = String(data.costPoints != null ? data.costPoints : 2);
    return {
      gridEnabled: data.enabled !== false,
      gridCost,
      gridDailyLimit: String(data.dailyLimit != null ? data.dailyLimit : 20),
      gridPrizes: prizes,
      gridBoard: gridBoard(prizes),
      gridEvText: gridEvText(prizes, gridCost),
    };
  },

  _syncGridPreview() {
    const gridPrizes = decorateGridPrizes(this.data.gridPrizes);
    this.setData({
      gridPrizes,
      gridBoard: gridBoard(gridPrizes),
      gridEvText: gridEvText(gridPrizes, this.data.gridCost),
    });
  },

  async loadGrid() {
    try {
      const res = await callFunction('gridLottery', { action: 'adminGet' });
      this.setData(this.mapGrid((res && res.data) || {}));
    } catch (e) {
      /* 云函数未部署时不挡限时抽奖 */
    }
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
        payoutPercentText: item.type === 'paid'
          ? `${Math.round((Number(item.payoutRate) || 0.5) * 100)}%`
          : '',
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

  onGridEnabledChange(e) {
    this.setData({ gridEnabled: !!(e.detail && e.detail.value) });
  },
  onGridCostChange(e) {
    const gridCost = (e.detail && e.detail.value) || '';
    const gridPrizes = decorateGridPrizes(this.data.gridPrizes);
    this.setData({
      gridCost,
      gridPrizes,
      gridBoard: gridBoard(gridPrizes),
      gridEvText: gridEvText(gridPrizes, gridCost),
    });
  },
  onGridDailyChange(e) {
    this.setData({ gridDailyLimit: (e.detail && e.detail.value) || '' });
  },
  onGridPrizeChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const key = e.currentTarget.dataset.key;
    if (!Number.isFinite(index) || !key) return;
    const gridPrizes = (this.data.gridPrizes || []).slice();
    if (!gridPrizes[index]) return;
    gridPrizes[index] = {
      ...gridPrizes[index],
      [key]: (e.detail && e.detail.value) || '',
    };
    this.setData({ gridPrizes });
    this._syncGridPreview();
  },
  onResetGrid() {
    wx.showModal({
      title: '恢复默认奖池',
      content: '八格会回到对角谢谢、18 积分在左上。仍需点「保存九宫格」才会生效。',
      success: (r) => {
        if (!r.confirm) return;
        const gridPrizes = defaultGridPrizes();
        this.setData({
          gridEnabled: true,
          gridCost: '2',
          gridDailyLimit: '20',
          gridPrizes,
          gridBoard: gridBoard(gridPrizes),
          gridEvText: gridEvText(gridPrizes, '2'),
        });
      },
    });
  },
  async onSaveGrid() {
    if (this.data.gridSaving) return;
    const costPoints = Number(this.data.gridCost);
    const dailyLimit = Number(this.data.gridDailyLimit);
    if (!Number.isInteger(costPoints) || costPoints < 1) {
      wx.showToast({ title: '每次消耗须为正整数', icon: 'none' });
      return;
    }
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1) {
      wx.showToast({ title: '每日次数须为正整数', icon: 'none' });
      return;
    }
    const prizes = (this.data.gridPrizes || []).map((p) => ({
      id: p.id,
      name: p.name,
      points: Number(p.points),
      weight: Number(p.weight),
    }));
    this.setData({ gridSaving: true });
    try {
      const res = await callFunction('gridLottery', {
        action: 'adminSave',
        enabled: this.data.gridEnabled,
        costPoints,
        dailyLimit,
        prizes,
      });
      this.setData(this.mapGrid((res && res.data) || {}));
      wx.showToast({ title: res.message || '已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ gridSaving: false });
    }
  },

  async onResetMyGridToday() {
    if (this.data.gridResetting) return;
    this.setData({ gridResetting: true });
    try {
      await callFunction('gridLottery', { action: 'adminResetToday' });
      wx.showToast({ title: '今日次数已重置', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '重置失败', icon: 'none' });
    } finally {
      this.setData({ gridResetting: false });
    }
  },

  onTitleChange(e) {
    this.setData({ title: (e.detail && e.detail.value) || '' });
  },
  onTypeChange(e) {
    const lotteryType = e.currentTarget.dataset.type;
    const checked = e.detail && (e.detail.checked !== undefined ? e.detail.checked : e.detail);
    if (checked === false) return;
    if (lotteryType !== 'free' && lotteryType !== 'paid') return;
    if (lotteryType === this.data.lotteryType) return;
    this.setData({ lotteryType });
  },
  onCostChange(e) {
    this.setData({ costPoints: (e.detail && e.detail.value) || '' });
  },
  onPayoutPercentChange(e) {
    this.setData({ payoutPercent: (e.detail && e.detail.value) || '' });
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
    const lotteryType = this.data.lotteryType === 'paid' ? 'paid' : 'free';
    const poolPoints = Number(this.data.poolPoints);
    const winnerCount = Number(this.data.winnerCount);
    const costPoints = Number(this.data.costPoints);
    const payoutPercent = Number(this.data.payoutPercent);
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
    if (lotteryType === 'paid') {
      if (!Number.isInteger(costPoints) || costPoints < 1 || costPoints > 999) {
        wx.showToast({ title: '报名费须为 1–999 的整数', icon: 'none' });
        return;
      }
      if (!Number.isFinite(payoutPercent) || payoutPercent < 10 || payoutPercent > 90) {
        wx.showToast({ title: '返还比例须为 10–90', icon: 'none' });
        return;
      }
    }
    if (!drawAt) {
      wx.showToast({ title: '请选择开奖时间', icon: 'none' });
      return;
    }

    const paidTip =
      lotteryType === 'paid'
        ? `每人投入 ${costPoints} 分，实发不超过报名费的 ${payoutPercent}% 且不超过奖池上限 ${poolPoints}。`
        : `奖池 ${poolPoints} 积分，开奖后按随机份额发给中奖者。`;
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '确认创建抽奖',
        content: `「${title}」${paidTip}${winnerCount} 人中奖，将通知约 ${this.data.userCount} 名已注册用户。`,
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
        type: lotteryType,
        costPoints: lotteryType === 'paid' ? costPoints : 0,
        payoutRate: lotteryType === 'paid' ? payoutPercent / 100 : 0,
        poolPoints,
        winnerCount,
        drawAt,
        miniprogramState: getSubscribeMpState(),
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
        content: '取消后无法再参与。投入积分的活动会把报名费退回。确定？',
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
