/**
 * 把任意比例 AI/设计图裁成节日顶栏 / 底栏规格（项目已有 sharp）
 *
 * 用法：
 *   node scripts/fit-festival-image.js --in ./raw.png --out ./banner.png --kind banner
 *   node scripts/fit-festival-image.js --in ./raw.png --out ./bank.png --kind bank
 *   node scripts/fit-festival-image.js --in ./raw.png --out ./banner.png --kind banner --gravity top --fade
 *
 * 推荐工作流：
 *   1) AI 用常见比例出图（16:9 / 3:1 / 21:9 / 1:1 均可）
 *   2) 本脚本 cover 裁切到 750×200（顶栏）或 750×160（底栏）
 *   3) 顶栏可加 --fade 底部渐隐；底栏默认贴底裁，适合雪堆/角色在画面下方
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SPECS = {
  banner: { width: 750, height: 200, label: '导航顶栏' },
  bank: { width: 750, height: 160, label: '底栏背景' },
};

function parseArgs(argv) {
  const out = {
    in: '',
    out: '',
    kind: 'banner',
    gravity: '',
    fade: false,
    pad: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--in') out.in = argv[++i] || '';
    else if (a === '--out') out.out = argv[++i] || '';
    else if (a === '--kind') out.kind = String(argv[++i] || 'banner').trim();
    else if (a === '--gravity') out.gravity = String(argv[++i] || '').trim();
    else if (a === '--fade') out.fade = true;
    else if (a === '--pad') out.pad = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`fit-festival-image — 任意图 → 节日条带规格

Options:
  --in <path>        输入图（任意比例）
  --out <path>       输出 PNG
  --kind banner|bank 顶栏 750×200 / 底栏 750×160
  --gravity top|center|bottom|north|south  cover 裁切重心（默认：banner=top，bank=bottom）
  --fade             仅 banner：底部渐隐透明（衔接下方页面）
  --pad              不裁切：等比缩放入画布，透明/留白补边（适合异形贴纸）

Examples:
  npm run festival:fit -- --in raw-xmas.png --out static/festival/christmas/banner.png --kind banner --fade
  npm run festival:fit -- --in raw-bank.png --out out-bank.png --kind bank --gravity bottom
`);
}

async function fadeBottom(img, width, height) {
  /* 下 40% 渐隐到透明 */
  const stops = [];
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    let a = 255;
    if (t > 0.6) a = Math.round(255 * (1 - (t - 0.6) / 0.4));
    stops.push(a);
  }
  const alpha = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    alpha.fill(stops[y], y * width, (y + 1) * width);
  }
  const mask = await sharp(alpha, {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();

  return sharp(img)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.in || !args.out) {
    printHelp();
    if (!args.help && (!args.in || !args.out)) process.exit(1);
    return;
  }

  const kind = args.kind === 'bank' ? 'bank' : 'banner';
  const spec = SPECS[kind];
  const input = path.resolve(args.in);
  const output = path.resolve(args.out);

  if (!fs.existsSync(input)) {
    console.error('输入不存在:', input);
    process.exit(1);
  }

  const gravity =
    args.gravity ||
    (kind === 'bank' ? 'south' : 'north');
  const position =
    gravity === 'top' || gravity === 'north'
      ? 'north'
      : gravity === 'bottom' || gravity === 'south'
        ? 'south'
        : 'centre';

  let pipeline = sharp(input).rotate();

  if (args.pad) {
    pipeline = pipeline.resize(spec.width, spec.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      position,
    });
  } else {
    pipeline = pipeline.resize(spec.width, spec.height, {
      fit: 'cover',
      position,
    });
  }

  let buf = await pipeline.ensureAlpha().png().toBuffer();

  if (args.fade && kind === 'banner') {
    buf = await fadeBottom(buf, spec.width, spec.height);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, buf);
  console.log(
    `OK ${spec.label} ${spec.width}×${spec.height} → ${path.relative(process.cwd(), output)}` +
      (args.fade ? ' (fade)' : '') +
      (args.pad ? ' (pad)' : ` (cover/${position})`),
  );
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
