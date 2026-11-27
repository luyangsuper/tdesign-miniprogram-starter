import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'tools', 'image');
const dirs = fs.readdirSync(root).filter((d) => {
  const p = path.join(root, d);
  return fs.statSync(p).isDirectory() && d !== 'compress';
});

const oldBlock = `        <view wx:else class="imgtool__preview-empty">
          <kubai-icon name="image" size="48rpx" color="{{themeBrand}}" />
          <text class="imgtool__preview-empty-text">点此选图（需通过安全检测）</text>
        </view>
      </view>
      <view wx:if="{{srcMeta}}" class="imgtool__meta">{{srcMeta}}</view>
      <view wx:if="{{checking}}" class="imgtool__hint">
        <t-loading theme="circular" size="32rpx" text="{{checkText}}" />
      </view>`;

const newBlock = `        <view wx:elif="{{!checking}}" class="imgtool__preview-empty">
          <kubai-icon name="image" size="48rpx" color="{{themeBrand}}" />
          <text class="imgtool__preview-empty-text">点此选图（需通过安全检测）</text>
        </view>
        <view wx:if="{{checking}}" class="imgtool__preview-loading">
          <t-loading theme="circular" size="40rpx" text="{{checkText}}" />
        </view>
      </view>
      <view wx:if="{{srcMeta}}" class="imgtool__meta">{{srcMeta}}</view>`;

for (const d of dirs) {
  const file = path.join(root, d, 'index.wxml');
  if (!fs.existsSync(file)) continue;
  let t = fs.readFileSync(file, 'utf8');
  const before = t;
  t = t.replace(
    /class="imgtool__preview-img" src="\{\{srcPath\}\}" mode="widthFix"/g,
    'class="imgtool__preview-img" src="{{srcPath}}" mode="aspectFit"',
  );
  t = t.replace(
    /class="imgtool__preview-img" src="\{\{outPath\}\}" mode="widthFix"/g,
    'class="imgtool__preview-img" src="{{outPath}}" mode="aspectFit"',
  );
  if (t.includes(oldBlock)) t = t.replace(oldBlock, newBlock);
  if (t !== before) {
    fs.writeFileSync(file, t);
    console.log('updated', d);
  } else {
    console.log('skip', d);
  }
}
