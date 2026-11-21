import { loadKubaiIconLocal } from '~/utils/kubaiIcon';

function parseSize(size) {
  const raw = String(size || '48rpx').trim();
  const m = raw.match(/^([\d.]+)(rpx|px|%)$/i);
  if (!m) return { n: 48, unit: 'rpx', raw };
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return { n: 48, unit: 'rpx', raw };
  return { n, unit: m[2], raw };
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  properties: {
    /** 逻辑名或 Kubai kebab-case（见 utils/kubaiIcon ALIAS） */
    name: {
      type: String,
      value: '',
    },
    size: {
      type: String,
      value: '48rpx',
    },
    /** 六位 hex，可带 #；rgba/CSS var 会归一化。type 不限，避免父级短暂传 null 刷屏 */
    color: {
      type: null,
      value: '#07c160',
    },
    /** 点击播放轻动效（官网 hover 在小程序不可用，改为 tap） */
    motion: {
      type: Boolean,
      value: true,
    },
  },
  data: {
    src: '',
    boxStyle: 'width:48rpx;height:48rpx;',
    playing: false,
  },
  lifetimes: {
    detached() {
      if (this._playTimer) {
        clearTimeout(this._playTimer);
        this._playTimer = null;
      }
      this._loadSeq = (this._loadSeq || 0) + 1;
    },
  },
  observers: {
    'name, color, size': function sync(name, color, size) {
      const { n, unit } = parseSize(size || '48rpx');
      const boxStyle = `width:${n}${unit};height:${n}${unit};`;
      const safeColor =
        color == null || color === '' ? '#07c160' : String(color);
      if (!name) {
        this.setData({ src: '', boxStyle });
        return;
      }
      // 先更新尺寸，图标异步落本地后再填 src（网络 SVG 在 <image> 里不显示）
      this.setData({ boxStyle });
      const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
      loadKubaiIconLocal(name, safeColor).then((src) => {
        if (seq !== this._loadSeq) return;
        this.setData({ src: src || '' });
      });
    },
  },
  methods: {
    onTap() {
      if (!this.data.motion) return;
      this.play();
    },
    /** 供父级在单元格点击时主动触发 */
    play() {
      if (!this.data.motion) return;
      if (this._playTimer) {
        clearTimeout(this._playTimer);
        this._playTimer = null;
      }
      this.setData({ playing: false }, () => {
        this.setData({ playing: true });
        this._playTimer = setTimeout(() => {
          this._playTimer = null;
          this.setData({ playing: false });
        }, 480);
      });
    },
  },
});
