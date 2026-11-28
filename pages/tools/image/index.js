import { createShellMethods, SHELL_DATA } from './shell';

/** 入口对齐 hahaimage「图片工具」清单，并保留小程序可用的扩展项 */
const SECTIONS = [
  {
    id: 'image',
    title: '图片工具',
    tools: [
      {
        id: 'convert',
        title: '转换图片',
        desc: 'PNG / JPG 互转',
        icon: 'refresh',
        color: '#2563eb',
        url: '/pages/tools/image/convert/index',
      },
      {
        id: 'stitch',
        title: '拼接图片',
        desc: '横拼 / 竖拼，间距与统一尺寸',
        icon: 'copy',
        color: '#0f766e',
        url: '/pages/tools/image/stitch/index',
      },
      {
        id: 'watermark',
        title: '图片加水印',
        desc: '文字 / 图片水印，九宫格与平铺',
        icon: 'paintbrush',
        color: '#c2410c',
        url: '/pages/tools/image/watermark/index',
      },
      {
        id: 'resize',
        title: '调整图片尺寸',
        desc: '按像素或百分比缩放',
        icon: 'expand',
        color: '#0891b2',
        url: '/pages/tools/image/resize/index',
      },
      {
        id: 'crop',
        title: '裁剪图片',
        desc: '拖拽框选，常用比例一键切',
        icon: 'crop',
        color: '#059669',
        url: '/pages/tools/image/crop/index',
      },
      {
        id: 'compress',
        title: '压缩图片',
        desc: '调质量与最长边，缩小体积',
        icon: 'image-down',
        color: '#0d9488',
        url: '/pages/tools/image/compress/index',
      },
      {
        id: 'compress-exif',
        title: '压缩并保留 EXIF',
        desc: '压缩 JPG，保留拍摄信息',
        icon: 'file',
        color: '#4f46e5',
        url: '/pages/tools/image/compress-exif/index',
      },
      {
        id: 'to-size',
        title: '压缩到指定大小',
        desc: '目标 KB / MB，自动压到接近',
        icon: 'file',
        color: '#7c3aed',
        url: '/pages/tools/image/to-size/index',
      },
      {
        id: 'exif',
        title: '读取 EXIF',
        desc: '查看拍摄参数、GPS 等元数据',
        icon: 'info-circle',
        color: '#0369a1',
        url: '/pages/tools/image/exif/index',
      },
      {
        id: 'split',
        title: '分割图片',
        desc: '按行列切成九宫格或任意网格',
        icon: 'grid',
        color: '#b45309',
        url: '/pages/tools/image/split/index',
      },
    ],
  },
  {
    id: 'extra',
    title: '更多能力',
    tools: [
      {
        id: 'rotate',
        title: '旋转翻转',
        desc: '旋转角度，水平 / 垂直翻转',
        icon: 'refresh',
        color: '#7c3aed',
        url: '/pages/tools/image/rotate/index',
      },
      {
        id: 'round',
        title: '圆角图片',
        desc: '加圆角，导出透明 PNG',
        icon: 'image',
        color: '#db2777',
        url: '/pages/tools/image/round/index',
      },
      {
        id: 'to-gif',
        title: '转成 GIF',
        desc: '静图导出为 GIF',
        tag: 'GIF',
        tagTheme: 'success',
        icon: 'sparkles',
        color: '#9333ea',
        url: '/pages/tools/image/to-gif/index',
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
    this.refreshNativeAd();
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
