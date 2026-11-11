/**
 * 用 Kubai Icons 生成装饰图 / Tab PNG
 * 文档：https://icons.kubai.design/docs/static
 * 运行：npm run icons:gen
 *
 * UI 图标（kubai-icon）已改为远程 SVG，不再打进主包：
 *   https://icons.kubai.design/api/icon/{name}.svg?color=HEX
 * 可选离线备份：npm run icons:gen -- --ui-png
 */
const fs = require('fs');
const path = require('path');
const { fetchKubaiSvg, hexNoHash } = require('./lib/kubai');
const { writeKubaiPng } = require('./lib/write-kubai-png');

const ROOT = path.join(__dirname, '..');
const SIZE = 256;
const PRICING_SIZE = 200;
const TAB_SIZE = 81;
const UI_SIZE = 96;
const UI_PNG = process.argv.includes('--ui-png');
/** @deprecated 同 --ui-png */
const UI_ONLY = process.argv.includes('--ui') || UI_PNG;

/** 与旧 IconPark 调色板一致：主色 = Kubai accent */
const PALETTE = {
  brand: '07c160',
  soft: '64748b',
  warn: 'f59e0b',
  danger: 'ef4444',
  month: 'f59e0b',
  quarter: '3b82f6',
  year: 'a855f7',
  points: '10b981',
  points2: '06b6d4',
  points3: 'eab308',
  points4: 'f97316',
  points5: 'ec4899',
  preview: '8b5cf6',
  play: '1f2937',
  anim: 'ec4899',
  guide: 'f59e0b',
  mail: '3b82f6',
  xmas: 'c41e3a',
  xmasTree: '166534',
  xmasGift: 'c41e3a',
  cny: 'e34d59',
  tabIdle: 'c8c3bd',
  tabHome: '07c160',
  tabMy: 'fa9d3b',
};

/**
 * 装饰图：file ← kubai name + palette
 * @type {Array<{ dir: string, file: string, icon: string, palette: keyof typeof PALETTE, note: string }>}
 */
const ASSETS = [
  { dir: 'static/emoji', file: 'eyes.png', icon: 'eye', palette: 'preview', note: '预览空状态' },
  { dir: 'static/emoji', file: 'empty.png', icon: 'inbox', palette: 'preview', note: '列表空状态' },
  { dir: 'static/emoji', file: 'static.png', icon: 'image', palette: 'brand', note: '静态图' },
  { dir: 'static/emoji', file: 'anim.png', icon: 'clapperboard', palette: 'anim', note: '动态图' },
  { dir: 'static/emoji', file: 'save.png', icon: 'circle-check', palette: 'brand', note: '确认保存' },
  { dir: 'static/emoji', file: 'warn.png', icon: 'triangle-alert', palette: 'warn', note: '积分不足' },
  { dir: 'static/emoji', file: 'ok.png', icon: 'circle-check', palette: 'brand', note: '成功' },
  { dir: 'static/emoji', file: 'ticket.png', icon: 'ticket', palette: 'warn', note: '兑换码' },
  { dir: 'static/emoji', file: 'search.png', icon: 'search', palette: 'soft', note: '按 ID 查询' },
  { dir: 'static/emoji', file: 'guide.png', icon: 'map', palette: 'guide', note: '使用引导' },
  { dir: 'static/emoji', file: 'feedback.png', icon: 'mail', palette: 'mail', note: '意见反馈' },
  { dir: 'static/emoji', file: 'gift.png', icon: 'gift', palette: 'points', note: '见面礼弹窗' },
  { dir: 'static/emoji', file: 'checkin.png', icon: 'calendar', palette: 'month', note: '每日签到' },
  { dir: 'static/emoji', file: 'swipe-prev.png', icon: 'chevron-left', palette: 'preview', note: '滑向上一分类' },
  { dir: 'static/emoji', file: 'swipe-next.png', icon: 'chevron-right', palette: 'brand', note: '滑向下一分类' },
  { dir: 'static/emoji', file: 'swipe-end.png', icon: 'smile', palette: 'warn', note: '分类滑到头' },
  { dir: 'static/emoji', file: 'play.png', icon: 'play', palette: 'play', note: '详情预览视频' },
  { dir: 'static/emoji', file: 'type-all.png', icon: 'grid', palette: 'brand', note: '类型·全部' },
  { dir: 'static/emoji', file: 'type-emoji.png', icon: 'smile', palette: 'brand', note: '类型·表情' },
  { dir: 'static/emoji', file: 'type-wallpaper.png', icon: 'image', palette: 'preview', note: '类型·壁纸' },
  { dir: 'static/emoji', file: 'type-avatar.png', icon: 'user-round', palette: 'quarter', note: '类型·头像' },
  { dir: 'static/emoji', file: 'type-video.png', icon: 'video', palette: 'anim', note: '类型·视频' },
  { dir: 'static/emoji', file: 'type-caret.png', icon: 'chevron-down', palette: 'soft', note: '类型下拉箭头' },
  { dir: 'static/lottery', file: 'miss.png', icon: 'meh', palette: 'soft', note: '谢谢参与' },
  { dir: 'static/lottery', file: 'pts1.png', icon: 'ticket', palette: 'points', note: '1积分' },
  { dir: 'static/lottery', file: 'pts2.png', icon: 'gift', palette: 'points2', note: '2积分' },
  { dir: 'static/lottery', file: 'pts4.png', icon: 'gift-bag', palette: 'month', note: '4积分' },
  { dir: 'static/lottery', file: 'pts8.png', icon: 'trophy', palette: 'points3', note: '8积分' },
  { dir: 'static/lottery', file: 'pts12.png', icon: 'gem', palette: 'quarter', note: '12积分' },
  { dir: 'static/lottery', file: 'pts18.png', icon: 'crown', palette: 'year', note: '18积分大奖' },
  { dir: 'static/lottery', file: 'go.png', icon: 'sparkles', palette: 'brand', note: '中间抽奖钮' },
  { dir: 'static/pricing', file: 'month.png', icon: 'badge-percent', palette: 'month', note: '包月' },
  { dir: 'static/pricing', file: 'quarter.png', icon: 'user-star', palette: 'quarter', note: '季卡' },
  { dir: 'static/pricing', file: 'year.png', icon: 'crown', palette: 'year', note: '年卡' },
  { dir: 'static/pricing', file: 'points4.png', icon: 'wallet', palette: 'points4', note: '积分包¥1' },
  { dir: 'static/pricing', file: 'points5.png', icon: 'gift-card', palette: 'points5', note: '积分包¥2' },
  { dir: 'static/pricing', file: 'points.png', icon: 'ticket', palette: 'points', note: '积分包¥5' },
  { dir: 'static/pricing', file: 'points2.png', icon: 'gift', palette: 'points2', note: '积分包¥16' },
  { dir: 'static/pricing', file: 'points3.png', icon: 'sparkles', palette: 'points3', note: '积分包¥32' },
  { dir: 'static/festival/christmas', file: 'tree.png', icon: 'tree-pine', palette: 'xmasTree', note: '圣诞树角标' },
  { dir: 'static/festival/christmas', file: 'hat.png', icon: 'scarf', palette: 'xmas', note: '圣诞帽角标' },
  { dir: 'static/festival/christmas', file: 'gift.png', icon: 'gift', palette: 'xmasGift', note: '礼物角标' },
  { dir: 'static/festival/christmas', file: 'snow.png', icon: 'snowflake', palette: 'soft', note: '雪花' },
  { dir: 'static/festival/cny', file: 'lantern.png', icon: 'candle', palette: 'cny', note: '春节角标' },
  { dir: 'static/festival/cny', file: 'fu.png', icon: 'party-popper', palette: 'cny', note: '福礼角标' },
];

const TAB_ASSETS = [
  { file: 'home.png', icon: 'home', color: PALETTE.tabIdle, note: '首页·未选中' },
  { file: 'home-active.png', icon: 'home', color: PALETTE.tabHome, note: '首页·选中' },
  { file: 'my.png', icon: 'user', color: PALETTE.tabIdle, note: '我的·未选中' },
  { file: 'my-active.png', icon: 'user', color: PALETTE.tabMy, note: '我的·选中' },
];

/** 主题 / 类型 / 分类色（给动态 tint 的 UI 图标预生成） */
const THEME_BRANDS = ['07c160', '0052d9', 'ed7b2f', '8b5cf6', 'ec4899', '0891b2', 'e34d59'];
const CONTENT_COLORS = ['07c160', '8b5cf6', '3b82f6', 'ec4899'];
/** 分类色 + 浅色 remap 后的深色（见 utils/kubaiIcon LIGHT_ACCENT_TO_ICON） */
const CATEGORY_COLORS = [
  '2f80ed', 'b36b00', '7a3db8', 'c9347a', '0e7490', '4f46e5', '078d85', 'd97706',
  'c2410c', '07c160', 'd54941', '6d28d9', 'e11d48', '65a30d', '0284c7', 'c026d3',
  '9a3412', '475569', 'ca8a04',
];

/**
 * UI 图标：固定 (name, color) → static/kubai-ui/{name}__{hex}.png
 * name 已是 Kubai kebab-case（与 utils/kubaiIcon ALIAS 目标名一致）
 */
function buildUiJobs() {
  /** @type {Map<string, { icon: string, color: string }>} */
  const map = new Map();
  const add = (icon, color) => {
    const hex = hexNoHash(color);
    map.set(`${icon}__${hex}`, { icon, color: hex });
  };

  const fixed = [
    ['search', '56ccf2'],
    ['chevron-right', '999999'],
    ['chevron-right', '828282'],
    ['circle-x', '999999'],
    ['circle-x', '828282'],
    ['star', 'f2c94c'],
    ['heart', 'eb5757'],
    ['file', '2f80ed'],
    ['shield-check', '27ae60'],
    ['shield-check', '07c160'],
    ['image', '828282'],
    ['image', '999999'],
    ['gift', 'c41e3a'],
    ['gift', 'f2994a'],
    ['gift', 'f8fafc'],
    ['ticket', '07c160'],
    ['badge-percent', 'ed7b2f'],
    ['list-ordered', '27ae60'],
    ['clapperboard', '0052d9'],
    ['chart-bar', '2d9cdb'],
    ['cloud-upload', '2f80ed'],
    ['list-view', '9b51e0'],
    ['crown', 'eb5757'],
    ['crown', 'bb6bd9'],
    ['crown', 'f8fafc'],
    ['user', 'bb6bd9'],
    ['rotate-cw', '0052d9'],
    ['mail', 'e34d59'],
    ['circle-help', '27ae60'],
    ['message-circle', '0052d9'],
    ['info', '828282'],
    ['volume-off', '999999'],
    ['circle', 'bbbbbb'],
    ['circle', 'e5e7eb'],
    ['circle-check', 'f8fafc'],
  ];
  fixed.forEach(([icon, color]) => add(icon, color));

  [
    'layout-dashboard',
    'bookmark',
    'bell',
    'circle-check',
    'search',
    'chevron-left',
    'volume',
    'circle',
  ].forEach((icon) => {
    THEME_BRANDS.forEach((c) => add(icon, c));
  });
  CONTENT_COLORS.forEach((c) => add('circle-check', c));
  CATEGORY_COLORS.forEach((c) => add('circle-check', c));

  return [...map.values()];
}

/** 按实心像素居中写入，避免 Kubai 底部柔光把图形顶上去 */
async function writePng(outPath, svgBuf, size) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const target = size || SIZE;
  await writeKubaiPng(outPath, svgBuf, target);
  return fs.statSync(outPath);
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function main() {
  const rows = [];
  const tabRows = [];

  if (!UI_ONLY) {
    console.log('Generating decorative assets…');
    await mapPool(ASSETS, 4, async (item) => {
      const color = PALETTE[item.palette];
      const isPricing = item.dir.includes('pricing');
      const iconSize = isPricing ? PRICING_SIZE : SIZE;
      const svg = await fetchKubaiSvg(item.icon, { color, size: iconSize });
      const outPath = path.join(ROOT, item.dir, item.file);
      const stat = await writePng(outPath, svg, isPricing ? PRICING_SIZE : null);
      console.log('OK', item.file, '←', item.icon, `#${color}`, `${stat.size}B`);
      rows.push({ item, line: `| ${item.file} | ${item.icon} | ${item.note} |` });
    });

    console.log('Generating tab icons…');
    for (const item of TAB_ASSETS) {
      const svg = await fetchKubaiSvg(item.icon, { color: item.color, size: TAB_SIZE });
      const outPath = path.join(ROOT, 'static/tab', item.file);
      const stat = await writePng(outPath, svg, TAB_SIZE);
      console.log('OK', item.file, '←', item.icon, `#${item.color}`, `${stat.size}B`);
      tabRows.push(`| ${item.file} | ${item.icon} | #${item.color} | ${item.note} |`);
    }
  }

  const uiDir = path.join(ROOT, 'static/kubai-ui');
  fs.mkdirSync(uiDir, { recursive: true });
  if (UI_PNG || process.argv.includes('--ui')) {
    const uiJobs = buildUiJobs();
    console.log(`Generating offline UI PNG backup (${uiJobs.length})…`);
    await mapPool(uiJobs, 4, async (job) => {
      const svg = await fetchKubaiSvg(job.icon, { color: job.color, size: UI_SIZE });
      const file = `${job.icon}__${job.color}.png`;
      const outPath = path.join(uiDir, file);
      const stat = await writePng(outPath, svg, UI_SIZE);
      console.log('OK', file, `${stat.size}B`);
    });
  } else {
    console.log('Skip UI PNG（kubai-icon 使用远程 SVG，见 utils/kubaiIcon.js）');
  }

  const header = (title) => `# ${title}

装饰图来自 [Kubai Icons](https://icons.kubai.design/)（Color 变体）。

- 许可：见 [Kubai License](https://icons.kubai.design/)
- 生成：\`npm run icons:gen\`
`;

  if (!UI_ONLY) {
    const emojiLines = rows.filter((r) => r.item.dir.includes('emoji')).map((r) => r.line);
    const pricingLines = rows.filter((r) => r.item.dir.includes('pricing')).map((r) => r.line);
    const lotteryLines = rows.filter((r) => r.item.dir.includes('lottery')).map((r) => r.line);
    const festivalLines = rows.filter((r) => r.item.dir.includes('festival')).map((r) => r.line);

    fs.writeFileSync(
      path.join(ROOT, 'static/emoji/README.md'),
      `${header('Kubai 插图')}\n| File | Kubai | Use |\n|------|-------|-----|\n${emojiLines.join('\n')}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(ROOT, 'static/pricing/README.md'),
      `${header('Pricing card illustrations')}\n- Size: **200×200**\n\n| File | Kubai | Use |\n|------|-------|-----|\n${pricingLines.join('\n')}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(ROOT, 'static/lottery/README.md'),
      `${header('九宫格奖池插图')}\n| File | Kubai | Use |\n|------|-------|-----|\n${lotteryLines.join('\n')}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(ROOT, 'static/tab/README.md'),
      `# Tab bar icons

Icons from [Kubai Icons](https://icons.kubai.design/).

- Regenerate: \`npm run icons:gen\`

| File | Kubai | Color | Use |
|------|-------|-------|-----|
${tabRows.join('\n')}
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(ROOT, 'static/festival/README.md'),
      `${header('节日装饰素材')}\n- 配置：\`utils/festival.js\`\n\n| File | Kubai | Use |\n|------|-------|-----|\n${festivalLines.join('\n')}\n`,
      'utf8',
    );
  }

  fs.writeFileSync(
    path.join(ROOT, 'static/kubai-ui/README.md'),
    `# Kubai UI icons

\`<kubai-icon name color size />\` 使用 **远程 SVG**（不进代码包）：

\`https://icons.kubai.design/api/icon/{name}.svg?color={hex}&size=${UI_SIZE}\`

- 组件：\`components/kubai-icon\`
- 解析：\`utils/kubaiIcon.js\` → Kubai [Static SVG API](https://icons.kubai.design/docs/static/)
- 后台：将 \`icons.kubai.design\` 加入 **downloadFile 合法域名**
- 可选离线 PNG 备份（默认不打包）：\`npm run icons:gen -- --ui-png\`
`,
    'utf8',
  );

  console.log('READMEs updated. Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
