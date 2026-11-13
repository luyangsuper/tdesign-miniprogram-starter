import { categoryTagStyle, metaTagStyle } from '~/utils/categories';
import {
  contentTypeColorStyle,
  contentTypeIconSrc,
  contentTypeLabel,
  formatItemCount,
  normalizeContentType,
} from '~/utils/contentType';
import { forgetTempUrl, packCoverCacheKey } from '~/utils/tempUrlCache';
import { getThemeBrand } from '~/utils/theme';

Component({
  options: {
    styleIsolation: 'shared',
  },
  properties: {
    packId: String,
    title: String,
    coverUrl: String,
    /** 云存储 fileID，裂图时供首页单独换签。允许短暂 null，内部当空串 */
    coverFileID: {
      type: null,
      value: '',
    },
    contentType: {
      type: String,
      value: 'emoji',
    },
    emojiCount: {
      type: Number,
      value: 0,
    },
    downloadCount: {
      type: Number,
      value: 0,
    },
    categoryId: {
      type: String,
      value: '',
    },
    categoryName: {
      type: String,
      value: '',
    },
    cardWidth: {
      type: Number,
      value: 0,
    },
    showAdmin: {
      type: Boolean,
      value: false,
    },
    /** 封面高/宽，用于瀑布流占位，避免图片加载后撑开 */
    coverRatio: {
      type: Number,
      value: 1,
    },
    /** 首页多选模式：点击切换选中，不进详情 */
    selectMode: {
      type: Boolean,
      value: false,
    },
    selected: {
      type: Boolean,
      value: false,
    },
    /** 多选时与已选类型不一致，半透明不可点选感 */
    selectDisabled: {
      type: Boolean,
      value: false,
    },
    /** 收藏等场景不展示「已下载」数量 */
    showDownloadCount: {
      type: Boolean,
      value: true,
    },
    /** 首页已筛主分类时可不显示封面上的类型角标，避免重复 */
    showTypeBadge: {
      type: Boolean,
      value: true,
    },
    /** navigate：压栈；redirect：详情推荐跳转，避免层层详情 */
    linkMode: {
      type: String,
      value: 'navigate',
    },
  },

  data: {
    tags: [],
    /** 张数 / 下载等灰字一行，避免窄卡双行色块标签 */
    metaLine: '',
    typeBadge: null,
    typeBadgeCompact: false,
    mediaHeight: 0,
    coverReady: false,
    brandColor: '#07C160',
    adminActionsVisible: false,
  },

  observers: {
    'selectMode, showAdmin': function (selectMode, showAdmin) {
      if ((selectMode || !showAdmin) && this.data.adminActionsVisible) {
        this.setData({ adminActionsVisible: false });
      }
    },
    'emojiCount, downloadCount, categoryId, categoryName, showDownloadCount, contentType, cardWidth, showTypeBadge':
      function () {
        this.refreshTags();
      },
    'cardWidth, coverRatio': function () {
      this.updateMediaHeight();
    },
    coverUrl(url) {
      // 仅 URL 真变时处理；同地址不重置，避免 lazy 不触发 load → 封面空白
      const next = url || '';
      if (next === this._coverUrl) return;
      this._coverUrl = next;
      // 有地址直接可见（骨架可由 t-image loading slot 短暂盖住）
      this.setData({ coverReady: !!next });
    },
  },

  lifetimes: {
    attached() {
      this._coverUrl = this.data.coverUrl || '';
      this.refreshTags();
      this.updateMediaHeight();
      this.setData({
        brandColor: getThemeBrand(),
        // 有封面则直接可见，避免瀑布流重排后一直透明
        coverReady: !!this.data.coverUrl,
      });
      this._onThemeChange = () => {
        this.refreshTags();
        this.setData({ brandColor: getThemeBrand() });
      };
      try {
        const app = getApp();
        if (app && app.eventBus) app.eventBus.on('themeChange', this._onThemeChange);
      } catch (e) {
        /* ignore */
      }
    },
    detached() {
      try {
        const app = getApp();
        if (app && app.eventBus && this._onThemeChange) {
          app.eventBus.off('themeChange', this._onThemeChange);
        }
      } catch (e) {
        /* ignore */
      }
    },
  },

  methods: {
    updateMediaHeight() {
      const w = Number(this.data.cardWidth) || 0;
      const ratio = Number(this.data.coverRatio) || 1;
      const safe = ratio > 0.2 && ratio < 4 ? ratio : 1;
      this.setData({
        mediaHeight: w ? Math.round(w * safe) : 0,
      });
    },

    refreshTags() {
      const {
        emojiCount,
        downloadCount,
        categoryId,
        categoryName,
        showDownloadCount,
        contentType,
        cardWidth,
        showTypeBadge,
      } = this.data;
      const type = normalizeContentType(contentType);
      const w = Number(cardWidth) || 0;
      /* 窄卡（约 3 列）/ 中卡（约 2 列）/ 宽卡（1 列或平板） */
      const narrow = !w || w < 150;
      const medium = w >= 150 && w < 210;

      const typeBadge = showTypeBadge
        ? {
            text: contentTypeLabel(type),
            iconSrc: contentTypeIconSrc(type),
            /* 仅文字色；半透明白底交给 less，保证封面可读 */
            customStyle: contentTypeColorStyle(type),
          }
        : null;
      const typeBadgeCompact = narrow;

      const tags = [];
      if (categoryName) {
        tags.push({
          text: categoryName,
          theme: 'default',
          customStyle: categoryTagStyle(categoryId, categoryName),
        });
      }

      const countText = emojiCount
        ? formatItemCount(emojiCount, type).replace(/\s/g, '')
        : '';
      const dlText =
        showDownloadCount && downloadCount ? `已下载${downloadCount}` : '';
      const metaParts = [];

      if (narrow || medium) {
        /* 类型在封面；信息区只留分类标签 + 灰字 meta，保证单行高度 */
        if (countText) metaParts.push(countText);
        if (dlText) metaParts.push(dlText);
      } else {
        /* 宽卡：分类 + 张数用标签；下载仍用灰字，避免再挤成两行 */
        if (countText) {
          tags.push({
            text: countText,
            theme: 'default',
            customStyle: metaTagStyle('count'),
          });
        }
        if (dlText) metaParts.push(dlText);
      }

      this.setData({
        typeBadge,
        typeBadgeCompact,
        tags,
        metaLine: metaParts.join(' · '),
      });
    },

    onCoverLoad(e) {
      if (!this.data.coverReady) {
        this.setData({ coverReady: true });
      }
      const detail = (e && e.detail) || {};
      const w = Number(detail.width) || 0;
      const h = Number(detail.height) || 0;
      if (!w || !h) return;
      const ratio = h / w;
      if (!(ratio > 0.2 && ratio < 4)) return;

      const { packId } = this.data;
      if (packId) {
        try {
          wx.setStorageSync(`coverRatio_${packId}`, ratio);
        } catch (err) {
          /* ignore */
        }
      }

      // 缺库内比例时首页会先用 1 占位；加载后按实测比例纠正高度，并通知列表回写
      const prev = Number(this.data.coverRatio) || 1;
      if (Math.abs(prev - ratio) < 0.02) return;
      const cardW = Number(this.data.cardWidth) || 0;
      this.setData({
        mediaHeight: cardW ? Math.round(cardW * ratio) : 0,
      });
      this.triggerEvent('ratiochange', { packId, coverRatio: ratio });
    },

    /** 临时链失效时丢掉本地缓存，让列表静默换签 */
    onCoverError() {
      const { packId, coverUrl } = this.data;
      const coverFileID = String(this.data.coverFileID || '');
      if (packId) forgetTempUrl(packCoverCacheKey(packId));
      if (coverFileID) forgetTempUrl(coverFileID);
      // 清掉当前坏链，避免同 URL 回写时 observer 不触发
      this._coverUrl = '';
      this.setData({ coverReady: false });
      this.triggerEvent('covererror', {
        packId,
        coverUrl,
        coverFileID,
      });
    },

    onTap() {
      const { packId, selectMode, linkMode } = this.data;
      if (!packId) return;
      if (selectMode) {
        // 类型不一致时仍上报，由首页 toast 提示「只能选同类型」
        this.triggerEvent('toggle', { packId });
        return;
      }
      const url = `/pages/pack/detail/index?id=${packId}`;
      if (linkMode === 'redirect') {
        wx.redirectTo({ url });
        return;
      }
      wx.navigateTo({ url });
    },

    onLongPress() {
      if (!this.data.showAdmin || this.data.selectMode) return;
      this.setData({ adminActionsVisible: !this.data.adminActionsVisible });
      try {
        wx.vibrateShort({ type: 'light' });
      } catch (e) {
        /* ignore */
      }
    },

    noop() {},

    onEdit() {
      this.triggerEvent('edit', {
        packId: this.data.packId,
        title: this.data.title,
      });
    },

    onDelete() {
      this.triggerEvent('delete', {
        packId: this.data.packId,
        title: this.data.title,
      });
    },
  },
});
