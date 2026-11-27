/**
 * 给各图片工具子页 index.less 写入 chip 兜底样式（压缩页曾靠本地 less 才显出色块）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'pages',
  'tools',
  'image',
);

const FALLBACK = `
/* chip 兜底：子页本地再写一遍，避免仅靠 @import 时色块/网格丢失 */
.imgtool__chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.imgtool__chip-grid .imgtool__chip {
  width: calc((100% - 36rpx) / 4);
  flex: none;
  text-align: center;
  padding: 18rpx 4rpx;
  border-radius: 16rpx;
  background: rgba(15, 23, 42, 0.06);
  border: 2rpx solid transparent;
  box-sizing: border-box;
  font-size: 24rpx;
  font-weight: 600;
  color: rgba(15, 23, 42, 0.55);
  line-height: 1.2;
}

.imgtool__chip-grid--3 .imgtool__chip {
  width: calc((100% - 24rpx) / 3);
}

.imgtool__chip-grid--2 .imgtool__chip {
  width: calc((100% - 12rpx) / 2);
}

.imgtool__chip-grid .imgtool__chip.is-on {
  background: rgba(7, 193, 96, 0.14);
  border-color: rgba(7, 193, 96, 0.45);
  color: #07c160;
}

.imgtool__chip-grid .imgtool__chip--wide {
  width: calc((100% - 12rpx) / 2);
}

.imgtool__chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 12rpx;
}

.imgtool__chips .imgtool__chip {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  padding: 18rpx 8rpx;
  border-radius: 16rpx;
  background: rgba(15, 23, 42, 0.06);
  border: 2rpx solid transparent;
  box-sizing: border-box;
  font-size: 26rpx;
  font-weight: 600;
  color: rgba(15, 23, 42, 0.55);
  line-height: 1.2;
}

.imgtool__chips .imgtool__chip.is-on {
  background: rgba(7, 193, 96, 0.14);
  border-color: rgba(7, 193, 96, 0.45);
  color: #07c160;
}
`;

const dirs = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const name of dirs) {
  const file = path.join(root, name, 'index.less');
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/\n\/\* 兜底：[\s\S]*$/m, '');
  src = src.replace(/\n\/\* chip 兜底：[\s\S]*$/m, '');
  if (!src.includes("@import '../tool.less'") && !src.includes('@import "../tool.less"')) {
    src = `@import '../tool.less';\n` + src;
  }
  src = src.trimEnd() + '\n' + FALLBACK;
  fs.writeFileSync(file, src);
  console.log('updated', name);
}
