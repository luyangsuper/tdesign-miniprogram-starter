import { categoryTagStyle, metaTagStyle } from '~/utils/categories';

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
  },

  data: {
    tags: [],
    mediaHeight: 0,
    coverReady: false,
  },

  observers: {
    'emojiCount, downloadCount, categoryId, categoryName': function () {
      this.refreshTags();
    },
    'cardWidth, coverRatio': function () {
      this.updateMediaHeight();
    },
    coverUrl() {
      this.setData({ coverReady: false });
    },
  },

  lifetimes: {
    attached() {
      this.refreshTags();
      this.updateMediaHeight();
      this._onThemeChange = () => this.refreshTags();
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
      const { packId } = this.data;
      if (packId) {
        try {
          wx.setStorageSync(`coverRatio_${packId}`, ratio);
        } catch (err) {
          /* ignore */
        }
      }
    },

    onTap() {
      const { packId } = this.data;
      if (!packId) return;
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
