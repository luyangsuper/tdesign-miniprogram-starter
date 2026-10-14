import { categoryTagStyle, metaTagStyle } from '~/utils/categories';
import { getThemeBrand } from '~/utils/theme';

Component({
  options: {
    styleIsolation: 'shared',
  },
  properties: {
    packId: String,
    title: String,
    coverUrl: String,
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
  },

  data: {
    tags: [],
    mediaHeight: 0,
    coverReady: false,
    brandColor: '#07C160',
  },

  observers: {
    'emojiCount, downloadCount, categoryId, categoryName': function () {
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
      const { emojiCount, downloadCount, categoryId, categoryName } = this.data;
      const tags = [];
      if (categoryName) {
        tags.push({
          text: categoryName,
          theme: 'default',
          customStyle: categoryTagStyle(categoryId, categoryName),
        });
      }
      if (emojiCount) {
        tags.push({
          text: `${emojiCount}张`,
          theme: 'default',
          customStyle: metaTagStyle('count'),
        });
      }
      if (downloadCount) {
        tags.push({
          text: `已下载${downloadCount}`,
          theme: 'default',
          customStyle: metaTagStyle('download'),
        });
      }
      this.setData({ tags });
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

    onTap() {
      const { packId, selectMode } = this.data;
      if (!packId) return;
      if (selectMode) {
        this.triggerEvent('toggle', { packId });
        return;
      }
      wx.navigateTo({
        url: `/pages/pack/detail/index?id=${packId}`,
      });
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
