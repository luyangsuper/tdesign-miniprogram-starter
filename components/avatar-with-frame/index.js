function parseRpx(size) {
  const raw = String(size || '88rpx').trim();
  const m = raw.match(/^([\d.]+)(rpx|px)$/i);
  if (!m) return { n: 88, unit: 'rpx' };
  return { n: parseFloat(m[1]) || 88, unit: m[2].toLowerCase() };
}

Component({
  properties: {
    avatarUrl: { type: String, value: '' },
    frameUrl: { type: String, value: '' },
    /** 头像直径，框外框约为 1.25 倍 */
    size: { type: String, value: '88rpx' },
    icon: { type: String, value: 'user' },
  },
  data: {
    boxSize: '110rpx',
  },
  observers: {
    size(size) {
      const { n, unit } = parseRpx(size);
      const box = Math.round(n * 1.25);
      this.setData({ boxSize: `${box}${unit}` });
    },
  },
  lifetimes: {
    attached() {
      const { n, unit } = parseRpx(this.data.size);
      this.setData({ boxSize: `${Math.round(n * 1.25)}${unit}` });
    },
  },
  methods: {
    onAvatarError() {
      this.triggerEvent('error');
    },
  },
});
