/**
 * 用 IconPark 生成 static/emoji、static/pricing、static/tab PNG
 * 运行：node scripts/generate-iconpark-assets.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const icons = require('@icon-park/svg');

const ROOT = path.join(__dirname, '..');
/** 弹窗/卡片装饰图；256 足够清晰且可把整包图片总量压到 200KB 内 */
const SIZE = 256;
/** 微信虚拟支付道具图强制 200×200 */
const PRICING_SIZE = 200;
const TAB_SIZE = 81;

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
  /** 叠在视频上：深底白三角，别用品牌绿显得花哨 */
  play: ['#1f2937', '#ffffff', '#ffffff', '#1f2937'],
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
  { dir: 'static/emoji', file: 'empty.png', icon: 'Ghost', palette: 'preview', note: '列表空状态' },
  { dir: 'static/emoji', file: 'static.png', icon: 'PictureOne', palette: 'brand', note: '静态图' },
  { dir: 'static/emoji', file: 'anim.png', icon: 'Film', palette: 'anim', note: '动态图' },
  { dir: 'static/emoji', file: 'save.png', icon: 'EmotionHappy', palette: 'brand', note: '确认保存' },
  { dir: 'static/emoji', file: 'warn.png', icon: 'Attention', palette: 'warn', note: '积分不足' },
  { dir: 'static/emoji', file: 'ok.png', icon: 'CheckOne', palette: 'brand', note: '成功' },
  { dir: 'static/emoji', file: 'ticket.png', icon: 'Ticket', palette: 'warn', note: '兑换码' },
  { dir: 'static/emoji', file: 'search.png', icon: 'Search', palette: 'soft', note: '按 ID 查询' },
  { dir: 'static/emoji', file: 'guide.png', icon: 'GuideBoard', palette: 'guide', note: '使用引导' },
  { dir: 'static/emoji', file: 'feedback.png', icon: 'Mail', palette: 'mail', note: '意见反馈' },
  { dir: 'static/emoji', file: 'gift.png', icon: 'Gift', palette: 'points', note: '见面礼弹窗' },
  { dir: 'static/emoji', file: 'checkin.png', icon: 'Calendar', palette: 'month', note: '每日签到' },
  { dir: 'static/emoji', file: 'swipe-prev.png', icon: 'LeftC', palette: 'preview', note: '滑向上一分类' },
  { dir: 'static/emoji', file: 'swipe-next.png', icon: 'RightC', palette: 'brand', note: '滑向下一分类' },
  { dir: 'static/emoji', file: 'swipe-end.png', icon: 'SmilingFace', palette: 'warn', note: '分类滑到头' },
  { dir: 'static/emoji', file: 'play.png', icon: 'Play', palette: 'play', note: '详情预览视频' },
  { dir: 'static/lottery', file: 'miss.png', icon: 'DisappointedFace', palette: 'soft', note: '谢谢参与' },
  { dir: 'static/lottery', file: 'pts1.png', icon: 'Ticket', palette: 'points', note: '1积分' },
  { dir: 'static/lottery', file: 'pts2.png', icon: 'Gift', palette: 'points2', note: '2积分' },
  { dir: 'static/lottery', file: 'pts4.png', icon: 'GiftBox', palette: 'month', note: '4积分' },
  { dir: 'static/lottery', file: 'pts8.png', icon: 'Trophy', palette: 'points3', note: '8积分' },
  { dir: 'static/lottery', file: 'pts12.png', icon: 'Diamond', palette: 'quarter', note: '12积分' },
  { dir: 'static/lottery', file: 'pts18.png', icon: 'Crown', palette: 'year', note: '18积分大奖' },
  { dir: 'static/lottery', file: 'go.png', icon: 'GiftBox', palette: 'brand', note: '中间抽奖钮' },
  // pricing 套餐图（优惠感：券/VIP/皇冠/闪电）
  { dir: 'static/pricing', file: 'month.png', icon: 'Coupon', palette: 'month', note: '包月' },
  { dir: 'static/pricing', file: 'quarter.png', icon: 'VipOne', palette: 'quarter', note: '季卡' },
  { dir: 'static/pricing', file: 'year.png', icon: 'Crown', palette: 'year', note: '年卡' },
  { dir: 'static/pricing', file: 'points.png', icon: 'Ticket', palette: 'points', note: '积分包1' },
  { dir: 'static/pricing', file: 'points2.png', icon: 'Gift', palette: 'points2', note: '积分包2' },
  { dir: 'static/pricing', file: 'points3.png', icon: 'Lightning', palette: 'points3', note: '积分包3' },
];

/** 底栏：未选中 outline / 选中 filled（实心） */
const TAB_ASSETS = [
  { file: 'home.png', icon: 'Home', theme: 'outline', color: '#C8C3BD', note: '首页·未选中' },
  { file: 'home-active.png', icon: 'Home', theme: 'filled', color: '#07C160', note: '首页·选中' },
  { file: 'publish.png', icon: 'UploadOne', theme: 'outline', color: '#C8C3BD', note: '发布·未选中' },
  { file: 'publish-active.png', icon: 'UploadOne', theme: 'filled', color: '#07C160', note: '发布·选中' },
  { file: 'my.png', icon: 'Me', theme: 'outline', color: '#C8C3BD', note: '我的·未选中' },
  { file: 'my-active.png', icon: 'Me', theme: 'filled', color: '#FA9D3B', note: '我的·选中' },
];

function renderSvg(iconName, fill, size = SIZE) {
  const fn = icons[iconName];
  if (typeof fn !== 'function') {
    throw new Error(`IconPark 无图标: ${iconName}`);
  }
  // two-tone：比 multi-color 更干净，贴合小程序卡片插图
  return fn({
    theme: 'two-tone',
    size,
    fill: [fill[1], fill[3]],
    strokeWidth: 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });
}

function renderTabSvg(iconName, theme, color) {
  const fn = icons[iconName];
  if (typeof fn !== 'function') {
    throw new Error(`IconPark 无图标: ${iconName}`);
  }
  return fn({
    theme,
    size: TAB_SIZE,
    fill: color,
    strokeWidth: theme === 'outline' ? 4 : 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });
}

async function writePng(outPath, svg, size) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  let pipeline = sharp(Buffer.from(svg));
  if (size) {
    pipeline = pipeline.resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } });
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(outPath);
  return fs.statSync(outPath);
}

async function main() {
  const rows = [];
  for (const item of ASSETS) {
    const fill = PALETTE[item.palette];
    const isPricing = item.dir.includes('pricing');
    const iconSize = isPricing ? PRICING_SIZE : SIZE;
    const svg = renderSvg(item.icon, fill, iconSize);
    const outPath = path.join(ROOT, item.dir, item.file);
    const stat = await writePng(outPath, svg, isPricing ? PRICING_SIZE : null);
    console.log('OK', item.file, '←', item.icon, isPricing ? '200x200' : '', `${stat.size}B`);
    rows.push(`| ${item.file} | ${item.icon} | ${item.note} |`);
  }

  const tabRows = [];
  for (const item of TAB_ASSETS) {
    const svg = renderTabSvg(item.icon, item.theme, item.color);
    const outPath = path.join(ROOT, 'static/tab', item.file);
    const stat = await writePng(outPath, svg);
    console.log('OK', item.file, '←', item.icon, item.theme, `${stat.size}B`);
    tabRows.push(`| ${item.file} | ${item.icon} | ${item.theme} | ${item.note} |`);
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
- Size: **200×200**（微信虚拟支付道具图强制尺寸）
- Regenerate: \`npm run icons:gen\`

| File | IconPark | Use |
|------|----------|-----|
${rows.filter((_, i) => ASSETS[i].dir.includes('pricing')).join('\n')}
`;

  const tabReadme = `# Tab bar icons

Icons from [IconPark](https://iconpark.oceanengine.com/) (\`@icon-park/svg\`).

- License: **Apache-2.0**
- Regenerate: \`npm run icons:gen\`
- Idle: \`outline\` · Active: \`filled\`

| File | IconPark | Theme | Use |
|------|----------|-------|-----|
${tabRows.join('\n')}
`;

  const lotteryReadme = `# 九宫格奖池插图

装饰图来自 [IconPark](https://iconpark.oceanengine.com/)（\`@icon-park/svg\` two-tone）。

- 许可：**Apache-2.0**
- 生成：\`npm run icons:gen\`

| File | IconPark | Use |
|------|----------|-----|
${rows.filter((_, i) => ASSETS[i].dir.includes('lottery')).join('\n')}
`;

  fs.writeFileSync(path.join(ROOT, 'static/emoji/README.md'), emojiReadme, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'static/pricing/README.md'), pricingReadme, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'static/lottery/README.md'), lotteryReadme, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'static/tab/README.md'), tabReadme, 'utf8');
  console.log('READMEs updated');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
