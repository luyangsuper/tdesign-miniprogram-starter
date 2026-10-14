/** 趣味加载：纯 CSS，灵感来自 bouncing-dots / emoji bounce 一类开源效果 */

const VARIANTS = ['bounce', 'orbit', 'wave', 'jelly'];

const EMOJI_SETS = [
  ['🎨', '✨', '🖼️'],
  ['😊', '🎉', '⭐'],
  ['🐱', '🐶', '🐰'],
  ['🌈', '💫', '🎭'],
  ['🍋', '🍓', '🍇'],
];

const TIPS = [
  '正在翻合集…',
  '表情们排队中…',
  '马上就好…',
  '一点点魔法…',
  '合集打包中…',
  '再等一丢丢…',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  properties: {
    /** bounce | orbit | wave | jelly | auto */
    variant: {
      type: String,
      value: 'auto',
    },
    text: {
      type: String,
      value: '加载中',
    },
    /** 是否轮换趣味文案 */
    funTips: {
      type: Boolean,
      value: true,
    },
    size: {
      type: String,
      value: 'medium', // medium | small
    },
  },

  data: {
    resolvedVariant: 'bounce',
    emoji0: '🎨',
    emoji1: '✨',
    emoji2: '🖼️',
    displayText: '加载中',
  },

  lifetimes: {
    attached() {
      this.applyLook(true);
      if (this.properties.funTips) {
        this._tipTimer = setInterval(() => {
          this.setData({ displayText: pick(TIPS) });
        }, 2200);
      }
    },
    detached() {
      if (this._tipTimer) {
        clearInterval(this._tipTimer);
        this._tipTimer = null;
      }
    },
  },

  observers: {
    'variant, text, funTips': function () {
      this.applyLook(false);
    },
  },

  methods: {
    applyLook(reshuffle) {
      let resolvedVariant = this.properties.variant;
      if (!resolvedVariant || resolvedVariant === 'auto') {
        resolvedVariant = reshuffle
          ? pick(VARIANTS)
          : this.data.resolvedVariant || pick(VARIANTS);
      }
      const set = reshuffle ? pick(EMOJI_SETS) : null;
      const patch = {
        resolvedVariant,
        displayText: this.properties.funTips
          ? reshuffle
            ? pick(TIPS)
            : this.data.displayText
          : // 允许传空串隐藏文案（首页下拉刷新用 WXS 切字，避免 setData）
            typeof this.properties.text === 'string'
              ? this.properties.text
              : '加载中',
      };
      if (set) {
        patch.emoji0 = set[0];
        patch.emoji1 = set[1];
        patch.emoji2 = set[2];
      }
      this.setData(patch);
    },
  },
});
