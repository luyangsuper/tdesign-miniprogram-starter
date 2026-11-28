import { resignTempUrl } from '~/utils/resignTempUrl';

const MAX_TRIES = 2;

Component({
  options: {
    // 去掉自定义组件外层节点，宽高才能吃满父级
    virtualHost: true,
    pureDataPattern: /^_/,
  },

  properties: {
    /** 当前 https 预览地址 */
    src: { type: String, value: '' },
    /** 云存储 fileID；有则裂图后可换签重试 */
    fileId: { type: String, value: '' },
    /** 额外缓存 key（与 fileId 一并 forget / remember） */
    cacheKey: { type: String, value: '' },
    mode: { type: String, value: 'aspectFill' },
    shape: { type: String, value: 'round' },
    lazy: { type: Boolean, value: true },
    webp: { type: Boolean, value: false },
    /** 覆盖圆角，写入 --td-image-round-radius */
    radius: { type: String, value: '' },
    /** 透明底：露出父级棋盘格 / 深色舞台 */
    transparent: { type: Boolean, value: false },
  },

  data: {
    displaySrc: '',
    imgKey: 0,
    failed: false,
    ready: false,
    wrapStyle: '',
  },

  lifetimes: {
    attached() {
      this._tries = 0;
      this._resigning = false;
      this.applyWrapStyle();
      // 首屏直接赋 src，禁止先卸再挂（会闪裂图 X）
      const src = String(this.properties.src || '').trim();
      if (src) {
        this.setData({ displaySrc: src, failed: false, ready: false });
      }
    },
  },

  observers: {
    src(next) {
      this.applySrc(next);
    },
    'radius, transparent'() {
      this.applyWrapStyle();
    },
  },

  methods: {
    applyWrapStyle() {
      const r = String(this.properties.radius || '').trim();
      const parts = [];
      if (r) {
        parts.push(`border-radius:${r}`, `--td-image-round-radius:${r}`);
      }
      if (this.properties.transparent) {
        parts.push(
          'background:transparent',
          '--td-image-color:#00000000',
          '--td-image-bg-color:transparent',
        );
      }
      this.setData({ wrapStyle: parts.join(';') });
    },

    applySrc(src) {
      const next = String(src || '').trim();
      if (next === this.data.displaySrc) return;
      this._tries = 0;
      this._resigning = false;
      // 正常换源：只改 src，保留节点，走 loading 槽而不是 error 槽
      this.setData({
        displaySrc: next,
        failed: false,
        ready: false,
      });
    },

    /** 裂图换签后强制 t-image 重挂（仅失败重试路径，避免首屏闪裂） */
    remount(src) {
      const next = String(src || '').trim();
      const key = (Number(this.data.imgKey) || 0) + 1;
      this.setData({ displaySrc: '', failed: false, ready: false, imgKey: key });
      wx.nextTick(() => {
        this.setData({ displaySrc: next, failed: false });
      });
    },

    onImageLoad() {
      if (!this.data.ready) this.setData({ ready: true });
    },

    async onImageError() {
      if (this._resigning) return;
      const tried = Number(this._tries) || 0;
      if (tried >= MAX_TRIES) {
        this.setData({ failed: true });
        this.triggerEvent('fail', {
          src: this.data.displaySrc,
          fileId: this.properties.fileId,
        });
        return;
      }
      this._tries = tried + 1;
      this._resigning = true;

      const fileId = String(this.properties.fileId || '').trim();
      const cacheKey = String(this.properties.cacheKey || '').trim();
      const extra = cacheKey ? [cacheKey] : [];

      try {
        if (fileId) {
          const next = await resignTempUrl(fileId, extra);
          if (next) {
            if (next !== this.data.displaySrc) {
              this.triggerEvent('resign', { src: next, fileId });
            }
            this.remount(next);
            return;
          }
        } else if (this.data.displaySrc) {
          this.remount(this.data.displaySrc);
          return;
        }
        this.setData({ failed: true });
        this.triggerEvent('fail', {
          src: this.data.displaySrc,
          fileId,
        });
      } catch (e) {
        this.setData({ failed: true });
      } finally {
        this._resigning = false;
      }
    },
  },
});
