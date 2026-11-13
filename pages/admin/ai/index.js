import { callFunction } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeBrand, getThemeStyle } from '~/utils/theme';

/** @see https://docs.cloudbase.net/ai/ai-inspire-plan-new-models-2026-11 */
const CLOUDBASE_MODEL_META = [
  { id: 'hy4', vision: true },
  { id: 'hy4-preview', vision: false },
  { id: 'hy3', vision: false },
  { id: 'deepseek-v4.1-flash', vision: true },
  { id: 'deepseek-v4.1-flash-1017', vision: true },
];

const CLOUDBASE_MODELS = CLOUDBASE_MODEL_META.map((m) => m.id);
const VISION_SET = new Set(CLOUDBASE_MODEL_META.filter((m) => m.vision).map((m) => m.id));

function toModelOptions(models = [], type = 'custom') {
  const list = (models || []).filter(Boolean);
  if (type === 'cloudbase') {
    const merged = [];
    const seen = new Set();
    [...CLOUDBASE_MODELS, ...list].forEach((id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(id);
    });
    return merged.map((id) => ({
      id,
      vision: VISION_SET.has(id),
      label: VISION_SET.has(id) ? `${id} · 识图` : id,
    }));
  }
  return list.map((id) => ({ id, vision: false, label: id }));
}

function blankProvider() {
  return {
    id: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'custom',
    typeLabel: '自备接口',
    name: '自备接口',
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    apiKeySet: false,
    model: '',
    models: [],
    modelOptions: [],
  };
}

function blankCloudbaseProvider() {
  return {
    id: 'cloudbase_experience',
    type: 'cloudbase',
    typeLabel: '云开发体验 · 免 Key',
    name: '云开发体验模型',
    baseURL: 'cloudbase',
    apiKey: '',
    apiKeySet: true,
    model: 'hy4',
    models: CLOUDBASE_MODELS.slice(),
    modelOptions: toModelOptions(CLOUDBASE_MODELS, 'cloudbase'),
  };
}

function normalizeProviderItem(p = {}) {
  const type =
    p.type === 'cloudbase' || p.baseURL === 'cloudbase' || p.id === 'cloudbase_experience'
      ? 'cloudbase'
      : 'custom';
  const models =
    type === 'cloudbase'
      ? toModelOptions(p.models || [], 'cloudbase').map((o) => o.id)
      : Array.isArray(p.models)
        ? p.models
        : [];
  return {
    ...p,
    type,
    typeLabel: type === 'cloudbase' ? '云开发体验 · 免 Key' : '自备接口',
    baseURL: type === 'cloudbase' ? 'cloudbase' : p.baseURL || '',
    apiKey: type === 'cloudbase' ? '' : p.apiKey || '',
    apiKeySet: type === 'cloudbase' ? true : !!p.apiKeySet,
    models,
    modelOptions: toModelOptions(models, type),
    model: p.model || (type === 'cloudbase' ? 'hy4' : ''),
  };
}

Page({
  data: {
    themeStyle: '',
    themeBrand: '',
    loading: true,
    saving: false,
    dirty: false,
    busyId: '',
    busyAction: '',
    activeProviderId: '',
    providers: [],
    hasCloudbase: false,
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle(), themeBrand: getThemeBrand() });
    this._loadedOnce = false;
  },

  onShow() {
    if (!guardAdminPage()) return;
    applyThemeToPage(this);
    // 有未保存修改时不重载，避免切页把编辑冲掉
    if (!this._loadedOnce || !this.data.dirty) {
      this.loadConfig();
    }
  },

  markDirty() {
    if (!this.data.dirty) this.setData({ dirty: true });
  },

  applyConfig(data = {}) {
    const providers = (data.providers || []).map(normalizeProviderItem);
    this.setData({
      activeProviderId: data.activeProviderId || (providers[0] && providers[0].id) || '',
      providers,
      hasCloudbase: providers.some((p) => p.type === 'cloudbase'),
      dirty: false,
    });
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('generatePackCopy', { action: 'getConfig' });
      this.applyConfig((res && res.data) || {});
      this._loadedOnce = true;
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onFieldChange(e) {
    const id = e.currentTarget.dataset.id;
    const field = e.currentTarget.dataset.field;
    const value = e.detail && e.detail.value != null ? e.detail.value : e.detail;
    const providers = (this.data.providers || []).map((p) => {
      if (p.id !== id) return p;
      return { ...p, [field]: value };
    });
    this.setData({ providers });
    this.markDirty();
  },

  onModelPick(e) {
    const id = e.currentTarget.dataset.id;
    const model = e.currentTarget.dataset.model;
    if (!id || !model) return;
    const providers = (this.data.providers || []).map((p) => {
      if (p.id !== id) return p;
      return { ...p, model };
    });
    this.setData({ providers });
    this.markDirty();
    const p = providers.find((item) => item.id === id);
    if (p && p.type === 'cloudbase' && !VISION_SET.has(model)) {
      wx.showToast({
        title: '该模型不识图，生成封面文案会自动改用识图模型',
        icon: 'none',
        duration: 2500,
      });
    }
  },

  onAddCloudbase() {
    if (this.data.hasCloudbase) {
      wx.showToast({ title: '已添加过体验配置', icon: 'none' });
      return;
    }
    const next = blankCloudbaseProvider();
    const providers = [next, ...(this.data.providers || [])];
    this.setData({
      providers,
      hasCloudbase: true,
      activeProviderId: next.id,
      dirty: true,
    });
    wx.showToast({ title: '已设为当前，请保存后生效', icon: 'none' });
  },

  onAdd() {
    const next = blankProvider();
    const providers = [...(this.data.providers || []), next];
    const patch = { providers, dirty: true };
    if (!this.data.activeProviderId) patch.activeProviderId = next.id;
    this.setData(patch);
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const providers = this.data.providers || [];
    if (providers.length <= 1) {
      wx.showToast({ title: '至少保留一套', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除配置',
      content: '确定删除？未点保存前只影响本页；保存后上传页才会同步。',
      success: (r) => {
        if (!r.confirm) return;
        const next = providers.filter((p) => p.id !== id);
        let activeProviderId = this.data.activeProviderId;
        if (activeProviderId === id) {
          activeProviderId = (next[0] && next[0].id) || '';
        }
        this.setData({
          providers: next,
          activeProviderId,
          hasCloudbase: next.some((p) => p.type === 'cloudbase'),
          dirty: true,
        });
      },
    });
  },

  onSetActive(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.activeProviderId) return;
    this.setData({ activeProviderId: id, dirty: true });
    wx.showToast({ title: '已标为当前，请保存后上传页才会用', icon: 'none' });
  },

  findProvider(id) {
    return (this.data.providers || []).find((p) => p.id === id) || null;
  },

  async onPing(e) {
    const id = e.currentTarget.dataset.id;
    const p = this.findProvider(id);
    if (!p) return;
    if (this.data.busyId || this.data.saving) return;
    this.setData({ busyId: id, busyAction: 'ping' });
    wx.showLoading({ title: '检测中', mask: true });
    try {
      const payload = {
        action: 'ping',
        providerId: id,
        type: p.type === 'cloudbase' ? 'cloudbase' : 'custom',
        model: p.model || '',
      };
      if (p.type === 'cloudbase') {
        payload.baseURL = 'cloudbase';
      } else {
        payload.baseURL = p.baseURL || '';
        payload.apiKey = p.apiKey || '';
      }
      const res = await callFunction('generatePackCopy', payload);
      const data = (res && res.data) || {};
      const ok = !!data.apiOk;
      wx.showModal({
        title: ok ? '连通正常' : '未就绪',
        content: `${data.tip || res.message || ''}\n\n${p.name || ''}\n${
          p.type === 'cloudbase' ? '云开发体验' : `BASE: ${data.base || p.baseURL || '-'}`
        }\n模型: ${data.model || p.model || '-'}`,
        showCancel: false,
      });
    } catch (err) {
      wx.showModal({
        title: '检测失败',
        content: (err && err.message) || '无法检测',
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ busyId: '', busyAction: '' });
    }
  },

  async onLoadModels(e) {
    const id = e.currentTarget.dataset.id;
    const p = this.findProvider(id);
    if (!p) return;
    if (this.data.busyId || this.data.saving) return;
    if (p.type !== 'cloudbase') {
      if (!String(p.baseURL || '').trim()) {
        wx.showToast({ title: '请先填 baseURL', icon: 'none' });
        return;
      }
      if (!String(p.apiKey || '').trim() && !p.apiKeySet) {
        wx.showToast({ title: '请先填 API Key', icon: 'none' });
        return;
      }
    }
    this.setData({ busyId: id, busyAction: 'models' });
    wx.showLoading({ title: '刷新模型', mask: true });
    try {
      const payload = {
        action: 'listModels',
        providerId: id,
        type: p.type === 'cloudbase' ? 'cloudbase' : 'custom',
      };
      if (p.type === 'cloudbase') {
        payload.baseURL = 'cloudbase';
      } else {
        payload.baseURL = p.baseURL;
        payload.apiKey = p.apiKey;
      }
      const res = await callFunction('generatePackCopy', payload);
      const data = (res && res.data) || {};
      const models = (data.models || []).slice();
      if (!models.length) {
        wx.showToast({ title: '未返回模型', icon: 'none' });
        return;
      }
      const modelOptions =
        (data.modelOptions && data.modelOptions.length
          ? data.modelOptions
          : toModelOptions(models, p.type)) || [];
      const providers = (this.data.providers || []).map((item) => {
        if (item.id !== id) return item;
        const model =
          (item.model && models.includes(item.model) ? item.model : '') || models[0];
        return {
          ...item,
          models,
          modelOptions: toModelOptions(
            modelOptions.map((o) => o.id || o),
            item.type,
          ),
          model,
        };
      });
      this.setData({ providers });
      if (data.tip) {
        wx.showModal({ title: '模型已刷新', content: data.tip, showCancel: false });
      } else {
        wx.showToast({ title: `已刷新 ${models.length} 个`, icon: 'success' });
      }
    } catch (err) {
      wx.showModal({
        title: '刷新失败',
        content: (err && err.message) || '无法刷新模型',
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ busyId: '', busyAction: '' });
    }
  },

  async onSave() {
    if (this.data.saving || this.data.busyId) return;
    const providers = this.data.providers || [];
    if (!providers.length) {
      wx.showToast({ title: '请先添加配置', icon: 'none' });
      return;
    }
    for (let i = 0; i < providers.length; i += 1) {
      const p = providers[i];
      if (p.type === 'cloudbase') continue;
      if (!String(p.baseURL || '').trim()) {
        wx.showToast({ title: `第 ${i + 1} 套缺少 baseURL`, icon: 'none' });
        return;
      }
      if (!String(p.apiKey || '').trim() && !p.apiKeySet) {
        wx.showToast({ title: `「${p.name || i + 1}」缺少 API Key`, icon: 'none' });
        return;
      }
    }
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const res = await callFunction('generatePackCopy', {
        action: 'saveConfig',
        activeProviderId: this.data.activeProviderId,
        providers: providers.map((p) => ({
          id: p.id,
          type: p.type === 'cloudbase' ? 'cloudbase' : 'custom',
          name: p.name,
          baseURL: p.type === 'cloudbase' ? 'cloudbase' : p.baseURL,
          apiKey: p.type === 'cloudbase' ? '' : p.apiKey,
          model: p.model,
          models: p.models,
        })),
      });
      this.applyConfig((res && res.data) || {});
      this._loadedOnce = true;
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.showModal({
        title: '保存失败',
        content: (e && e.message) || '请重试',
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },
});
