/**
 * 用 IconPark 多色图标生成 static/emoji、static/pricing PNG
 * 运行：node scripts/generate-iconpark-assets.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const icons = require('@icon-park/svg');

const ROOT = path.join(__dirname, '..');
const SIZE = 512;

/** @type {Record<string, [string, string, string, string]>} */
const PALETTE = {
  brand: ['#1f2937', '#07c160', '#ffffff', '#86efac'],
  soft: ['#1f2937', '#64748b', '#ffffff', '#cbd5e1'],
  warn: ['#1f2937', '#f59e0b', '#ffffff', '#fde68a'],
  danger: ['#1f2937', '#ef4444', '#ffffff', '#fca5a5'],
  month: ['#1f2937', '#f59e0b', '#ffffff', '#fcd34d'],
  quarter: ['#1f2937', '#3b82f6', '#ffffff', '#93c5fd'],
  year: ['#1f2937', '#a855f7', '#ffffff', '#d8b4fe'],
  points: ['#1f2937', '#10b981', '#ffffff', '#6ee7b7'],
  points2: ['#1f2937', '#06b6d4', '#ffffff', '#67e8f9'],
  points3: ['#1f2937', '#eab308', '#ffffff', '#fde047'],
  preview: ['#1f2937', '#8b5cf6', '#ffffff', '#c4b5fd'],
  anim: ['#1f2937', '#ec4899', '#ffffff', '#f9a8d4'],
  guide: ['#1f2937', '#f59e0b', '#ffffff', '#fcd34d'],
  mail: ['#1f2937', '#3b82f6', '#ffffff', '#93c5fd'],
};

/**
 * @type {Array<{ dir: string, file: string, icon: string, palette: keyof typeof PALETTE, note: string }>}
 */
const ASSETS = [
  // emoji 装饰图
  { dir: 'static/emoji', file: 'eyes.png', icon: 'PreviewOpen', palette: 'preview', note: '预览空状态' },
  { dir: 'static/emoji', file: 'static.png', icon: 'PictureOne', palette: 'brand', note: '静态图' },
  { dir: 'static/emoji', file: 'anim.png', icon: 'Film', palette: 'anim', note: '动态图' },
  { dir: 'static/emoji', file: 'save.png', icon: 'EmotionHappy', palette: 'brand', note: '确认保存' },
  { dir: 'static/emoji', file: 'warn.png', icon: 'Attention', palette: 'warn', note: '积分不足' },
  { dir: 'static/emoji', file: 'ok.png', icon: 'CheckOne', palette: 'brand', note: '成功' },
  { dir: 'static/emoji', file: 'ticket.png', icon: 'Ticket', palette: 'warn', note: '兑换码' },
  { dir: 'static/emoji', file: 'search.png', icon: 'Search', palette: 'soft', note: '按 ID 查询' },
  { dir: 'static/emoji', file: 'empty.png', icon: 'Inbox', palette: 'soft', note: '空态备用' },
  { dir: 'static/emoji', file: 'guide.png', icon: 'GuideBoard', palette: 'guide', note: '使用引导' },
  { dir: 'static/emoji', file: 'feedback.png', icon: 'Mail', palette: 'mail', note: '意见反馈' },
  // pricing 套餐图
  { dir: 'static/pricing', file: 'month.png', icon: 'CalendarThirty', palette: 'month', note: '包月' },
  { dir: 'static/pricing', file: 'quarter.png', icon: 'Schedule', palette: 'quarter', note: '季卡' },
  { dir: 'static/pricing', file: 'year.png', icon: 'Crown', palette: 'year', note: '年卡' },
  { dir: 'static/pricing', file: 'points.png', icon: 'Gift', palette: 'points', note: '积分包1' },
  { dir: 'static/pricing', file: 'points2.png', icon: 'Diamond', palette: 'points2', note: '积分包2' },
  { dir: 'static/pricing', file: 'points3.png', icon: 'Star', palette: 'points3', note: '积分包3' },
];

function renderSvg(iconName, fill) {
  const fn = icons[iconName];
  if (typeof fn !== 'function') {
    throw new Error(`IconPark 无图标: ${iconName}`);
  }
  // two-tone：比 multi-color 更干净，贴合小程序卡片插图
  return fn({
    theme: 'two-tone',
    size: SIZE,
    fill: [fill[1], fill[3]],
    strokeWidth: 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });
}

async function main() {
  const rows = [];
  for (const item of ASSETS) {
    const fill = PALETTE[item.palette];
    const svg = renderSvg(item.icon, fill);
    const outDir = path.join(ROOT, item.dir);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, item.file);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
    const stat = fs.statSync(outPath);
    console.log('OK', item.file, '←', item.icon, `${stat.size}B`);
    rows.push(`| ${item.file} | ${item.icon} | ${item.note} |`);
  }

  const emojiReadme = `# IconPark 插图

装饰图来自 [IconPark](https://iconpark.oceanengine.com/)（\`@icon-park/svg\` two-tone）。

- 许可：**Apache-2.0**
- 生成：\`npm run icons:gen\`（需已安装 \`@icon-park/svg\`、\`sharp\`）

| File | IconPark | Use |
|------|----------|-----|
${rows.filter((_, i) => ASSETS[i].dir.includes('emoji')).join('\n')}
`;

  const pricingReadme = `# Pricing card illustrations

Graphics from [IconPark](https://iconpark.oceanengine.com/) two-tone PNG.

- License: **Apache-2.0**
- Regenerate: \`npm run icons:gen\`

| File | IconPark | Use |
|------|----------|-----|
${rows.filter((_, i) => ASSETS[i].dir.includes('pricing')).join('\n')}
`;

  fs.writeFileSync(path.join(ROOT, 'static/emoji/README.md'), emojiReadme, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'static/pricing/README.md'), pricingReadme, 'utf8');
  console.log('READMEs updated');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
