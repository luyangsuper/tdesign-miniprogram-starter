import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'tools', 'image');

const oldPick = `      <view class="imgtool__preview" bindtap="onPick" hover-class="imghub__card--hover">
        <block wx:if="{{srcPath}}">
          <image class="imgtool__preview-img" src="{{srcPath}}" mode="aspectFit" />
        </block>
        <view wx:elif="{{!checking}}" class="imgtool__preview-empty">
          <kubai-icon name="image" size="48rpx" color="{{themeBrand}}" />
          <text class="imgtool__preview-empty-text">点此选图（需通过安全检测）</text>
        </view>
        <view wx:if="{{checking}}" class="imgtool__preview-loading">
          <t-loading theme="circular" size="40rpx" text="{{checkText}}" />
        </view>
      </view>`;

const newPick = `      <view
        class="imgtool__preview {{!srcPath ? 'imgtool__preview--pick' : ''}}"
        bindtap="onPick"
        hover-class="imghub__card--hover"
      >
        <block wx:if="{{srcPath}}">
          <image class="imgtool__preview-img" src="{{srcPath}}" mode="aspectFit" />
        </block>
        <view wx:elif="{{!checking}}" class="imgtool__preview-empty">
          <kubai-icon name="image" size="56rpx" color="{{themeBrand}}" />
          <text class="imgtool__preview-empty-title">点此选图</text>
          <text class="imgtool__preview-empty-text">需通过安全检测后才能处理</text>
        </view>
        <view wx:if="{{checking}}" class="imgtool__preview-loading">
          <t-loading theme="circular" size="40rpx" text="{{checkText}}" />
        </view>
      </view>`;

for (const name of fs.readdirSync(root)) {
  const file = path.join(root, name, 'index.wxml');
  if (!fs.existsSync(file) || name === 'compress') continue;
  let t = fs.readFileSync(file, 'utf8');
  let changed = false;
  if (t.includes(oldPick)) {
    t = t.replace(oldPick, newPick);
    changed = true;
  }
  // wrap chips -> grid for multi options
  if (t.includes('imgtool__chips imgtool__chips--wrap')) {
    t = t.replace(/class="imgtool__chips imgtool__chips--wrap"/g, 'class="imgtool__chip-grid"');
    t = t.replace(
      /class="imgtool__chips imgtool__chips--wrap" style="margin-top: 12rpx;"/g,
      'class="imgtool__chip-grid" style="margin-top: 12rpx;"',
    );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(file, t);
    console.log('updated', name);
  } else {
    console.log('skip', name);
  }
}
