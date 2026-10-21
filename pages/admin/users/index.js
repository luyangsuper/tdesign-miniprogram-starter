import { callFunction } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { getDefaultAvatarUrl } from '~/utils/avatar';

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
    repairing: false,
    vipDays: '30',
    pointsValue: '0',
    pointsDelta: '',
    downloadPacks: [],
    downloadsLoading: false,
    pointsLogs: [],
    pointsLogsLoading: false,
    pointsLogsHasMore: true,
    pointsLogsPage: 1,
    pointsLogsTotal: 0,
    pointsLogsValue: [],
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
    if (!guardAdminPage()) return;
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
      pointsDelta: '',
      downloadPacks: [],
      downloadsLoading: true,
      pointsLogs: [],
      pointsLogsLoading: true,
      pointsLogsHasMore: true,
      pointsLogsPage: 1,
      pointsLogsTotal: 0,
      pointsLogsValue: [],
    });
    this.loadUserDownloads(user.openid);
    this.loadUserPointsLogs(user.openid, true);
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

  async loadUserPointsLogs(openid, reset = false) {
    if (!openid) {
      this.setData({
        pointsLogs: [],
        pointsLogsLoading: false,
        pointsLogsHasMore: false,
        pointsLogsTotal: 0,
      });
      return;
    }
    if (this.data.pointsLogsLoading && !reset) return;
    if (!reset && !this.data.pointsLogsHasMore) return;

    const page = reset ? 1 : this.data.pointsLogsPage;
    this._pointsLogsSeq = (this._pointsLogsSeq || 0) + 1;
    const seq = this._pointsLogsSeq;
    this.setData({ pointsLogsLoading: true });
    try {
      const res = await callFunction('adminManageUser', {
        action: 'listPointsLogs',
        openid,
        page,
        pageSize: 20,
      });
      if (seq !== this._pointsLogsSeq) return;
      const data = (res && res.data) || {};
      if (!this.data.user || this.data.user.openid !== openid) return;
      const list = data.list || [];
      this.setData({
        pointsLogs: reset ? list : this.data.pointsLogs.concat(list),
        pointsLogsPage: page + 1,
        pointsLogsHasMore: !!data.hasMore,
        pointsLogsTotal: data.total || 0,
        pointsLogsLoading: false,
      });
    } catch (e) {
      if (seq !== this._pointsLogsSeq) return;
      if (!this.data.user || this.data.user.openid !== openid) return;
      this.setData({
        pointsLogsLoading: false,
        pointsLogsHasMore: false,
      });
    }
  },

  onLoadMorePointsLogs() {
    const user = this.data.user;
    if (!user || !user.openid) return;
    this.loadUserPointsLogs(user.openid, false);
  },

  onPointsLogsCollapse(e) {
    const value = (e.detail && e.detail.value) || e.detail || [];
    this.setData({ pointsLogsValue: Array.isArray(value) ? value : [] });
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

  fallbackAvatarUrl(current, openid) {
    const fallback = getDefaultAvatarUrl(openid);
    if (current && current !== fallback) return fallback;
    return '';
  },

  onListAvatarError(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    const list = this.data.list.slice();
    const item = list[index];
    if (!item) return;
    const next = this.fallbackAvatarUrl(item.avatarUrl, item.openid);
    if (next === item.avatarUrl) return;
    list[index] = { ...item, avatarUrl: next };
    this.setData({ list });
  },

  onPanelAvatarError() {
    const user = this.data.user;
    if (!user) return;
    const next = this.fallbackAvatarUrl(user.avatarUrl, user.openid);
    if (next === user.avatarUrl) return;
    this.setData({ user: { ...user, avatarUrl: next } });
  },

  resetPanelExtras() {
    return {
      downloadPacks: [],
      downloadsLoading: false,
      pointsLogs: [],
      pointsLogsLoading: false,
      pointsLogsHasMore: true,
      pointsLogsPage: 1,
      pointsLogsTotal: 0,
      pointsLogsValue: [],
    };
  },

  closePanel() {
    this.setData({
      panelVisible: false,
      ...this.resetPanelExtras(),
    });
  },

  onPopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible) {
      this.setData({
        panelVisible: false,
        ...this.resetPanelExtras(),
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

  onPointsDeltaChange(e) {
    const v = e.detail && (e.detail.value !== undefined ? e.detail.value : e.detail);
    this.setData({ pointsDelta: v == null ? '' : String(v) });
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

  askRepairEntitlements() {
    this.askConfirm(
      'repairEntitlements',
      '确认一键补发？',
      '将检查并补发：未到账的新用户见面礼、已中奖抽奖积分、已支付未发货的购买订单。已发放过的不会重复发放。',
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
    if (confirmAction === 'repairEntitlements') {
      await this.runRepairEntitlements();
      return;
    }
    await this.runAction(confirmAction, confirmExtra || {});
  },

  /**
   * 见面礼/抽奖 → adminManageUser；购买订单 → createVirtualOrder.recoverUser
   */
  async runRepairEntitlements() {
    const user = this.data.user;
    if (!user || !user.openid || this.data.repairing || this.data.saving) return;
    this.setData({ repairing: true });
    wx.showLoading({ title: '补发中', mask: true });
    const lines = [];
    let nextUser = null;
    try {
      const entRes = await callFunction('adminManageUser', {
        action: 'repairEntitlements',
        openid: user.openid,
      });
      nextUser = entRes.data || null;
      const welcome = entRes.repair && entRes.repair.welcome;
      const lottery = entRes.repair && entRes.repair.lottery;
      if (welcome) {
        lines.push(
          welcome.granted
            ? welcome.message
            : welcome.message === '见面礼已发放过'
              ? '见面礼：已发放过'
              : `见面礼：${welcome.message}`,
        );
      }
      if (lottery) {
        lines.push(
          lottery.repaired > 0
            ? lottery.message
            : '抽奖：无需补发',
        );
      }

      let orderRes = null;
      try {
        orderRes = await callFunction('createVirtualOrder', {
          action: 'recoverUser',
          openid: user.openid,
        });
      } catch (e) {
        lines.push(`订单：${(e && e.message) || '补发失败'}`);
      }
      if (orderRes) {
        const results = orderRes.results || [];
        const delivered = results.filter((r) => r && r.ok && r.delivered && !r.already);
        const already = results.filter((r) => r && r.ok && r.already);
        const failed = results.filter((r) => r && !r.ok);
        const unpaid = results.filter((r) => r && r.ok && r.paid === false);
        if (delivered.length) {
          lines.push(`订单：新补发 ${delivered.length} 笔`);
        } else if (already.length) {
          lines.push(`订单：${already.length} 笔已到账`);
        } else if (unpaid.length && !failed.length) {
          lines.push('订单：有未支付单，无需发货');
        } else if (failed.length) {
          lines.push(`订单：${failed.length} 笔失败`);
        } else {
          lines.push('订单：无待补发');
        }
        // 订单可能改了积分/包月，再拉一次最新用户
        try {
          const fresh = await callFunction('adminManageUser', {
            action: 'get',
            openid: user.openid,
          });
          if (fresh && fresh.data) nextUser = fresh.data;
        } catch (e) {
          /* keep nextUser from entRes */
        }
      }

      if (nextUser) this.patchListUser(nextUser);
      const content = lines.length ? lines.join('\n') : '未发现可补发项';
      wx.showModal({
        title: '补发结果',
        content,
        showCancel: false,
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '补发失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ repairing: false });
    }
  },

  patchListUser(next) {
    if (!next || !next.openid) return;
    const list = (this.data.list || []).map((u) => (u.openid === next.openid ? next : u));
    this.setData({
      list,
      user: next,
      pointsValue: String((next.entitlement && next.entitlement.points) || 0),
    });
    if (this.data.panelVisible) {
      this.loadUserPointsLogs(next.openid, true);
    }
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

  parseCustomDelta() {
    const amount = Number(this.data.pointsDelta);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      wx.showToast({ title: '请填写大于 0 的整数', icon: 'none' });
      return 0;
    }
    return amount;
  },

  confirmAdjustPoints(delta) {
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

  onAdjustPoints(e) {
    this.confirmAdjustPoints(Number(e.currentTarget.dataset.delta));
  },

  onAddCustomPoints() {
    const amount = this.parseCustomDelta();
    if (!amount) return;
    this.confirmAdjustPoints(amount);
  },

  onSubCustomPoints() {
    const amount = this.parseCustomDelta();
    if (!amount) return;
    this.confirmAdjustPoints(-amount);
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
