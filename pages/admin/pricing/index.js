import { callFunction, getTempFileURLs, uploadFile } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

const PRODUCT_ORDER = [
  'vip_month',
  'vip_quarter',
  'vip_year',
  'points_20',
  'points_66',
  'points_170',
];

/** IconPark 套餐图（npm run icons:gen → static/pricing）作默认道具图 */
const DEFAULT_PROP_ICONS = {
  vip_month: '/static/pricing/month.png',
  vip_quarter: '/static/pricing/quarter.png',
  vip_year: '/static/pricing/year.png',
  points_20: '/static/pricing/points.png',
  points_66: '/static/pricing/points2.png',
  points_170: '/static/pricing/points3.png',
};

const PLAN_META = {
  vip_month: { tone: 'month', shortTitle: '包月', iconSrc: '/static/pricing/month.png' },
  vip_quarter: { tone: 'quarter', shortTitle: '季卡', iconSrc: '/static/pricing/quarter.png' },
  vip_year: { tone: 'year', shortTitle: '年卡', iconSrc: '/static/pricing/year.png' },
  points_20: { tone: 'points', shortTitle: '', iconSrc: '/static/pricing/points.png' },
  points_66: { tone: 'points2', shortTitle: '', iconSrc: '/static/pricing/points2.png' },
  points_170: { tone: 'points3', shortTitle: '', iconSrc: '/static/pricing/points3.png' },
};

const MONTHLY_QUOTA = 36;
const ANIM_COST = 2;
const STATIC_COST = 1;

function formatYuan(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

function buildDisplay(item) {
  const slotId = item.slotId || item.productId;
  const meta = PLAN_META[slotId] || { tone: 'month', shortTitle: item.title, iconSrc: '' };
  const isPoints = item.type === 'points' || String(slotId).startsWith('points');
  const value = Math.max(0, Number(item.value) || 0);
  const yuan = Number(item.priceYuan);
  const yuanSafe = Number.isNaN(yuan) ? 0 : yuan;
  let displayTitle = meta.shortTitle || item.title || slotId;
  let period = '';
  let desc = '';
  if (isPoints) {
    displayTitle = `${value} 积分`;
    period = `共 ${value} 积分`;
    desc = `约 ${Math.floor(value / ANIM_COST)} 张动态 / ${Math.floor(value / STATIC_COST)} 张静态`;
  } else {
    period = `${value || 0} 天`;
    if (meta.tone === 'month') {
      desc = `每月 ${MONTHLY_QUOTA} 积分 · 约 ${Math.floor(MONTHLY_QUOTA / ANIM_COST)} 张动态`;
    } else if (meta.tone === 'quarter') {
      desc = `每月仍 ${MONTHLY_QUOTA} 积分 · 约合 ¥${formatYuan(yuanSafe / 3)}/月`;
    } else {
      desc = `每月仍 ${MONTHLY_QUOTA} 积分 · 约合 ¥${formatYuan(yuanSafe / 12)}/月`;
    }
  }
  const thumbSrc = item.previewUrl || meta.iconSrc || DEFAULT_PROP_ICONS[slotId] || '';
  const wxStatus = item.wxStatus || 'ok';
  const liveFen = Number(item.livePriceFen);
  const liveYuan = Number.isNaN(liveFen) ? yuanSafe : liveFen / 100;
  const wxProductId = item.wxProductId || item.liveProductId || '';
  return {
    ...item,
    slotId,
    tone: meta.tone,
    iconSrc: meta.iconSrc,
    thumbSrc,
    displayTitle,
    period,
    desc,
    displayPrice: `¥${formatYuan(liveYuan)}`,
    wxProductId,
    wxStatus,
  };
}

function splitItems(items) {
  const list = items || [];
  return {
    items: list,
    vipItems: list.filter((it) => it.type === 'vip_days'),
    pointItems: list.filter((it) => it.type === 'points'),
    missingIconCount: list.filter((it) => !it.itemFileId).length,
  };
}

const PROP_ICON_PX = 200;

function copyPackageToUserPath(srcPath, destName) {
  const fs = wx.getFileSystemManager();
  const dest = `${wx.env.USER_DATA_PATH}/${destName}`;
  return new Promise((resolve, reject) => {
    fs.copyFile({
      srcPath,
      destPath: dest,
      success: () => resolve(dest),
      fail: (err) => reject(err || new Error(`复制失败 ${srcPath}`)),
    });
  });
}

/** 微信道具图必须正好 200×200 */
function resizeImageToPropIcon(srcPath) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = wx.createOffscreenCanvas({
        type: '2d',
        width: PROP_ICON_PX,
        height: PROP_ICON_PX,
      });
      const ctx = canvas.getContext('2d');
      const img = canvas.createImage();
      img.onload = () => {
        try {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, PROP_ICON_PX, PROP_ICON_PX);
          ctx.drawImage(img, 0, 0, PROP_ICON_PX, PROP_ICON_PX);
          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const dest = `${wx.env.USER_DATA_PATH}/prop200_${Date.now()}.png`;
          wx.getFileSystemManager().writeFile({
            filePath: dest,
            data: base64,
            encoding: 'base64',
            success: () => resolve(dest),
            fail: (err) => reject(err || new Error('写入 200 图失败')),
          });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('读取图片失败'));
      img.src = srcPath;
    } catch (e) {
      reject(e || new Error('当前基础库不支持离屏画布，请升级微信'));
    }
  });
}

async function uploadDefaultPropIcon(productId) {
  const src = DEFAULT_PROP_ICONS[productId];
  if (!src) throw new Error(`无默认图标 ${productId}`);
  const copied = await copyPackageToUserPath(src, `prop_${productId}.png`);
  const local = await resizeImageToPropIcon(copied);
  const cloudPath = `pricing/default_${productId}_${PROP_ICON_PX}.png`;
  return uploadFile(cloudPath, local);
}

function wxMeta(wx) {
  const status = (wx && wx.status) || 'ok';
  if (status === 'syncing') return { wxStatus: 'syncing', wxLabel: '新道具上传中' };
  if (status === 'ready') return { wxStatus: 'ready', wxLabel: '可确认切换' };
  if (status === 'fail') return { wxStatus: 'fail', wxLabel: '上传失败' };
  if (status === 'await_mp') return { wxStatus: 'await_mp', wxLabel: '待处理' };
  return { wxStatus: 'ok', wxLabel: '' };
}

function fenToYuanStr(fen) {
  const y = Number(fen || 0) / 100;
  if (Number.isNaN(y)) return '';
  return Number.isInteger(y) ? String(y) : String(Math.round(y * 100) / 100);
}

function yuanToFen(yuan) {
  const n = Number(yuan);
  if (Number.isNaN(n) || n <= 0) return NaN;
  return Math.round(n * 100);
}

Page({
  data: {
    themeStyle: '',
    loading: true,
    saving: false,
    fillingIcons: false,
    retryingId: '',
    payEnvLabel: '',
    missingIconCount: 0,
    items: [],
    vipItems: [],
    pointItems: [],
  },

  _pollTimer: null,

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    if (!guardAdminPage()) return;
    applyThemeToPage(this);
    this.load();
  },

  onHide() {
    this.clearPoll();
  },

  onUnload() {
    this.clearPoll();
  },

  clearPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  mapItems(products) {
    const bySlot = {};
    (products || []).forEach((p) => {
      if (!p) return;
      const slot = p.slotId || (PRODUCT_ORDER.includes(p.productId) ? p.productId : '');
      if (slot) bySlot[slot] = p;
    });
    return PRODUCT_ORDER.map((slotId) => {
      const p =
        bySlot[slotId] || {
          slotId,
          productId: slotId,
          type: slotId.startsWith('points') ? 'points' : 'vip_days',
        };
      const meta = wxMeta(p.wx);
      const draft = p.draft;
      let draftText = '';
      let syncHint = '';
      if (draft) {
        const newId = draft.productId || '';
        draftText = `新道具 ${newId || '…'} · ¥${fenToYuanStr(draft.priceFen)}`;
        if (meta.wxStatus === 'syncing') {
          syncHint =
            (p.wx && p.wx.error) ||
            '正在排队/上传新 ID（微信同时只能一个任务）。完成后可确认切换。旧道具无删除 API，可 MP 下架或留着。';
        } else if (meta.wxStatus === 'ready') {
          syncHint = '新道具已发布。点「确认切换」后支付用新 ID。旧 ID 微信不能 API 删除，MP 可下架。';
        } else if (meta.wxStatus === 'fail') {
          syncHint =
            '失败常见原因：①图非 200×200（先重置默认图）②频率限制/任务占用（等 1–2 分钟再重试）。';
        } else {
          syncHint = '有待切换的新道具价。';
        }
      }
      const editTitle = draft ? draft.title : p.title || slotId;
      const editPriceFen = draft ? draft.priceFen : p.priceFen;
      const editValue = draft ? draft.value : p.value;
      return buildDisplay({
        slotId,
        productId: slotId,
        wxProductId: p.productId || slotId,
        title: editTitle,
        priceYuan: fenToYuanStr(editPriceFen),
        value: String(editValue != null ? editValue : ''),
        type: p.type || (slotId.startsWith('points') ? 'points' : 'vip_days'),
        itemFileId: p.itemFileId || '',
        previewUrl: p._previewUrl || '',
        wxStatus: meta.wxStatus,
        wxLabel: meta.wxLabel,
        wxError: (p.wx && p.wx.status === 'fail' && p.wx.error) || '',
        draftText,
        syncHint,
        showSyncBox: !!draft,
        canRetry: meta.wxStatus === 'fail',
        canConfirm: !!(draft && meta.wxStatus === 'ready'),
        canCancel: !!draft,
        livePriceFen: Number(p.priceFen) || 0,
        liveTitle: p.title || '',
        liveValue: Number(p.value) || 0,
      });
    });
  },

  applyItems(items) {
    this.setData(splitItems(items));
  },

  async hydratePreviews(products) {
    const ids = (products || []).map((p) => p.itemFileId).filter(Boolean);
    if (!ids.length) return products;
    try {
      const urls = await getTempFileURLs(ids);
      const map = {};
      ids.forEach((id, i) => {
        map[id] = urls[i] || '';
      });
      return (products || []).map((p) => ({
        ...p,
        _previewUrl: p.itemFileId ? map[p.itemFileId] || '' : '',
      }));
    } catch (e) {
      return products;
    }
  },

  async load() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('adminManagePricing', { action: 'get' });
      const products = await this.hydratePreviews(res.products || []);
      const items = this.mapItems(products);
      this.setData({ payEnvLabel: Number(res.payEnv) === 1 ? '沙箱' : '现网' });
      this.applyItems(items);
      this.maybeStartPoll(products);
      if (items.some((it) => !it.itemFileId)) {
        await this.fillDefaultIcons({ silent: true, onlyMissing: true });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  maybeStartPoll(products) {
    const syncing = (products || []).some(
      (p) => p.wx && (p.wx.status === 'syncing' || p.wx.status === 'ready'),
    );
    this.clearPoll();
    if (!syncing) return;
    this._pollTimer = setInterval(() => {
      this.pollStatus();
    }, 12000);
  },

  async pollStatus() {
    try {
      const res = await callFunction('adminManagePricing', { action: 'syncStatus' });
      const products = await this.hydratePreviews(res.products || []);
      this.applyItems(this.mapItems(products));
      if (!res.stillSyncing) this.clearPoll();
      else this.maybeStartPoll(products);
    } catch (e) {
      console.warn('syncStatus', e && e.message);
    }
  },

  /**
   * 把 static/pricing 的 IconPark 图上传到云存储并写入定价配置
   * @param {{ silent?: boolean, onlyMissing?: boolean }} opts
   */
  async fillDefaultIcons(opts = {}) {
    const silent = !!opts.silent;
    const onlyMissing = opts.onlyMissing !== false;
    if (this.data.fillingIcons || this.data.saving) return;
    const targets = (this.data.items || []).filter((it) => {
      const slot = it.slotId || it.productId;
      if (!DEFAULT_PROP_ICONS[slot]) return false;
      return onlyMissing ? !it.itemFileId : true;
    });
    if (!targets.length) {
      if (!silent) wx.showToast({ title: '道具图已齐全', icon: 'none' });
      return;
    }
    this.setData({ fillingIcons: true });
    if (!silent) wx.showLoading({ title: '填充默认图', mask: true });
    try {
      const idToFile = {};
      for (const it of targets) {
        const slot = it.slotId || it.productId;
        // eslint-disable-next-line no-await-in-loop
        idToFile[slot] = await uploadDefaultPropIcon(slot);
      }
      const products = (this.data.items || []).map((it) => {
        const slot = it.slotId || it.productId;
        return {
          slotId: slot,
          productId: slot,
          title: String(it.title || '').trim(),
          value: Number(it.value) || 1,
          priceFen: it.livePriceFen || yuanToFen(it.priceYuan) || 100,
          itemFileId: idToFile[slot] || it.itemFileId || '',
        };
      });
      const res = await callFunction('adminManagePricing', { action: 'set', products });
      const next = await this.hydratePreviews(res.products || []);
      this.applyItems(this.mapItems(next));
      if (!silent) {
        wx.showToast({ title: '已填充默认道具图', icon: 'success' });
      }
    } catch (e) {
      if (!silent) {
        wx.showToast({ title: (e && e.message) || '填充失败', icon: 'none' });
      } else {
        console.warn('fillDefaultIcons', e && e.message);
      }
    } finally {
      if (!silent) wx.hideLoading();
      this.setData({ fillingIcons: false });
    }
  },

  onFillDefaultIcons() {
    this.fillDefaultIcons({ silent: false, onlyMissing: false });
  },

  onFieldChange(e) {
    const id = e.currentTarget.dataset.id;
    const field = e.currentTarget.dataset.field;
    const value = (e.detail && e.detail.value) != null ? e.detail.value : '';
    const items = (this.data.items || []).map((it) => {
      if ((it.slotId || it.productId) !== id) return it;
      return buildDisplay({ ...it, [field]: value });
    });
    this.applyItems(items);
  },

  onPickPropImage(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: async (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || {};
        const local = file.tempFilePath || '';
        if (!local) return;
        wx.showLoading({ title: '上传中', mask: true });
        try {
          const resized = await resizeImageToPropIcon(local);
          const cloudPath = `pricing/${id}_${Date.now()}.png`;
          const fileID = await uploadFile(cloudPath, resized);
          const urls = await getTempFileURLs([fileID]);
          const preview = urls[0] || local;
          const items = (this.data.items || []).map((it) => {
            if ((it.slotId || it.productId) !== id) return it;
            return buildDisplay({
              ...it,
              itemFileId: fileID,
              previewUrl: preview,
            });
          });
          this.applyItems(items);
          // 只落库道具图，不触发改价同步
          // 只更新图：价格用 live，避免误触发新道具 ID
          const products = items.map((it) => ({
            slotId: it.slotId || it.productId,
            productId: it.slotId || it.productId,
            title: String(it.title || '').trim(),
            value: Number(it.value) || 1,
            priceFen: it.livePriceFen || yuanToFen(it.priceYuan) || 100,
            itemFileId: it.itemFileId || '',
          }));
          const saved = await callFunction('adminManagePricing', { action: 'set', products });
          const next = await this.hydratePreviews(saved.products || []);
          this.applyItems(this.mapItems(next));
          this.maybeStartPoll(next);
          wx.showToast({ title: '已替换', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '上传失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },


  async onSave() {
    if (this.data.saving) return;
    const products = [];
    for (const it of this.data.items || []) {
      const priceFen = yuanToFen(it.priceYuan);
      const value = Number(it.value);
      if (Number.isNaN(priceFen) || priceFen < 1) {
        wx.showToast({ title: `${it.productId} 售价无效`, icon: 'none' });
        return;
      }
      if (Number.isNaN(value) || value < 1) {
        wx.showToast({ title: `${it.productId} 权益无效`, icon: 'none' });
        return;
      }
      products.push({
        slotId: it.slotId || it.productId,
        productId: it.slotId || it.productId,
        title: String(it.title || '').trim(),
        value,
        priceFen,
        itemFileId: it.itemFileId || '',
      });
    }

    this.setData({ saving: true });
    try {
      const res = await callFunction('adminManagePricing', { action: 'set', products });
      const next = await this.hydratePreviews(res.products || []);
      this.applyItems(this.mapItems(next));
      this.maybeStartPoll(next);
      wx.showToast({
        title: (res && res.message) || '已保存',
        icon: 'none',
        duration: 3500,
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async onRetry(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.retryingId) return;
    this.setData({ retryingId: id });
    try {
      const res = await callFunction('adminManagePricing', {
        action: 'retrySync',
        slotId: id,
        productId: id,
      });
      const next = await this.hydratePreviews(res.products || []);
      this.applyItems(this.mapItems(next));
      this.maybeStartPoll(next);
      wx.showToast({ title: (res && res.message) || '已重试', icon: 'none', duration: 2500 });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '重试失败', icon: 'none' });
    } finally {
      this.setData({ retryingId: '' });
    }
  },

  async onConfirmLive(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.retryingId) return;
    const it = (this.data.items || []).find((x) => (x.slotId || x.productId) === id);
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '确认切换到新道具？',
        content: it && it.draftText
          ? `将支付切到 ${it.draftText}。请确认微信道具管理里已出现新 ID。旧 ID 可稍后在 MP 下架。`
          : '将支付切到新道具 ID。请确认微信侧已发布成功。',
        confirmText: '确认切换',
        success: (r) => resolve(!!r.confirm),
      });
    });
    if (!ok) return;
    this.setData({ retryingId: id });
    try {
      const res = await callFunction('adminManagePricing', {
        action: 'confirmLive',
        slotId: id,
        productId: id,
      });
      const next = await this.hydratePreviews(res.products || []);
      this.applyItems(this.mapItems(next));
      this.clearPoll();
      wx.showToast({ title: (res && res.message) || '已切换', icon: 'none', duration: 3000 });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '切换失败', icon: 'none' });
    } finally {
      this.setData({ retryingId: '' });
    }
  },

  async onCancelDraft(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.retryingId) return;
    this.setData({ retryingId: id });
    try {
      const res = await callFunction('adminManagePricing', {
        action: 'cancelDraft',
        slotId: id,
        productId: id,
      });
      const next = await this.hydratePreviews(res.products || []);
      this.applyItems(this.mapItems(next));
      this.clearPoll();
      wx.showToast({ title: (res && res.message) || '已放弃', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      this.setData({ retryingId: '' });
    }
  },

  async onForceLive(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.retryingId) return;
    const it = (this.data.items || []).find((x) => (x.slotId || x.productId) === id);
    if (!it) return;
    const priceFen = yuanToFen(it.priceYuan);
    if (Number.isNaN(priceFen) || priceFen < 1) {
      wx.showToast({ title: '售价无效', icon: 'none' });
      return;
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '对齐支付现网价',
        content: `立即把小程序支付价改为 ¥${it.priceYuan}（须等于微信道具管理里的价，如网页仍是 10 就填 10）。不会改微信后台。`,
        confirmText: '对齐',
        confirmColor: '#d54941',
        success: (r) => resolve(!!r.confirm),
      });
    });
    if (!ok) return;
    this.setData({ retryingId: id });
    try {
      const res = await callFunction('adminManagePricing', {
        action: 'forceLive',
        slotId: id,
        productId: id,
        priceFen,
        title: it.title,
        value: Number(it.value) || 1,
      });
      const next = await this.hydratePreviews(res.products || []);
      this.applyItems(this.mapItems(next));
      wx.showToast({ title: (res && res.message) || '已对齐', icon: 'none', duration: 2500 });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    } finally {
      this.setData({ retryingId: '' });
    }
  },
});
