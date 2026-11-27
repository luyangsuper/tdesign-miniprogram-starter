/**
 * 生成图片工具箱子页骨架（仅首次脚手架用）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'pages', 'tools', 'image');

const COMMON_JSON = `{
  "navigationStyle": "custom",
  "styleIsolation": "shared",
  "usingComponents": {
    "t-navbar": "tdesign-miniprogram/navbar/navbar",
    "t-button": "tdesign-miniprogram/button/button",
    "t-slider": "tdesign-miniprogram/slider/slider",
    "t-check-tag": "tdesign-miniprogram/check-tag/check-tag",
    "t-input": "tdesign-miniprogram/input/input",
    "t-switch": "tdesign-miniprogram/switch/switch",
    "t-loading": "tdesign-miniprogram/loading/loading",
    "festival-decor": "/components/festival-decor/index"
  }
}
`;

const LESS = `@import '../tool.less';
`;

function wxml(title) {
  return `<view class="imgtool-page {{festivalClass}}" style="{{themeStyle}};{{festivalStyle}};{{navBarStyle}}">
  <festival-decor
    id="festivalDecor"
    mode="navbar"
    active="{{festivalActive}}"
    header-height="{{festHeaderPx}}"
    nav-height="{{navHeight}}"
  />
  <t-navbar
    fixed="{{true}}"
    placeholder="{{true}}"
    z-index="{{500}}"
    left-arrow
    custom-style="{{navBarStyle}}"
    bind:go-back="onBack"
  >
    <view slot="title" class="imgtool__nav-title">${title}</view>
  </t-navbar>

  <view class="imgtool">
    <view class="imgtool__hero">
      <text class="imgtool__kicker">图片工具箱</text>
      <text class="imgtool__hero-title">${title}</text>
      <text class="imgtool__hero-desc">{{heroDesc}}</text>
    </view>

    <view class="imgtool__card">
      <view class="imgtool__card-title">原图</view>
      <view class="imgtool__preview" bindtap="onPick" hover-class="imghub__card--hover">
        <block wx:if="{{srcPath}}">
          <image class="imgtool__preview-img" src="{{srcPath}}" mode="widthFix" />
        </block>
        <view wx:else class="imgtool__preview-empty">
          <kubai-icon name="image" size="48rpx" color="{{themeBrand}}" />
          <text class="imgtool__preview-empty-text">点此选图（需通过安全检测）</text>
        </view>
      </view>
      <view wx:if="{{srcMeta}}" class="imgtool__meta">{{srcMeta}}</view>
      <view wx:if="{{checking}}" class="imgtool__hint">
        <t-loading theme="circular" size="32rpx" text="{{checkText}}" />
      </view>
    </view>

    <view class="imgtool__card">
      <view class="imgtool__card-title">参数</view>
      <!--PARAMS-->
    </view>

    <view class="imgtool__card">
      <view class="imgtool__card-title">结果</view>
      <view class="imgtool__preview">
        <block wx:if="{{outPath}}">
          <image class="imgtool__preview-img" src="{{outPath}}" mode="widthFix" />
        </block>
        <view wx:else class="imgtool__preview-empty">
          <text class="imgtool__preview-empty-text">处理好后在这里预览</text>
        </view>
      </view>
      <view wx:if="{{outMeta}}" class="imgtool__meta">{{outMeta}}</view>
      <view class="imgtool__actions">
        <t-button theme="light" size="large" shape="round" block content="{{busy ? '处理中…' : '开始处理'}}" disabled="{{!srcPath || busy || checking}}" bind:tap="onProcess" />
        <t-button theme="primary" size="large" shape="round" block content="{{gating ? '解锁中…' : '保存到相册'}}" disabled="{{!outPath || busy || gating}}" bind:tap="onSave" />
      </view>
      <view class="imgtool__hint">处理免费；保存需积分解锁或看一次广告</view>
    </view>
  </view>
</view>
`;
}

const tools = {
  compress: {
    title: '压缩图片',
    heroDesc: '调节画质与最长边，缩小文件体积',
    params: `
      <view class="imgtool__row">
        <text class="imgtool__label">画质</text>
        <text class="imgtool__value">{{qualityLabel}}</text>
      </view>
      <t-slider class="imgtool__slider" value="{{qualityPct}}" min="{{20}}" max="{{95}}" step="{{1}}" label bind:change="onQualityChange" />
      <view class="imgtool__row">
        <text class="imgtool__label">最长边</text>
        <text class="imgtool__value">{{maxEdge}} px</text>
      </view>
      <view class="imgtool__chips">
        <t-check-tag wx:for="{{edgePresets}}" wx:key="*this" class="imgtool__chip {{maxEdge === item ? 'imgtool__chip--on' : ''}}" checked="{{maxEdge === item}}" content="{{item}}" data-v="{{item}}" bind:change="onEdgePreset" />
      </view>
    `,
    dataExtra: `
    qualityPct: 80,
    qualityLabel: '80%',
    maxEdge: 1920,
    edgePresets: [1280, 1600, 1920, 2560],`,
    methods: `
  onQualityChange(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 80));
    this.setData({ qualityPct: v, qualityLabel: v + '%', exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onEdgePreset(e) {
    const v = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 1920);
    this.setData({ maxEdge: v, exportUnlocked: false, outPath: '', outMeta: '' });
  },
  async runProcess() {
    const res = await compressImage(this.data.srcPath, {
      quality: this.data.qualityPct / 100,
      maxEdge: this.data.maxEdge,
    });
    return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },`,
    imports: `import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  compressImage,
} from '../../utils/imageTool';`,
  },
  resize: {
    title: '调整尺寸',
    heroDesc: '按像素缩放，可锁定原图比例',
    params: `
      <view class="imgtool__row">
        <text class="imgtool__label">锁定比例</text>
        <t-switch checked="{{lockRatio}}" bind:change="onLockChange" />
      </view>
      <view class="imgtool__field">
        <t-input label="宽度" type="number" suffix="px" value="{{widthInput}}" bind:change="onWidthChange" />
      </view>
      <view class="imgtool__field">
        <t-input label="高度" type="number" suffix="px" value="{{heightInput}}" bind:change="onHeightChange" />
      </view>
      <view class="imgtool__chips">
        <t-check-tag wx:for="{{scalePresets}}" wx:key="v" class="imgtool__chip {{scalePct === item.v ? 'imgtool__chip--on' : ''}}" checked="{{scalePct === item.v}}" content="{{item.label}}" data-v="{{item.v}}" bind:change="onScalePreset" />
      </view>
    `,
    dataExtra: `
    lockRatio: true,
    widthInput: '',
    heightInput: '',
    scalePct: 100,
    scalePresets: [{ v: 50, label: '50%' }, { v: 75, label: '75%' }, { v: 100, label: '100%' }, { v: 150, label: '150%' }],
    srcW: 0,
    srcH: 0,`,
    methods: `
  onLockChange(e) {
    this.setData({ lockRatio: !!(e.detail && e.detail.value), exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onWidthChange(e) {
    const w = String((e.detail && e.detail.value) || '');
    const patch = { widthInput: w, scalePct: 0, exportUnlocked: false, outPath: '', outMeta: '' };
    if (this.data.lockRatio && this.data.srcW && this.data.srcH) {
      const nw = Math.max(1, Math.round(Number(w) || 0));
      if (nw) patch.heightInput = String(Math.max(1, Math.round((nw / this.data.srcW) * this.data.srcH)));
    }
    this.setData(patch);
  },
  onHeightChange(e) {
    const h = String((e.detail && e.detail.value) || '');
    const patch = { heightInput: h, scalePct: 0, exportUnlocked: false, outPath: '', outMeta: '' };
    if (this.data.lockRatio && this.data.srcW && this.data.srcH) {
      const nh = Math.max(1, Math.round(Number(h) || 0));
      if (nh) patch.widthInput = String(Math.max(1, Math.round((nh / this.data.srcH) * this.data.srcW)));
    }
    this.setData(patch);
  },
  onScalePreset(e) {
    const v = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 100);
    const w = Math.max(1, Math.round((this.data.srcW * v) / 100));
    const h = Math.max(1, Math.round((this.data.srcH * v) / 100));
    this.setData({
      scalePct: v,
      widthInput: String(w),
      heightInput: String(h),
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },
  afterPick(file) {
    this.setData({
      srcW: file.width || 0,
      srcH: file.height || 0,
      widthInput: String(file.width || ''),
      heightInput: String(file.height || ''),
      scalePct: 100,
    });
  },
  async runProcess() {
    const width = Math.max(1, Math.round(Number(this.data.widthInput) || this.data.srcW || 1));
    const height = Math.max(1, Math.round(Number(this.data.heightInput) || this.data.srcH || 1));
    const res = await resizeImage(this.data.srcPath, {
      width,
      height,
      lockRatio: false,
      fileType: 'png',
    });
    return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },`,
    imports: `import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  resizeImage,
} from '../../utils/imageTool';`,
  },
  convert: {
    title: '格式转换',
    heroDesc: '在 PNG 与 JPG 之间转换',
    params: `
      <view class="imgtool__row">
        <text class="imgtool__label">目标格式</text>
      </view>
      <view class="imgtool__chips">
        <t-check-tag class="imgtool__chip {{format === 'png' ? 'imgtool__chip--on' : ''}}" checked="{{format === 'png'}}" content="PNG" data-v="png" bind:change="onFormat" />
        <t-check-tag class="imgtool__chip {{format === 'jpg' ? 'imgtool__chip--on' : ''}}" checked="{{format === 'jpg'}}" content="JPG" data-v="jpg" bind:change="onFormat" />
      </view>
      <view wx:if="{{format === 'jpg'}}" class="imgtool__row">
        <text class="imgtool__label">JPG 画质</text>
        <text class="imgtool__value">{{qualityLabel}}</text>
      </view>
      <t-slider wx:if="{{format === 'jpg'}}" class="imgtool__slider" value="{{qualityPct}}" min="{{40}}" max="{{95}}" step="{{1}}" label bind:change="onQualityChange" />
    `,
    dataExtra: `
    format: 'png',
    qualityPct: 90,
    qualityLabel: '90%',`,
    methods: `
  onFormat(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 'png';
    this.setData({ format: v, exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onQualityChange(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 90));
    this.setData({ qualityPct: v, qualityLabel: v + '%', exportUnlocked: false, outPath: '', outMeta: '' });
  },
  async runProcess() {
    const res = await convertImage(this.data.srcPath, {
      format: this.data.format,
      quality: this.data.qualityPct / 100,
    });
    return { ...res, meta: (res.format || '').toUpperCase() + ' · ' + res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },`,
    imports: `import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  convertImage,
} from '../../utils/imageTool';`,
  },
  'to-gif': {
    title: '转成 GIF',
    heroDesc: '把静图导出为 GIF 动图（单帧）',
    params: `
      <view class="imgtool__hint">适合需要 GIF 格式的场景；画质尽量保真。</view>
    `,
    dataExtra: ``,
    methods: `
  async runProcess() {
    const path = await convertLocalImageToGif(this.data.srcPath);
    const size = await fileSize(path);
    let width = 0;
    let height = 0;
    try {
      const m = await probeImage(path);
      width = m.width;
      height = m.height;
    } catch (e) {}
    return { path, width, height, size, meta: 'GIF · ' + (width && height ? width + '×' + height + ' · ' : '') + formatBytes(size) };
  },`,
    imports: `import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  fileSize,
  probeImage,
} from '../../utils/imageTool';
import { convertLocalImageToGif } from '~/utils/imageToGif';`,
  },
  watermark: {
    title: '加水印',
    heroDesc: '添加文字水印，调整位置与透明度',
    params: `
      <view class="imgtool__field">
        <t-input label="水印文字" value="{{wmText}}" maxlength="{{24}}" bind:change="onWmText" />
      </view>
      <view class="imgtool__row">
        <text class="imgtool__label">位置</text>
      </view>
      <view class="imgtool__chips">
        <t-check-tag wx:for="{{posList}}" wx:key="id" class="imgtool__chip {{wmPos === item.id ? 'imgtool__chip--on' : ''}}" checked="{{wmPos === item.id}}" content="{{item.label}}" data-v="{{item.id}}" bind:change="onWmPos" />
      </view>
      <view class="imgtool__row">
        <text class="imgtool__label">透明度</text>
        <text class="imgtool__value">{{opacityLabel}}</text>
      </view>
      <t-slider class="imgtool__slider" value="{{opacityPct}}" min="{{10}}" max="{{90}}" step="{{1}}" label bind:change="onOpacity" />
      <view class="imgtool__row">
        <text class="imgtool__label">字号</text>
        <text class="imgtool__value">{{fontSize}}</text>
      </view>
      <t-slider class="imgtool__slider" value="{{fontSize}}" min="{{18}}" max="{{96}}" step="{{2}}" label bind:change="onFontSize" />
    `,
    dataExtra: `
    wmText: '趣图铺子',
    wmPos: 'br',
    posList: [
      { id: 'tl', label: '左上' }, { id: 'tc', label: '中上' }, { id: 'tr', label: '右上' },
      { id: 'ml', label: '左中' }, { id: 'mc', label: '居中' }, { id: 'mr', label: '右中' },
      { id: 'bl', label: '左下' }, { id: 'bc', label: '中下' }, { id: 'br', label: '右下' },
    ],
    opacityPct: 45,
    opacityLabel: '45%',
    fontSize: 36,`,
    methods: `
  onWmText(e) {
    this.setData({ wmText: String((e.detail && e.detail.value) || ''), exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onWmPos(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 'br';
    this.setData({ wmPos: v, exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onOpacity(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 45));
    this.setData({ opacityPct: v, opacityLabel: v + '%', exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onFontSize(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 36));
    this.setData({ fontSize: v, exportUnlocked: false, outPath: '', outMeta: '' });
  },
  async runProcess() {
    const res = await watermarkImage(this.data.srcPath, {
      text: this.data.wmText,
      position: this.data.wmPos,
      opacity: this.data.opacityPct / 100,
      fontSize: this.data.fontSize,
    });
    return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },`,
    imports: `import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  watermarkImage,
} from '../../utils/imageTool';`,
  },
  'to-size': {
    title: '压到指定大小',
    heroDesc: '按目标体积自动调整画质与尺寸',
    params: `
      <view class="imgtool__row">
        <text class="imgtool__label">目标大小</text>
        <text class="imgtool__value">{{targetLabel}}</text>
      </view>
      <view class="imgtool__chips">
        <t-check-tag wx:for="{{sizePresets}}" wx:key="v" class="imgtool__chip {{targetKb === item.v ? 'imgtool__chip--on' : ''}}" checked="{{targetKb === item.v}}" content="{{item.label}}" data-v="{{item.v}}" bind:change="onTarget" />
      </view>
      <view class="imgtool__field">
        <t-input label="自定义" type="number" suffix="KB" value="{{targetInput}}" bind:change="onTargetInput" />
      </view>
    `,
    dataExtra: `
    targetKb: 200,
    targetLabel: '200 KB',
    targetInput: '200',
    sizePresets: [
      { v: 100, label: '100KB' },
      { v: 200, label: '200KB' },
      { v: 500, label: '500KB' },
      { v: 1024, label: '1MB' },
    ],`,
    methods: `
  onTarget(e) {
    const v = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 200);
    this.setData({
      targetKb: v,
      targetLabel: v >= 1024 ? (v / 1024) + ' MB' : v + ' KB',
      targetInput: String(v),
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },
  onTargetInput(e) {
    const raw = String((e.detail && e.detail.value) || '');
    const v = Math.max(20, Math.round(Number(raw) || 0));
    this.setData({
      targetInput: raw,
      targetKb: v || this.data.targetKb,
      targetLabel: (v || this.data.targetKb) + ' KB',
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },
  async runProcess() {
    const kb = Math.max(20, Number(this.data.targetKb) || 200);
    const res = await compressToTargetSize(this.data.srcPath, {
      targetBytes: kb * 1024,
    });
    return {
      ...res,
      meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) + '（目标 ' + kb + ' KB）',
    };
  },`,
    imports: `import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  compressToTargetSize,
} from '../../utils/imageTool';`,
  },
};

function jsFor(id, conf) {
  return `import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: ${JSON.stringify(conf.heroDesc)},
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,${conf.dataExtra || ''}
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

  async onPick() {
    if (this.data.checking || this.data.busy || this.data.gating) return;
    this.setData({ checking: true, checkText: '安全检测中…' });
    try {
      const files = await pickCheckedImages({
        count: 1,
        onProgress: (t) => this.setData({ checkText: t }),
      });
      const f = files[0];
      this.setData({
        srcPath: f.path,
        srcMeta:
          (f.width && f.height ? f.width + '×' + f.height + ' · ' : '') +
          formatBytes(f.size),
        outPath: '',
        outMeta: '',
        exportUnlocked: false,
      });
      if (typeof this.afterPick === 'function') this.afterPick(f);
    } catch (e) {
      if (e && e.code === 'CANCEL') return;
      wx.showToast({
        title: String((e && e.message) || '选图失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      this.setData({ checking: false, checkText: '安全检测中…' });
    }
  },

  async onProcess() {
    if (!this.data.srcPath || this.data.busy || this.data.checking) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await this.runProcess();
      this.setData({
        outPath: res.path,
        outMeta: res.meta || '',
        exportUnlocked: false,
      });
      wx.showToast({ title: '处理完成', icon: 'success' });
    } catch (e) {
      wx.showToast({
        title: String((e && e.message) || '处理失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ busy: false });
    }
  },

  async onSave() {
    if (!this.data.outPath || this.data.busy || this.data.gating) return;
    this.setData({ gating: true });
    try {
      if (!this.data.exportUnlocked) {
        const gate = await unlockImageExport({ page: this });
        if (!gate || !gate.ok) return;
        this.setData({ exportUnlocked: true });
      }
      wx.showLoading({ title: '保存中', mask: true });
      await saveLocalImageToAlbum(this.data.outPath);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (e) {
      wx.showToast({
        title: String((e && e.message) || '保存失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ gating: false });
    }
  },
${conf.methods || ''}
  ...shell,
});
`;
}

for (const [id, conf] of Object.entries(tools)) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), COMMON_JSON);
  fs.writeFileSync(path.join(dir, 'index.less'), LESS);
  fs.writeFileSync(
    path.join(dir, 'index.wxml'),
    wxml(conf.title).replace('<!--PARAMS-->', conf.params || ''),
  );
  fs.writeFileSync(path.join(dir, 'index.js'), jsFor(id, conf));
  console.log('wrote', id);
}
