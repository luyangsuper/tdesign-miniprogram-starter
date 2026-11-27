import { createShellMethods, SHELL_DATA } from './shell';

/** 列表入口：完整说明；图标用实色底 + 白标，区分度更高 */
const SECTIONS = [
  {
    id: 'basic',
    title: '常用处理',
    tools: [
      {
        id: 'compress',
        title: '压缩图片',
        desc: '调质量与最长边，快速缩小体积',
        icon: 'image-down',
        color: '#0d9488',
        url: '/pages/tools/image/compress/index',
      },
      {
        id: 'to-size',
        title: '压到指定大小',
        desc: '目标 KB / MB，自动压到接近',
        icon: 'file',
        color: '#4f46e5',
        url: '/pages/tools/image/to-size/index',
      },
      {
        id: 'resize',
        title: '调整尺寸',
        desc: '按像素或百分比缩放',
        icon: 'expand',
        color: '#0891b2',
        url: '/pages/tools/image/resize/index',
      },
      {
        id: 'crop',
        title: '裁剪图片',
        desc: '自由框选，常用比例一键切',
        icon: 'crop',
        color: '#059669',
        url: '/pages/tools/image/crop/index',
      },
      {
        id: 'convert',
        title: '格式转换',
        desc: 'PNG / JPG 互转',
        icon: 'refresh',
        color: '#2563eb',
        url: '/pages/tools/image/convert/index',
      },
    ],
  },
  {
    id: 'advanced',
    title: '进阶能力',
    tools: [
      {
        id: 'to-gif',
        title: '转成 GIF',
        desc: '静图导出为 GIF',
        tag: 'GIF',
        tagTheme: 'success',
        icon: 'sparkles',
        color: '#7c3aed',
        url: '/pages/tools/image/to-gif/index',
      },
      {
        id: 'watermark',
        title: '加水印',
        desc: '文字水印，位置与透明度',
        icon: 'paintbrush',
        color: '#c2410c',
        url: '/pages/tools/image/watermark/index',
      },
      {
        id: 'stitch',
        title: '拼接长图',
        desc: '横拼 / 竖拼，统一边与间距',
        icon: 'copy',
        color: '#0f766e',
        url: '/pages/tools/image/stitch/index',
      },
      {
        id: 'split',
        title: '九宫格分割',
        desc: '朋友圈九宫格切图',
        icon: 'grid',
        color: '#b45309',
        url: '/pages/tools/image/split/index',
      },
    ],
  },
];

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    sections: SECTIONS,
  },

  onLoad() {
    this.initShell();
  },

  onUnload() {
    this.unbindShellEvents();
  },

  onShow() {
    this.refreshFestivalDecor();
  },

  goTool(e) {
    const url =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) ||
      '';
    if (!url) return;
    wx.navigateTo({ url });
  },

  ...shell,
});
