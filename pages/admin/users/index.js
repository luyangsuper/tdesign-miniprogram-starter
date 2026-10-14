import { callFunction } from '~/utils/cloud';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

Page({
  data: {
    filter: 'all',
    keyword: '',
    list: [],
    listLoading: false,
    listHasMore: true,
    listPage: 1,
    total: 0,
    panelVisible: false,
    user: null,
    saving: false,
    vipDays: '30',
    pointsValue: '0',
    downloadPacks: [],
    downloadsLoading: false,
    confirmVisible: false,
    confirmTitle: '',
    confirmContent: '',
    confirmAction: '',
    confirmExtra: null,
    themeStyle: '',
  },

  onLoad(options) {
    const openid = options && options.openid ? decodeURIComponent(options.openid) : '';
    this._pendingOpenid = openid || '';
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
    this.loadList(true).then(() => {
      if (this._pendingOpenid) {
        const openid = this._pendingOpenid;
        this._pendingOpenid = '';
        this.openUserByOpenid(openid);
      }
    });
  },

  async openUserByOpenid(openid) {
    if (!openid) return;
    const hit = (this.data.list || []).find((u) => u.openid === openid);
    if (hit) {
      this.openUserPanel(hit);
      return;
    }
    wx.showLoading({ title: '加载用户', mask: true });
    try {
      const res = await callFunction('adminManageUser', { action: 'get', openid });
      const user = res.data;
      if (!user) throw new Error('未找到用户');
      this.setData({ keyword: openid });
      this.openUserPanel(user);
    } catch (e) {
      wx.showToast({ title: e.message || '打开失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  openUserPanel(user) {
    if (!user) return;
    this.setData({
      user,
      panelVisible: true,
      vipDays: '30',
      pointsValue: String((user.entitlement && user.entitlement.points) || 0),
      downloadPacks: [],
      downloadsLoading: true,
    });
    this.loadUserDownloads(user.openid);
  },

  async loadUserDownloads(openid) {
    if (!openid) {
      this.setData({ downloadPacks: [], downloadsLoading: false });
      return;
    }
    this.setData({ downloadsLoading: true });
    try {
      const res = await callFunction('adminManageUser', {
        action: 'listDownloads',
        openid,
      });
      const data = (res && res.data) || {};
      // 面板可能已切到其他用户
      if (!this.data.user || this.data.user.openid !== openid) return;
      this.setData({
        downloadPacks: data.list || [],
        downloadsLoading: false,
      });
    } catch (e) {
      if (!this.data.user || this.data.user.openid !== openid) return;
      this.setData({ downloadPacks: [], downloadsLoading: false });
    }
  },

  onFilterChange(e) {
    const filter = e.currentTarget.dataset.filter;
    if (!filter || filter === this.data.filter) return;
    this.setData({ filter });
    this.loadList(true);
  },

  onKeywordChange(e) {
    this.setData({ keyword: (e.detail && e.detail.value) || '' });
  },

  onSearchSubmit() {
    this.loadList(true);
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.loadList(true);
  },

  async loadList(reset = false) {
    if (this.data.listLoading) return;
    if (!reset && !this.data.listHasMore) return;

    const page = reset ? 1 : this.data.listPage;
    this.setData({ listLoading: true });
    try {
      const res = await callFunction('adminManageUser', {
        action: 'list',
        page,
        pageSize: 20,
        filter: this.data.filter,
        keyword: this.data.keyword,
      });
      const data = res.data || {};
      const list = data.list || [];
      this.setData({
        list: reset ? list : this.data.list.concat(list),
        listPage: page + 1,
        listHasMore: !!data.hasMore,
        total: data.total || 0,
        listLoading: false,
      });
    } catch (e) {
      this.setData({ listLoading: false });
      if (reset) wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onReachBottom() {
    this.loadList(false);
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => wx.stopPullDownRefresh());
  },

  onSelectUser(e) {
    const { index } = e.currentTarget.dataset;
    const user = this.data.list[index];
    if (!user) return;
    this.openUserPanel(user);
  },

  closePanel() {
    this.setData({
      panelVisible: false,
      downloadPacks: [],
      downloadsLoading: false,
    });
  },

  onPopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible) {
      this.setData({
        panelVisible: false,
        downloadPacks: [],
        downloadsLoading: false,
      });
      return;
    }
    this.setData({ panelVisible: true });
  },

  onVipDaysChange(e) {
    const v = e.detail && (e.detail.value !== undefined ? e.detail.value : e.detail);
    this.setData({ vipDays: v == null ? '' : String(v) });
  },

  onPointsChange(e) {
    const v = e.detail && (e.detail.value !== undefined ? e.detail.value : e.detail);
    this.setData({ pointsValue: v == null ? '' : String(v) });
  },

  onOpenPack(e) {
    const packId = e.currentTarget.dataset.id;
    if (!packId) return;
    wx.navigateTo({ url: `/pages/pack/detail/index?id=${packId}` });
  },

  askConfirm(action, title, content, extra = null) {
    if (!this.data.user) return;
    this.setData({
      confirmVisible: true,
      confirmTitle: title || '确认操作',
      confirmContent: content || '',
      confirmAction: action,
      confirmExtra: extra,
    });
  },

  askCancelVip() {
    this.askConfirm(
      'cancelVip',
      '取消包月？',
      '将立即结束该用户包月会员，本月额度也会清零。',
    );
  },

  closeConfirm() {
    this.setData({
      confirmVisible: false,
      confirmAction: '',
      confirmContent: '',
      confirmExtra: null,
    });
  },

  async onConfirm() {
    const { confirmAction, confirmExtra } = this.data;
    this.setData({
      confirmVisible: false,
      confirmAction: '',
      confirmContent: '',
      confirmExtra: null,
    });
    if (!confirmAction) return;
    await this.runAction(confirmAction, confirmExtra || {});
  },

  patchListUser(next) {
    if (!next || !next.openid) return;
    const list = (this.data.list || []).map((u) => (u.openid === next.openid ? next : u));
    this.setData({
      list,
      user: next,
      pointsValue: String((next.entitlement && next.entitlement.points) || 0),
    });
  },

  async runAction(action, extra = {}) {
    const user = this.data.user;
    if (!user || this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await callFunction('adminManageUser', {
        action,
        openid: user.openid,
        ...extra,
      });
      const next = res.data || null;
      this.patchListUser(next);
      wx.showToast({ title: res.message || '已更新', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  onSetVipDays() {
    const days = Number(this.data.vipDays);
    if (!days || days < 1) {
      wx.showToast({ title: '请填写有效天数', icon: 'none' });
      return;
    }
    const isVip = !!(this.data.user && this.data.user.entitlement && this.data.user.entitlement.isVip);
    this.askConfirm(
      'setVipDays',
      isVip ? '确认续期？' : '确认开通包月？',
      isVip
        ? `在现有到期日上叠加 ${days} 天。`
        : `开通包月 ${days} 天，并按自然月发放本月额度。`,
      { days },
    );
  },

  onSetPoints() {
    const points = Number(this.data.pointsValue);
    if (Number.isNaN(points) || points < 0) {
      wx.showToast({ title: '请填写有效积分', icon: 'none' });
      return;
    }
    const cur = Number(
      (this.data.user && this.data.user.entitlement && this.data.user.entitlement.points) || 0,
    );
    this.askConfirm(
      'setPoints',
      '确认设置积分？',
      `将积分从 ${cur} 分改为 ${points} 分。`,
      { points },
    );
  },

  onAdjustPoints(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    if (!delta) return;
    const cur = Number(
      (this.data.user && this.data.user.entitlement && this.data.user.entitlement.points) || 0,
    );
    const next = Math.max(0, cur + delta);
    const sign = delta > 0 ? `+${delta}` : `${delta}`;
    this.askConfirm(
      'adjustPoints',
      '确认调整积分？',
      `当前 ${cur} 分，${sign} 分后变为 ${next} 分。`,
      { delta },
    );
  },

  onClearPoints() {
    const cur = Number(
      (this.data.user && this.data.user.entitlement && this.data.user.entitlement.points) || 0,
    );
    this.askConfirm(
      'setPoints',
      '确认清零积分？',
      `将把当前 ${cur} 分清为零。`,
      { points: 0 },
    );
  },

  copyOpenid() {
    const openid = this.data.user && this.data.user.openid;
    if (!openid) return;
    wx.setClipboardData({
      data: openid,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },
});
