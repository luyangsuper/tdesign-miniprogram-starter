import { callFunction, uploadFile } from '~/utils/cloud';
import { getFileName, pairPreviewStaticAnim } from '~/utils/pairFiles';
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
        loadingPack: false,
      });
      wx.hideLoading();
    } catch (e) {
      this.setData({ loadingPack: false });
      wx.hideLoading();
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
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
    this.setData({ coverFiles: files });
    const src =
      (files[0] && (files[0].url || files[0].path || files[0].tempFilePath)) || '';
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
  },
  onCoverRemove() {
    this.setData({ coverFiles: [], coverWidth: 0, coverHeight: 0 });
  },

  nextFileUid() {
    this._fileUid = (this._fileUid || 0) + 1;
    return `f_${Date.now()}_${this._fileUid}`;
  },

  /** 从左到右自动标 1、2、3…；相册图不展示无用文件名 */
  withAutoSeq(list = []) {
    return (list || []).map((f, i) => {
      const name = f.name || '';
      const usefulName =
        !f.byAlbum &&
        /(?:preview|video|emoji|real|resource|origin|wallpaper|static|anim|dynamic)[_-]\d/i.test(
          name,
        );
      return {
        ...f,
        _uid: f._uid || this.nextFileUid(),
        manualSeq: String(i + 1),
        seqLabel: String(i + 1),
        showName: usefulName,
      };
    });
  },

  /** 编辑回填：保留服务端槽位序号（动态可能稀疏） */
  withPreservedSeq(list = []) {
    return (list || []).map((f, i) => {
      const seq = String(f.manualSeq || f.seqLabel || i + 1);
      return {
        ...f,
        _uid: f._uid || this.nextFileUid(),
        manualSeq: seq,
        seqLabel: seq,
        showName: false,
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

  /** 相册/本地：适合小 GIF；靠拖动排序自动对应序号 */
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

  /** 点击缩略图预览大图，便于核对配对 */
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

    const paired = pairPreviewStaticAnim(previewFiles, emojiFiles, emojiAnimFiles);
    if (!paired.pairs.length) {
      wx.showToast({ title: '未能配对预览与静态原图，请检查序号', icon: 'none' });
      return;
    }

    const hardWarn =
      paired.unmatchedPreview.length + paired.unmatchedStatic.length;
    const animWarn = paired.unmatchedAnim.length;

    if (hardWarn || animWarn) {
      const parts = [];
      if (hardWarn) {
        parts.push(
          `已配对 ${paired.pairs.length} 组预览+静态，还有 ${hardWarn} 个无法对应`,
        );
      } else {
        parts.push(`已配对 ${paired.pairs.length} 组预览+静态`);
      }
      if (animWarn) {
        parts.push(`${animWarn} 张动态未挂上（可忽略）`);
      }
      parts.push('是否只发布已配对的？');
      wx.showModal({
        title: '配对不完整',
        content: parts.join('。\n'),
        confirmText: '只发已配对',
        cancelText: '去修改',
        success: (res) => {
          if (res.confirm) this.doSubmit(paired);
        },
      });
      return;
    }

    this.doSubmit(paired);
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
    } = this.data;
    const wasEdit = isEdit;

    this.setData({ submitting: true });
    wx.showLoading({ title: isEdit ? '保存中...' : '上传中...', mask: true });

    try {
      const animFilesToUpload = (paired.orderedAnims || []).filter(Boolean);
      const [coverIds, previewFileIDs, emojiFileIDs, animUploadedIds] =
        await Promise.all([
          this.resolveFileIds(coverFiles, 'cover'),
          this.resolveFileIds(paired.orderedPreviews, 'preview'),
          this.resolveFileIds(paired.orderedStatics || paired.orderedEmojis, 'emoji'),
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
      if ((!w || !h) && coverFiles[0]) {
        const src = this.pickLocalPath(coverFiles[0]);
        if (src) {
          const info = await new Promise((resolve) => {
            wx.getImageInfo({
              src,
              success: resolve,
              fail: () => resolve(null),
            });
          });
          if (info) {
            w = info.width || 0;
            h = info.height || 0;
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

      if (wasEdit) {
        await callFunction('adminUpdatePack', { ...payload, packId });
      } else {
        const created = await callFunction('adminCreatePack', payload);
        const newId = created && created.data && created.data._id;
        if (newId) {
          this.setData({ packId: newId, isEdit: true });
          wx.setClipboardData({ data: newId });
          // 新发布：推送给已订阅用户（失败不影响发布）
          try {
            const cat = (this.data.categories || []).find(
              (c) => c.id === categoryId,
            );
            const notify = await callFunction('notifyNewPack', {
              packId: newId,
              title: payload.title,
              categoryName: (cat && cat.name) || '',
              description: payload.description,
              emojiCount: (payload.emojiFileIDs || []).length,
            });
            const sent = (notify.data && notify.data.sent) || 0;
            if (sent > 0) {
              console.log('[notifyNewPack] sent', sent);
            }
          } catch (notifyErr) {
            console.warn('[notifyNewPack]', notifyErr.message || notifyErr);
          }
        }
      }

      try {
        getApp().globalData.homeNeedRefresh = true;
      } catch (e) {
        /* ignore */
      }

      wx.hideLoading();
      wx.showToast({
        title: wasEdit ? '已保存' : '已发布，作品 ID 已复制',
        icon: 'success',
        duration: 2000,
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
