import { callFunction } from '~/utils/cloud';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { getPricingPlans, loadPricingPlans } from '~/utils/pricing';
import {
  benefitLabel,
  createAndCopyCode,
  formatRedeemShareText,
} from '~/utils/redeemCode';

Page({
  data: {
    pricing: getPricingPlans(),
    type: 'vip_days',
    value: '30',
    count: '1',
    activePlanKey: 'month',
    submitting: false,
    genPlanKey: '',
    resultLabel: '',
    resultType: '',
    resultValue: 0,
    codes: [],
    filterStatus: 'all',
    list: [],
    listLoading: false,
    listHasMore: true,
    listPage: 1,
    disablingId: '',
    purging: false,
    themeStyle: '',
  },

  onLoad() {
    const pricing = getPricingPlans();
    const first = (pricing.vipPlans && pricing.vipPlans[0]) || null;
    this.setData({
      themeStyle: getThemeStyle(),
      pricing,
      activePlanKey: first ? first.key : '',
      type: first ? first.type : 'vip_days',
      value: first ? String(first.value) : '30',
    });
    this.hydratePricing();
  },

  onShow() {
    applyThemeToPage(this);
    this.hydratePricing();
    this.loadList(true);
  },

  async hydratePricing() {
    try {
      const pricing = await loadPricingPlans();
      const first = (pricing.vipPlans && pricing.vipPlans[0]) || null;
      const patch = { pricing };
      if (!this.data.activePlanKey && first) {
        patch.activePlanKey = first.key;
        patch.type = first.type;
        patch.value = String(first.value);
      }
      this.setData(patch);
    } catch (e) {
      this.setData({ pricing: getPricingPlans() });
    }
  },

  applyPlan(plan) {
    if (!plan) return;
    this.setData({
      activePlanKey: plan.key,
      type: plan.type,
      value: String(plan.value),
    });
  },

  async onQuickGen(e) {
    if (this.data.genPlanKey || this.data.submitting) return;
    const key = e.currentTarget.dataset.key;
    const kind = e.currentTarget.dataset.kind;
    const pricing = this.data.pricing || getPricingPlans();
    const list = kind === 'points' ? pricing.pointPlans : pricing.vipPlans;
    const plan = (list || []).find((p) => p.key === key);
    if (!plan) return;

    this.applyPlan(plan);
    this.setData({ genPlanKey: key });
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const result = await createAndCopyCode(plan, { count: 1 });
      this.setData({
        codes: result.codes,
        resultLabel: result.label,
        resultType: plan.type,
        resultValue: Number(plan.value) || 0,
      });
      wx.showToast({ title: '已生成并复制文案', icon: 'success' });
      this.loadList(true);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ genPlanKey: '' });
    }
  },

  onTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    if (!type || type === this.data.type) return;
    this.setData({
      type,
      value: type === 'vip_days' ? '30' : '20',
      activePlanKey: '',
    });
  },

  onFilterChange(e) {
    const status = e.currentTarget.dataset.status;
    if (!status || status === this.data.filterStatus) return;
    this.setData({ filterStatus: status });
    this.loadList(true);
  },

  onValueChange(e) {
    this.setData({ value: e.detail.value, activePlanKey: '' });
  },

  onCountChange(e) {
    this.setData({ count: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting || this.data.genPlanKey) return;
    const value = Number(this.data.value);
    const count = Number(this.data.count);
    if (!value || value < 1) {
      wx.showToast({ title: '请填写有效数值', icon: 'none' });
      return;
    }
    if (!count || count < 1) {
      wx.showToast({ title: '生成数量至少 1', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const type = this.data.type;
      const res = await callFunction('adminCreateCodes', {
        type,
        value,
        count,
      });
      const data = res.data || {};
      const codes = data.codes || [];
      const label = data.label || benefitLabel(type, value);
      this.setData({
        codes,
        resultLabel: label,
        resultType: type,
        resultValue: value,
      });
      const shareText = formatRedeemShareText({ type, value, label, codes });
      if (shareText) {
        wx.setClipboardData({
          data: shareText,
          success: () =>
            wx.showToast({
              title: codes.length === 1 ? '已生成并复制文案' : `已生成 ${codes.length} 个并复制`,
              icon: 'success',
            }),
        });
      } else {
        wx.showToast({ title: `已生成 ${data.count || 0} 个`, icon: 'success' });
      }
      this.loadList(true);
    } catch (e) {
      wx.showToast({ title: e.message || '生成失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  async loadList(reset = false) {
    if (this.data.listLoading) return;
    if (!reset && !this.data.listHasMore) return;

    const page = reset ? 1 : this.data.listPage;
    this.setData({ listLoading: true });
    try {
      const res = await callFunction('adminManageCodes', {
        action: 'list',
        page,
        pageSize: 20,
        status: this.data.filterStatus,
      });
      const data = res.data || {};
      const list = data.list || [];
      this.setData({
        list: reset ? list : this.data.list.concat(list),
        listPage: page + 1,
        listHasMore: !!data.hasMore,
        listLoading: false,
      });
    } catch (e) {
      this.setData({ listLoading: false });
      if (reset) {
        wx.showToast({ title: e.message || '列表加载失败', icon: 'none' });
      }
    }
  },

  onReachBottom() {
    this.loadList(false);
  },

  copyShareText(codes, meta = {}) {
    const list = Array.isArray(codes) ? codes : [codes];
    const text = formatRedeemShareText({
      type: meta.type || this.data.resultType,
      value: meta.value != null ? meta.value : this.data.resultValue,
      label: meta.label || this.data.resultLabel,
      codes: list,
    });
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制文案', icon: 'success' }),
    });
  },

  copyAll() {
    const { codes } = this.data;
    if (!codes.length) return;
    this.copyShareText(codes);
  },

  copyOne(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    const fromList = (this.data.list || []).find((item) => item.code === code);
    this.copyShareText([code], {
      type: fromList && fromList.type,
      value: fromList && fromList.value,
      label: (fromList && fromList.label) || this.data.resultLabel,
    });
  },

  goManageUser(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) return;
    wx.navigateTo({
      url: `/pages/admin/users/index?openid=${encodeURIComponent(openid)}`,
    });
  },

  async onDisable(e) {
    const { id, code } = e.currentTarget.dataset;
    if (!id || this.data.disablingId) return;
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '作废兑换码',
        content: `确定作废 ${code}？作废后不可再兑换。`,
        confirmText: '作废',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ disablingId: id });
    try {
      await callFunction('adminManageCodes', { action: 'disable', id });
      wx.showToast({ title: '已作废', icon: 'success' });
      this.loadList(true);
    } catch (err) {
      wx.showToast({ title: err.message || '作废失败', icon: 'none' });
    } finally {
      this.setData({ disablingId: '' });
    }
  },

  async onPurgeInactive() {
    if (this.data.purging) return;
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '清理失效兑换码',
        content: '将永久删除全部「已作废」和「已使用」兑换码，未使用的不受影响。此操作不可恢复。',
        confirmText: '确认删除',
        confirmColor: '#e34d59',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ purging: true });
    wx.showLoading({ title: '清理中', mask: true });
    try {
      const res = await callFunction('adminManageCodes', {
        action: 'purgeInactive',
        scope: 'inactive',
      });
      wx.hideLoading();
      const n = (res && res.data && res.data.removed) || 0;
      wx.showToast({
        title: n > 0 ? `已删除 ${n} 条` : '没有可清理的',
        icon: n > 0 ? 'success' : 'none',
      });
      this.loadList(true);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '清理失败', icon: 'none' });
    } finally {
      this.setData({ purging: false });
    }
  },
});
