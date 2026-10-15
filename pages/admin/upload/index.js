import { callFunction, uploadFile } from '~/utils/cloud';
import { getSubscribeMpState } from '~/utils/subscribe';
import { getFileName, pairByIndex } from '../utils/pairFiles';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

const gridConfig = { column: 4, width: 160, height: 160 };

Page({
  data: {
    packId: '',
    isEdit: false,
    title: '',
    description: '',
    staticDriveUrl: '',
    animDriveUrl: '',
    coverFiles: [],
    coverWidth: 0,
    coverHeight: 0,
    previewFiles: [],
    emojiFiles: [],
    emojiAnimFiles: [],
    gridConfig,
    submitting: false,
    categories: [],
    categoryId: '',
    loadingCats: true,
    loadingPack: false,
    autosize: { minHeight: 72, maxHeight: 240 },
    dragField: '',
    dragFrom: -1,
    dragOver: -1,
    /** 拖起项跟手位移，仅绑在当前拖动格子上 */
    dragFloatStyle: '',
    viewerVisible: false,
    viewerImages: [],
    viewerIndex: 0,
    viewerImageProps: {
      mode: 'aspectFit',
      lazy: true,
    },
    themeStyle: '',
    /** 本次保存后是否推送订阅消息；默认关，排好序再开 */
    notifySubscribers: false,
    packNotifiedAt: 0,
    notifyHint: '排好序、内容定稿后再开；关闭则只上架不推送',
    generatingCopy: false,
    pingingProxy: false,
    /** 默认关：不生成公众号长文，省 token */
    aiIncludeArticle: false,
    aiDialogVisible: false,
    aiTitle: '',
    aiDescription: '',
    aiArticle: '',
  },

  onLoad(options) {
    const packId = options.id || '';
    this.setData({ themeStyle: getThemeStyle() });
    if (packId) {
      this.setData({ packId, isEdit: true });
      wx.setNavigationBarTitle({ title: '编辑合集' });
      this.loadPack(packId);
    }
    this.loadCategories();
  },

  onShow() {
    applyThemeToPage(this);
  },

  async loadCategories() {
    this.setData({ loadingCats: true });
    try {
      const res = await callFunction('listCategories');
      const categories = (res.data && res.data.categories) || [];
      const patch = { categories, loadingCats: false };
      if (!this.data.categoryId && categories[0]) {
        patch.categoryId = categories[0].id;
      }
      this.setData(patch);
    } catch (e) {
      this.setData({ loadingCats: false });
      wx.showToast({ title: e.message || '分类加载失败', icon: 'none' });
    }
  },

  async loadPack(packId) {
    this.setData({ loadingPack: true });
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const res = await callFunction('adminGetPack', { packId });
      const pack = res.data || {};
      const packNotifiedAt = (() => {
        const raw = pack.notifiedAt;
        if (!raw) return 0;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        const ms = new Date(raw).getTime();
        return Number.isFinite(ms) ? ms : 0;
      })();
      this.setData({
        title: pack.title || '',
        description: pack.description || '',
        staticDriveUrl: pack.staticDriveUrl || '',
        animDriveUrl: pack.animDriveUrl || '',
        categoryId: pack.categoryId || '',
        coverFiles: pack.coverFiles || [],
        coverWidth: pack.coverWidth || 0,
        coverHeight: pack.coverHeight || 0,
        previewFiles: this.withAutoSeq(pack.previewFiles || []),
        emojiFiles: this.withAutoSeq(pack.emojiFiles || []),
        emojiAnimFiles: this.withPreservedSeq(pack.emojiAnimFiles || []),
        notifySubscribers: false,
        packNotifiedAt,
        notifyHint: this.buildNotifyHint(packNotifiedAt),
        loadingPack: false,
      });
      wx.hideLoading();
    } catch (e) {
      this.setData({ loadingPack: false });
      wx.hideLoading();
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  buildNotifyHint(notifiedAt) {
    if (notifiedAt) {
      return '该合集已通知过；再开开会再推一次给仍有额度的用户';
    }
    return '排好序、内容定稿后再开；关闭则只上架不推送';
  },

  onNotifyChange(e) {
    const on = !!(e.detail && e.detail.value);
    this.setData({ notifySubscribers: on });
  },

  onAiIncludeArticleChange(e) {
    const on = !!(e.detail && e.detail.value);
    this.setData({ aiIncludeArticle: on });
  },

  onTitleChange(e) {
    this.setData({ title: (e.detail && e.detail.value) || '' });
  },

  onDescChange(e) {
    this.setData({ description: (e.detail && e.detail.value) || '' });
  },

  onStaticDriveChange(e) {
    this.setData({ staticDriveUrl: (e.detail && e.detail.value) || '' });
  },

  onAnimDriveChange(e) {
    this.setData({ animDriveUrl: (e.detail && e.detail.value) || '' });
  },

  onCopyPackId() {
    const { packId } = this.data;
    if (!packId) return;
    wx.setClipboardData({
      data: packId,
      success: () => wx.showToast({ title: '已复制作品 ID', icon: 'success' }),
    });
  },

  onCategoryTap(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id);
    if (id) this.setData({ categoryId: id });
  },

  onCoverSuccess(e) {
    const files = e.detail.files.slice(0, 1);
    if (!files.length) {
      this.setData({ coverFiles: [] });
      return;
    }
    this.compressOneCover(files[0]).then((file) => {
      this.setData({ coverFiles: [file] });
      const src = file.url || file.path || file.tempFilePath || '';
      if (!src) return;
      wx.getImageInfo({
        src,
        success: (info) => {
          this.setData({
            coverWidth: info.width || 0,
            coverHeight: info.height || 0,
          });
        },
      });
    });
  },

  /** 封面压到长边约 900，减小首页列表流量（GIF 跳过） */
  compressOneCover(file) {
    const src = file.path || file.url || file.tempFilePath;
    const size = Number(file.size) || 0;
    const name = `${file.name || ''} ${src}`.toLowerCase();
    if (
      !src ||
      String(src).startsWith('cloud://') ||
      name.includes('.gif') ||
      (size > 0 && size < 180 * 1024)
    ) {
      return Promise.resolve(file);
    }
    return new Promise((resolve) => {
      wx.compressImage({
        src,
        quality: 70,
        compressedWidth: 900,
        success: (res) => {
          const path = res.tempFilePath || src;
          resolve({ ...file, url: path, path, size: 0 });
        },
        fail: () => resolve(file),
      });
    });
  },
  onCoverRemove() {
    this.setData({ coverFiles: [], coverWidth: 0, coverHeight: 0 });
  },

  /** 封面上传到云存储（已有 cloud:// / fileID 则复用） */
  async ensureCoverFileID() {
    const file = (this.data.coverFiles || [])[0];
    if (!file) return '';
    if (file.fileID && String(file.fileID).startsWith('cloud://')) {
      return file.fileID;
    }
    const local = this.pickLocalPath(file);
    if (String(local).startsWith('cloud://')) return local;
    if (!local) return '';
    const name = getFileName(file);
    const ext = (name.split('.').pop() || local.split('.').pop() || 'jpg')
      .split('?')[0]
      .toLowerCase();
    const cloudPath = `packs/cover_ai/${Date.now()}.${ext || 'jpg'}`;
    const fileID = await uploadFile(cloudPath, local);
    // 回写，避免重复上传
    const coverFiles = [{ ...file, fileID, url: fileID }];
    this.setData({ coverFiles });
    return fileID;
  },

  async onPingAiProxy() {
    if (this.data.pingingProxy || this.data.generatingCopy) return;
    this.setData({ pingingProxy: true });
    wx.showLoading({ title: '检测中', mask: true });
    try {
      const res = await callFunction('generatePackCopy', { action: 'ping' });
      const data = (res && res.data) || {};
      const ok = !!(data.apiOk || data.proxyOk);
      const tip = data.tip || (ok ? 'DeepSeek 正常' : 'DeepSeek 异常');
      wx.showModal({
        title: ok ? 'AI 连通正常' : 'AI 未就绪',
        content: `${tip}\n\nBASE: ${data.base || '-'}\nKeys: ${data.keyCount || 0}\n模型: ${(data.models || []).join(', ') || '-'}`,
        showCancel: false,
      });
    } catch (e) {
      wx.showModal({
        title: '检测失败',
        content: (e && e.message) || '无法检测',
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ pingingProxy: false });
    }
  },

  async onGenerateCopy() {
    if (this.data.generatingCopy || this.data.submitting) return;
    const { categoryId, categories } = this.data;
    const cat = (categories || []).find((c) => c.id === categoryId);
    const categoryName = (cat && cat.name) || '';
    if (!categoryName) {
      wx.showToast({ title: '请先选择主题分类', icon: 'none' });
      return;
    }
    if (!(this.data.coverFiles || []).length) {
      wx.showToast({ title: '请先上传封面', icon: 'none' });
      return;
    }
    this.setData({ generatingCopy: true });
    wx.showLoading({ title: 'AI 生成中', mask: true });
    try {
      const coverFileID = await this.ensureCoverFileID();
      if (!coverFileID) {
        throw new Error('封面无效，请重新选择');
      }
      const includeArticle = !!this.data.aiIncludeArticle;
      const res = await callFunction('generatePackCopy', {
        coverFileID,
        categoryName,
        categoryId: categoryId || '',
        includeArticle,
      });
      const data = (res && res.data) || {};
      const aiTitle = String(data.title || '').trim();
      const aiDescription = String(data.description || '').trim();
      const aiArticle = includeArticle ? String(data.article || '').trim() : '';
      if (!aiTitle && !aiDescription) {
        throw new Error('未生成有效文案');
      }
      this.setData({
        aiDialogVisible: true,
        aiTitle,
        aiDescription,
        aiArticle,
      });
    } catch (e) {
      const msg = (e && e.message) || '生成失败';
      wx.showModal({
        title: '生成失败',
        content: msg,
        showCancel: false,
      });
      console.warn('[generatePackCopy]', msg);
    } finally {
      wx.hideLoading();
      this.setData({ generatingCopy: false });
    }
  },

  onApplyAiCopy() {
    const { aiTitle, aiDescription } = this.data;
    const patch = { aiDialogVisible: false };
    if (aiTitle) patch.title = aiTitle.slice(0, 40);
    if (aiDescription) patch.description = aiDescription.slice(0, 800);
    this.setData(patch);
    wx.showToast({ title: '已填入标题与简介', icon: 'success' });
  },

  onCloseAiDialog() {
    this.setData({ aiDialogVisible: false });
  },

  onCopyAiArticle() {
    const text = this.data.aiArticle || '';
    if (!text) {
      wx.showToast({ title: '暂无文案', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制公众号文案', icon: 'success' }),
    });
  },

  nextFileUid() {
    this._fileUid = (this._fileUid || 0) + 1;
    return `f_${Date.now()}_${this._fileUid}`;
  },

  /** 从左到右标 1、2、3…，与同下标静态/动态对齐 */
  withAutoSeq(list = []) {
    return (list || []).map((f, i) => ({
      ...f,
      _uid: f._uid || this.nextFileUid(),
      seqLabel: String(i + 1),
    }));
  },

  /** 编辑回填：保留服务端槽位序号（动态可能稀疏） */
  withPreservedSeq(list = []) {
    return (list || []).map((f, i) => {
      const seq = String(f.seqLabel || f.manualSeq || i + 1);
      return {
        ...f,
        _uid: f._uid || this.nextFileUid(),
        seqLabel: seq,
      };
    });
  },

  setFileList(field, list, toast) {
    this.setData({ [field]: this.withAutoSeq(list) }, () => {
      if (toast) wx.showToast(toast);
    });
  },

  measureGridRects(field) {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .in(this)
        .selectAll(`.js-grid-${field} .file-grid__item`)
        .boundingClientRect((rects) => resolve(rects || []))
        .exec();
    });
  },

  /** 用冻结的格子矩形做命中，避免拖动中改列表导致来回跳 */
  hitTestIndex(x, y, rects, fallback) {
    if (!rects || !rects.length) return fallback;
    for (let i = 0; i < rects.length; i += 1) {
      const r = rects[i];
      if (!r) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }
    // 落在间隙时取最近中心，仍不改列表
    let best = fallback;
    let bestDist = Infinity;
    rects.forEach((r, i) => {
      if (!r) return;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  },

  compressOnePreview(file) {
    const src = file.path || file.url;
    const size = Number(file.size) || 0;
    const name = `${file.name || ''} ${src}`.toLowerCase();
    if (!src || name.includes('.gif') || (size > 0 && size < 280 * 1024)) {
      return Promise.resolve(file);
    }
    return new Promise((resolve) => {
      wx.compressImage({
        src,
        quality: 72,
        compressedWidth: 1200,
        success: (res) => {
          const path = res.tempFilePath || src;
          resolve({ ...file, url: path, path, size: 0 });
        },
        fail: () => resolve(file),
      });
    });
  },

  async compressPreviewPicks(items) {
    wx.showLoading({ title: '处理预览图', mask: true });
    try {
      const next = [];
      for (let i = 0; i < items.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        next.push(await this.compressOnePreview(items[i]));
      }
      return next;
    } finally {
      wx.hideLoading();
    }
  },

  appendPickedFiles(field, maxCount, items) {
    if (!items.length) {
      wx.showToast({ title: '请选择图片', icon: 'none' });
      return;
    }
    const merged = [...(this.data[field] || []), ...items].slice(0, maxCount);
    this.setFileList(field, merged, {
      title: `已添加 ${items.length} 张`,
      icon: 'success',
    });
  },

  /** 相册多选；靠拖动调整顺序后按下标对齐 */
  pickFilesByAlbum(maxCount, field) {
    const remain = Math.max(0, maxCount - (this.data[field] || []).length);
    if (!remain) {
      wx.showToast({ title: '已达数量上限', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: Math.min(remain, 20),
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: field === 'previewFiles' ? ['compressed'] : ['original'],
      success: (res) => {
        const picked = (res.tempFiles || []).map((f) => {
          const path = f.tempFilePath || f.path;
          return {
            url: path,
            path,
            name: '',
            type: 'image',
            size: f.size,
            byAlbum: true,
          };
        });
        if (field === 'previewFiles') {
          this.compressPreviewPicks(picked).then((next) => {
            this.appendPickedFiles(field, maxCount, next);
          });
          return;
        }
        this.appendPickedFiles(field, maxCount, picked);
      },
      fail: (err) => {
        if (err && /cancel/i.test(err.errMsg || '')) return;
        wx.showToast({ title: '选择失败', icon: 'none' });
      },
    });
  },

  pickPreviewFromAlbum() {
    this.pickFilesByAlbum(30, 'previewFiles');
  },

  pickEmojiFromAlbum() {
    this.pickFilesByAlbum(30, 'emojiFiles');
  },

  pickAnimFromAlbum() {
    this.pickFilesByAlbum(30, 'emojiAnimFiles');
  },

  onRemoveNamedFile(e) {
    const { index, field } = e.currentTarget.dataset;
    const list = [...(this.data[field] || [])];
    list.splice(Number(index), 1);
    this.setFileList(field, list);
  },

  /** 点击缩略图预览大图 */
  onPreviewGridImage(e) {
    if (this._drag && this._drag.field) return;
    const { field, index } = e.currentTarget.dataset;
    const list = this.data[field] || [];
    const urls = list
      .map((f) => f.url || f.path || f.tempFilePath || '')
      .filter(Boolean);
    if (!urls.length) return;
    const i = Number(index) || 0;
    this.setData({
      viewerVisible: true,
      viewerImages: urls,
      viewerIndex: i >= 0 && i < urls.length ? i : 0,
    });
  },

  onViewerClose() {
    this.setData({
      viewerVisible: false,
      viewerImages: [],
      viewerIndex: 0,
    });
  },

  onGridLongPress(e) {
    const { field, index } = e.currentTarget.dataset;
    const from = Number(index);
    const touch =
      (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null;
    this._drag = {
      field,
      from,
      over: from,
      startX: touch ? touch.clientX : 0,
      startY: touch ? touch.clientY : 0,
      ready: false,
    };
    this.setData({
      dragField: field,
      dragFrom: from,
      dragOver: from,
      dragFloatStyle: 'transform: scale(1.06);',
    });
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (err) {
      /* ignore */
    }
    this.measureGridRects(field).then((rects) => {
      if (!this._drag || this._drag.field !== field) return;
      this._dragRects = rects || [];
      this._drag.ready = true;
      // 若 longpress 没带坐标，用格子中心作起点
      if (!touch && this._dragRects[from]) {
        const r = this._dragRects[from];
        this._drag.startX = (r.left + r.right) / 2;
        this._drag.startY = (r.top + r.bottom) / 2;
      }
    });
  },

  onGridTouchMove(e) {
    if (!this._drag || !this._drag.field) return;
    const t = (e.touches && e.touches[0]) || null;
    if (!t) return;

    // 尚未量完格子时，先记下起点，避免第一下跳动
    if (!this._drag.ready) {
      if (!this._drag.startX && !this._drag.startY) {
        this._drag.startX = t.clientX;
        this._drag.startY = t.clientY;
      }
      return;
    }

    this._dragMoveEvent = t;
    if (this._dragRaf) return;
    this._dragRaf = true;
    setTimeout(() => {
      this._dragRaf = false;
      this.handleDragMove();
    }, 16);
  },

  handleDragMove() {
    if (!this._drag || !this._drag.field || !this._drag.ready) return;
    const t = this._dragMoveEvent;
    if (!t) return;

    const dx = t.clientX - this._drag.startX;
    const dy = t.clientY - this._drag.startY;
    const over = this.hitTestIndex(
      t.clientX,
      t.clientY,
      this._dragRects,
      this._drag.from,
    );

    const dragFloatStyle = `transform: translate(${dx}px, ${dy}px) scale(1.06);`;
    const patch = { dragFloatStyle };
    if (over !== this._drag.over) {
      this._drag.over = over;
      patch.dragOver = over;
    }
    this.setData(patch);
  },

  onGridTouchEnd() {
    if (!this._drag) return;
    const { field, from, over } = this._drag;
    this._drag = null;
    this._dragRects = null;
    this._dragMoveEvent = null;
    this._dragRaf = false;

    this.setData({
      dragField: '',
      dragFrom: -1,
      dragOver: -1,
      dragFloatStyle: '',
    });

    if (!field || from < 0 || over < 0 || from === over) return;
    const list = [...(this.data[field] || [])];
    if (from >= list.length || over >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(over, 0, item);
    this.setFileList(field, list);
  },


  pickLocalPath(file) {
    return file.url || file.path || file.tempFilePath || '';
  },

  async resolveFileIds(files, folder) {
    const stamp = Date.now();
    const ids = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (file.fileID) {
        ids.push(file.fileID);
        continue;
      }
      const local = this.pickLocalPath(file);
      if (!local || String(local).startsWith('cloud://')) {
        if (String(local).startsWith('cloud://')) ids.push(local);
        continue;
      }
      const name = getFileName(file);
      const ext = (name.split('.').pop() || local.split('.').pop() || 'png').split('?')[0];
      const safeBase = (name.replace(/\.[^.]+$/, '') || `file_${i}`).replace(/[^\w.-]/g, '_');
      const cloudPath = `packs/${folder}/${stamp}_${safeBase}.${ext}`;
      // eslint-disable-next-line no-await-in-loop
      const fileID = await uploadFile(cloudPath, local);
      ids.push(fileID);
    }
    return ids;
  },

  async onSubmit() {
    const {
      title,
      coverFiles,
      previewFiles,
      emojiFiles,
      emojiAnimFiles,
      submitting,
      categoryId,
    } = this.data;
    if (submitting) return;

    if (!title.trim()) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!categoryId) {
      wx.showToast({ title: '请选择分类', icon: 'none' });
      return;
    }
    if (!coverFiles.length) {
      wx.showToast({ title: '请上传封面', icon: 'none' });
      return;
    }
    if (!previewFiles.length) {
      wx.showToast({ title: '请上传预览图', icon: 'none' });
      return;
    }
    if (!emojiFiles.length) {
      wx.showToast({ title: '请上传静态原图', icon: 'none' });
      return;
    }

    if (previewFiles.length !== emojiFiles.length) {
      wx.showToast({
        title: `预览 ${previewFiles.length} 张、静态 ${emojiFiles.length} 张，数量需一致`,
        icon: 'none',
      });
      return;
    }

    const paired = pairByIndex(previewFiles, emojiFiles, emojiAnimFiles);
    if (!paired.pairs.length) {
      wx.showToast({ title: '请上传预览图与静态原图', icon: 'none' });
      return;
    }

    if (emojiAnimFiles.length && emojiAnimFiles.length !== previewFiles.length) {
      wx.showModal({
        title: '动态数量不一致',
        content: `动态 ${emojiAnimFiles.length} 张，预览/静态 ${previewFiles.length} 张。多出的动态会忽略，缺少的槽位为空。是否继续？`,
        confirmText: '继续',
        cancelText: '去修改',
        success: (res) => {
          if (res.confirm) this.doSubmit(paired);
        },
      });
      return;
    }

    this.doSubmit(paired);
  },

  async sendNewPackNotify(targetPackId, payload, categoryId) {
    const cat = (this.data.categories || []).find((c) => c.id === categoryId);
    const notify = await callFunction('notifyNewPack', {
      packId: targetPackId,
      title: payload.title,
      categoryName: (cat && cat.name) || '',
      description: payload.description,
      emojiCount: (payload.emojiFileIDs || []).length,
      miniprogramState: getSubscribeMpState(),
    });
    const sent = Number((notify.data && notify.data.sent) || 0);
    const skipped = Number((notify.data && notify.data.skipped) || 0);
    const total = Number((notify.data && notify.data.total) || 0);
    const lastError = (notify.data && notify.data.lastError) || '';
    // 仅真正送达后更新「已通知」标记，与云端 notifiedAt 一致
    if (sent > 0) {
      const now = Date.now();
      this.setData({
        notifySubscribers: false,
        packNotifiedAt: now,
        notifyHint: this.buildNotifyHint(now),
      });
    } else {
      this.setData({ notifySubscribers: false });
    }
    return { sent, skipped, total, lastError };
  },

  async doSubmit(paired) {
    const {
      packId,
      isEdit,
      title,
      description,
      staticDriveUrl,
      animDriveUrl,
      coverFiles,
      categoryId,
      coverWidth,
      coverHeight,
      notifySubscribers,
      packNotifiedAt,
    } = this.data;
    const wasEdit = isEdit;
    const shouldNotify = !!notifySubscribers;

    if (shouldNotify && packNotifiedAt) {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '再次通知？',
          content: '该合集已经通知过订阅用户。确认本次保存后再推送一次吗？',
          confirmText: '再通知',
          cancelText: '取消',
          success: (r) => resolve(!!r.confirm),
        });
      });
      if (!ok) return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: isEdit ? '保存中...' : '上传中...', mask: true });

    try {
      const animFilesToUpload = (paired.orderedAnims || []).filter(Boolean);
      const [coverIds, previewFileIDs, emojiFileIDs, animUploadedIds] =
        await Promise.all([
          this.resolveFileIds(coverFiles, 'cover'),
          this.resolveFileIds(paired.orderedPreviews, 'preview'),
          this.resolveFileIds(paired.orderedStatics, 'emoji'),
          this.resolveFileIds(animFilesToUpload, 'emoji-anim'),
        ]);

      // 与静态同序；无动态槽位填空串
      let animCursor = 0;
      const emojiAnimFileIDs = (paired.orderedAnims || []).map((f) => {
        if (!f) return '';
        const id = animUploadedIds[animCursor] || '';
        animCursor += 1;
        return id;
      });

      let w = Number(coverWidth) || 0;
      let h = Number(coverHeight) || 0;
      // 本地选图 / 云 fileID 都再量一次，保证首页瀑布流有 coverRatio
      if (!w || !h) {
        const candidates = [
          coverFiles[0] && this.pickLocalPath(coverFiles[0]),
          coverIds[0],
        ].filter(Boolean);
        for (let i = 0; i < candidates.length; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const info = await new Promise((resolve) => {
            wx.getImageInfo({
              src: candidates[i],
              success: resolve,
              fail: () => resolve(null),
            });
          });
          if (info && info.width && info.height) {
            w = info.width;
            h = info.height;
            break;
          }
        }
      }

      const payload = {
        title: title.trim(),
        description: (description || '').replace(/\r\n/g, '\n').trim(),
        staticDriveUrl: (staticDriveUrl || '').trim(),
        animDriveUrl: (animDriveUrl || '').trim(),
        categoryId,
        coverFileID: coverIds[0],
        coverWidth: w,
        coverHeight: h,
        previewFileIDs,
        emojiFileIDs,
        emojiAnimFileIDs,
        pairKeys: paired.pairKeys,
        status: 'published',
      };

      let savedPackId = packId;
      if (wasEdit) {
        await callFunction('adminUpdatePack', { ...payload, packId });
      } else {
        const created = await callFunction('adminCreatePack', payload);
        const newId = created && created.data && created.data._id;
        if (newId) {
          savedPackId = newId;
          this.setData({ packId: newId, isEdit: true });
          wx.setClipboardData({ data: newId });
        }
      }

      // 发布后立刻写入本地比例，首页 force 刷新时可先于图片 load 用上
      if (savedPackId && w > 0 && h > 0) {
        try {
          wx.setStorageSync(`coverRatio_${savedPackId}`, h / w);
        } catch (err) {
          /* ignore */
        }
        this.setData({ coverWidth: w, coverHeight: h });
      }

      let notifyTip = '';
      if (shouldNotify && savedPackId) {
        try {
          wx.showLoading({ title: '通知中...', mask: true });
          const { sent, skipped, total, lastError } = await this.sendNewPackNotify(
            savedPackId,
            payload,
            categoryId,
          );
          if (sent > 0) {
            notifyTip = `，已通知 ${sent} 人`;
          } else if (!total) {
            notifyTip = '，暂无订阅用户';
          } else if (String(lastError) === '43101') {
            console.warn('[notifyNewPack] all failed', { skipped, total, lastError });
            notifyTip = '，订阅已失效，请用户重新开启提醒';
          } else {
            console.warn('[notifyNewPack] all failed', { skipped, total, lastError });
            notifyTip = lastError
              ? `，通知未送达（${lastError}）`
              : `，通知未送达（${skipped} 人失败）`;
          }
        } catch (notifyErr) {
          console.warn('[notifyNewPack]', notifyErr.message || notifyErr);
          notifyTip = '，通知失败可稍后重试';
        }
      }

      try {
        getApp().globalData.homeNeedRefresh = true;
      } catch (e) {
        /* ignore */
      }

      wx.hideLoading();
      wx.showToast({
        title: `${wasEdit ? '已保存' : '已发布，作品 ID 已复制'}${notifyTip}`,
        icon: 'success',
        duration: 2200,
      });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/home/index' }),
        });
      }, 900);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
