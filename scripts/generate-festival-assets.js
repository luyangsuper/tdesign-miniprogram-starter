/**
 * 生成节日 Theme Assets
 * 运行：npm run festival:gen
 *
 * 灯带灯泡坐标需与 components/festival-decor buildBulbs 保持一致
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const icons = require('@icon-park/svg');

const ROOT = path.join(__dirname, '..');

/** 圣诞灯带：11 盏，viewBox 750×80 —— 更弯更大光晕，贴导航底缘 */
const XMAS_BULBS = [
  { x: 42, color: '#ef4444' },
  { x: 110, color: '#22c55e' },
  { x: 178, color: '#fbbf24' },
  { x: 246, color: '#f8fafc' },
  { x: 314, color: '#ef4444' },
  { x: 382, color: '#22c55e' },
  { x: 450, color: '#fbbf24' },
  { x: 518, color: '#f8fafc' },
  { x: 586, color: '#ef4444' },
  { x: 654, color: '#22c55e' },
  { x: 710, color: '#fbbf24' },
];

function iconSvg(name, fills, size = 128) {
  const fn = icons[name];
  if (typeof fn !== 'function') throw new Error(`IconPark 无图标: ${name}`);
  return fn({
    theme: 'two-tone',
    size,
    fill: fills,
    strokeWidth: 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });
}

async function writePng(filePath, svg, w, h) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp(Buffer.from(svg))
    .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(filePath);
  console.log('OK', path.relative(ROOT, filePath));
}

function wireY(i) {
  return 24 + Math.sin(i * 0.95) * 18;
}

/** 水滴形彩灯 + 更大柔光，波浪更明显 */
function christmasHeaderSvg() {
  const W = 750;
  const H = 80;
  const pts = XMAS_BULBS.map((b, i) => ({ ...b, y: wireY(i) }));
  const wire = `M18 30 ${pts.map((p) => `L ${p.x} ${p.y}`).join(' ')} L 732 28`;

  const bulbs = pts
    .map((p) => {
      const by = p.y + 20;
      return `
      <ellipse cx="${p.x}" cy="${by + 2}" rx="14" ry="16" fill="${p.color}" opacity="0.32"/>
      <rect x="${p.x - 4}" y="${p.y + 2}" width="8" height="7" rx="1.4" fill="#6b7280"/>
      <rect x="${p.x - 3}" y="${p.y + 1}" width="6" height="3.5" rx="0.8" fill="#9ca3af"/>
      <path d="M${p.x} ${p.y + 8}
        C ${p.x + 9} ${p.y + 13}, ${p.x + 10} ${p.y + 24}, ${p.x} ${p.y + 32}
        C ${p.x - 10} ${p.y + 24}, ${p.x - 9} ${p.y + 13}, ${p.x} ${p.y + 8} Z"
        fill="${p.color}"/>
      <ellipse cx="${p.x - 2.5}" cy="${p.y + 15}" rx="2.5" ry="3.6" fill="#fff" opacity="0.45"/>
    `;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="${wire}" fill="none" stroke="#14532d" stroke-width="9" stroke-linecap="round" opacity="0.4"/>
  <path d="${wire}" fill="none" stroke="#1f2937" stroke-width="2.6" stroke-linecap="round"/>
  ${bulbs}
</svg>`;
}

function cnyHeaderSvg() {
  const W = 750;
  const H = 80;
  const xs = [80, 190, 300, 410, 520, 640];
  const wire = `M30 30 ${xs
    .map((x, i) => `L ${x} ${24 + Math.sin(i * 1.15) * 16}`)
    .join(' ')} L 720 28`;
  const bulbs = xs
    .map((x, i) => {
      const y = 24 + Math.sin(i * 1.15) * 16;
      const c = i % 2 ? '#fbbf24' : '#dc2626';
      return `
      <ellipse cx="${x}" cy="${y + 20}" rx="12" ry="14" fill="${c}" opacity="0.3"/>
      <rect x="${x - 3.5}" y="${y + 2}" width="7" height="6" rx="1.2" fill="#92400e"/>
      <path d="M${x} ${y + 8} C ${x + 8} ${y + 12}, ${x + 9} ${y + 22}, ${x} ${y + 28}
        C ${x - 9} ${y + 22}, ${x - 8} ${y + 12}, ${x} ${y + 8} Z" fill="${c}"/>
      <ellipse cx="${x - 2}" cy="${y + 14}" rx="2" ry="3" fill="#fff" opacity="0.4"/>
    `;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="${wire}" fill="none" stroke="#b45309" stroke-width="3.2" stroke-linecap="round"/>
  ${bulbs}
</svg>`;
}

/** 底栏顶缘矮积雪（挂在 custom-tab-bar 上，不是浮在列表中间） */
function snowBankSvg() {
  const W = 750;
  const H = 72;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="M-10 38
    C 70 12, 140 28, 220 8
    C 300 -8, 380 24, 470 6
    C 560 -10, 640 20, 760 8
    L 760 80 L -10 80 Z" fill="#64748b" opacity="0.35"/>
  <path d="M-10 44
    C 80 18, 160 34, 250 14
    C 340 0, 420 30, 510 14
    C 600 2, 680 26, 760 16
    L 760 80 L -10 80 Z" fill="#e2e8f0"/>
  <path d="M-10 52
    C 100 32, 200 48, 310 30
    C 410 16, 520 46, 620 32
    C 690 24, 730 40, 760 34
    L 760 80 L -10 80 Z" fill="#ffffff"/>
  <circle cx="120" cy="28" r="1.8" fill="#fff"/>
  <circle cx="340" cy="22" r="1.4" fill="#fff"/>
  <circle cx="560" cy="26" r="1.6" fill="#fff"/>
</svg>`;
}

function cnyBankSvg() {
  const W = 750;
  const H = 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="M0 28 C 100 8, 200 24, 320 6 C 440 -8, 560 22, 750 10 L 750 60 L 0 60 Z"
    fill="#fbbf24" opacity="0.5"/>
  <path d="M0 36 C 120 18, 240 32, 380 16 C 500 4, 620 28, 750 20 L 750 60 L 0 60 Z"
    fill="#dc2626" opacity="0.32"/>
  <path d="M0 44 C 140 32, 280 42, 420 30 C 560 20, 660 38, 750 34 L 750 60 L 0 60 Z"
    fill="#fef3c7" opacity="0.75"/>
</svg>`;
}

/** 软冬青绿叶+红果：从左上角探出，无粗黑描边贴纸感 */
function xmasCornerLeftSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <radialGradient id="berry" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#fecaca"/><stop offset="55%" stop-color="#ef4444"/><stop offset="100%" stop-color="#b91c1c"/>
    </radialGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#86efac"/><stop offset="50%" stop-color="#16a34a"/><stop offset="100%" stop-color="#14532d"/>
    </linearGradient>
  </defs>
  <!-- 从角落伸出的冬青 -->
  <g transform="translate(-8,-12) rotate(-18 40 40)" opacity="0.95">
    <ellipse cx="52" cy="48" rx="28" ry="14" fill="url(#leaf)" transform="rotate(-35 52 48)"/>
    <ellipse cx="70" cy="62" rx="26" ry="13" fill="url(#leaf)" transform="rotate(18 70 62)"/>
    <ellipse cx="44" cy="72" rx="24" ry="12" fill="url(#leaf)" transform="rotate(-55 44 72)"/>
    <ellipse cx="78" cy="40" rx="22" ry="11" fill="url(#leaf)" transform="rotate(48 78 40)"/>
    <circle cx="58" cy="58" r="7" fill="url(#berry)"/>
    <circle cx="70" cy="52" r="5.5" fill="url(#berry)"/>
    <circle cx="64" cy="68" r="5" fill="url(#berry)"/>
    <circle cx="55" cy="54" r="2" fill="#fff" opacity="0.35"/>
  </g>
</svg>`;
}

/** 右上：柔和红丝绒结 + 小铃铛，贴角不抢标题 */
function xmasCornerRightSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <linearGradient id="bow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f87171"/><stop offset="45%" stop-color="#dc2626"/><stop offset="100%" stop-color="#991b1b"/>
    </linearGradient>
    <radialGradient id="knot" cx="40%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#fca5a5"/><stop offset="100%" stop-color="#b91c1c"/>
    </radialGradient>
  </defs>
  <g transform="translate(28,8) rotate(12 60 50)" opacity="0.94">
    <path d="M60 48 C 28 22, 8 48, 28 68 C 40 78, 52 62, 60 52 Z" fill="url(#bow)"/>
    <path d="M60 48 C 92 22, 112 48, 92 68 C 80 78, 68 62, 60 52 Z" fill="url(#bow)"/>
    <ellipse cx="60" cy="52" rx="12" ry="10" fill="url(#knot)"/>
    <path d="M52 58 Q 44 92 36 118" stroke="#b91c1c" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.9"/>
    <path d="M68 58 Q 78 92 88 116" stroke="#dc2626" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.9"/>
    <circle cx="58" cy="48" r="3" fill="#fff" opacity="0.28"/>
  </g>
</svg>`;
}

/** 春节左上：柔和红灯笼 */
function cnyCornerLeftSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <radialGradient id="lantern" cx="40%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#fecaca"/><stop offset="40%" stop-color="#ef4444"/><stop offset="100%" stop-color="#991b1b"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fde68a"/><stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <g transform="translate(18,10)" opacity="0.94">
    <rect x="48" y="18" width="24" height="8" rx="2" fill="url(#gold)"/>
    <ellipse cx="60" cy="58" rx="32" ry="38" fill="url(#lantern)"/>
    <ellipse cx="60" cy="58" rx="26" ry="32" fill="none" stroke="#fbbf24" stroke-width="2" opacity="0.55"/>
    <rect x="46" y="92" width="28" height="7" rx="2" fill="url(#gold)"/>
    <path d="M60 99 L60 128" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
    <circle cx="60" cy="132" r="4" fill="#fbbf24"/>
    <ellipse cx="48" cy="48" rx="8" ry="12" fill="#fff" opacity="0.18"/>
  </g>
</svg>`;
}

/** 春节右上：小福袋/元宝感 */
function cnyCornerRightSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <radialGradient id="ingot" cx="45%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#fef3c7"/><stop offset="55%" stop-color="#fbbf24"/><stop offset="100%" stop-color="#b45309"/>
    </radialGradient>
  </defs>
  <g transform="translate(20,24) rotate(8 60 50)" opacity="0.94">
    <path d="M28 62 C 28 42, 48 30, 70 30 C 92 30, 112 42, 112 62
      C 112 78, 98 88, 70 88 C 42 88, 28 78, 28 62 Z" fill="url(#ingot)"/>
    <ellipse cx="70" cy="48" rx="34" ry="12" fill="#fde68a" opacity="0.55"/>
    <path d="M40 58 Q 70 72 100 58" fill="none" stroke="#b45309" stroke-width="2" opacity="0.35"/>
    <ellipse cx="55" cy="44" rx="6" ry="4" fill="#fff" opacity="0.35"/>
  </g>
</svg>`;
}

async function writeCorner(filePath, svg) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(filePath);
  console.log('OK', path.relative(ROOT, filePath));
}

/** 首页顶栏背景图规格：750×200（与 utils/festival FESTIVAL_BANNER_SPEC 一致，仅导航区） */
function xmasBannerSvg() {
  const W = 750;
  const H = 200;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="xwash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#165B33" stop-opacity="1"/>
      <stop offset="18%" stop-color="#1a7a45" stop-opacity="0.95"/>
      <stop offset="42%" stop-color="#C41E3A" stop-opacity="0.92"/>
      <stop offset="62%" stop-color="#D3959B" stop-opacity="0.75"/>
      <stop offset="78%" stop-color="#BFE6BA" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glowL" cx="15%" cy="20%" r="45%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowR" cx="85%" cy="25%" r="40%">
      <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#xwash)"/>
  <rect width="${W}" height="${H}" fill="url(#glowL)"/>
  <rect width="${W}" height="${H}" fill="url(#glowR)"/>
</svg>`;
}

/** 春节顶栏背景图：750×200（仅导航区） */
function cnyBannerSvg() {
  const W = 750;
  const H = 200;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="cwash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9B1C1C" stop-opacity="1"/>
      <stop offset="28%" stop-color="#DC2626" stop-opacity="0.95"/>
      <stop offset="52%" stop-color="#F59E0B" stop-opacity="0.7"/>
      <stop offset="72%" stop-color="#FEF3C7" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#FFFBEB" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="cgold" cx="50%" cy="15%" r="50%">
      <stop offset="0%" stop-color="#fde68a" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#fde68a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#cwash)"/>
  <rect width="${W}" height="${H}" fill="url(#cgold)"/>
</svg>`;
}

/** 飘落粒子：IconPark → 小 PNG（比 emoji/文字自然很多） */
const PARTICLE_SIZE = 72;
const PARTICLES = [
  { file: 'snowflake.png', icon: 'Snowflake', fills: ['#e2e8f0', '#ffffff'] },
  { file: 'tree.png', icon: 'ChristmasTree', fills: ['#166534', '#86efac'] },
  { file: 'gift.png', icon: 'Gift', fills: ['#c41e3a', '#fbbf24'] },
  { file: 'heart.png', icon: 'Heart', fills: ['#e11d48', '#fda4af'] },
  { file: 'heart-soft.png', icon: 'OvalLove', fills: ['#be185d', '#f9a8d4'] },
  { file: 'flower.png', icon: 'GeometricFlowers', fills: ['#db2777', '#fbcfe8'] },
  { file: 'cherry.png', icon: 'Cherry', fills: ['#e11d48', '#fecdd3'] },
  { file: 'lantern.png', icon: 'Fireworks', fills: ['#f59e0b', '#fde68a'] },
  { file: 'red-packet.png', icon: 'RedEnvelope', fills: ['#dc2626', '#fde68a'] },
  { file: 'gift-box.png', icon: 'GiftBox', fills: ['#e34d59', '#fbbf24'] },
  { file: 'leaf.png', icon: 'Leaf', fills: ['#16a34a', '#86efac'] },
  { file: 'bowl.png', icon: 'Bowl', fills: ['#15803d', '#bbf7d0'] },
  { file: 'rice.png', icon: 'Rice', fills: ['#ca8a04', '#fef08a'] },
  { file: 'boat.png', icon: 'Sailboat', fills: ['#0f766e', '#99f6e4'] },
  { file: 'moon.png', icon: 'Moon', fills: ['#d97706', '#fde68a'] },
  { file: 'cake.png', icon: 'CakeOne', fills: ['#b45309', '#fde68a'] },
  { file: 'rabbit.png', icon: 'Rabbit', fills: ['#a8a29e', '#f5f5f4'] },
  { file: 'book.png', icon: 'BookOpen', fills: ['#0d9488', '#99f6e4'] },
  { file: 'ruler.png', icon: 'TriangleRuler', fills: ['#64748b', '#cbd5e1'] },
  { file: 'pencil.png', icon: 'Pencil', fills: ['#334155', '#94a3b8'] },
  { file: 'apple.png', icon: 'AppleOne', fills: ['#ef4444', '#fecaca'] },
  { file: 'egg.png', icon: 'PaintedEggshell', fills: ['#a78bfa', '#ddd6fe'] },
  { file: 'balloon.png', icon: 'PartyBalloon', fills: ['#3b82f6', '#bfdbfe'] },
  { file: 'candy.png', icon: 'Candy', fills: ['#ec4899', '#fbcfe8'] },
  { file: 'ghost.png', icon: 'Ghost', fills: ['#64748b', '#f1f5f9'] },
  { file: 'pumpkin.png', icon: 'Pumpkin', fills: ['#ea580c', '#fdba74'] },
  { file: 'bat.png', icon: 'Bat', fills: ['#5b21b6', '#c4b5fd'] },
  { file: 'owl.png', icon: 'Owl', fills: ['#7c3aed', '#ddd6fe'] },
  { file: 'turkey.png', icon: 'Turkey', fills: ['#b45309', '#fbbf24'] },
  { file: 'flag.png', icon: 'Flag', fills: ['#dc2626', '#fecaca'] },
  { file: 'star.png', icon: 'Star', fills: ['#fbbf24', '#fef08a'] },
  { file: 'magic.png', icon: 'Magic', fills: ['#f59e0b', '#fde68a'] },
  { file: 'bird.png', icon: 'Bird', fills: ['#1e293b', '#fbbf24'] },
  { file: 'peach.png', icon: 'Peach', fills: ['#fb7185', '#fecdd3'] },
];

async function main() {
  const particlesDir = path.join(ROOT, 'static/festival/particles');
  fs.mkdirSync(particlesDir, { recursive: true });
  for (const p of PARTICLES) {
    await writePng(
      path.join(particlesDir, p.file),
      iconSvg(p.icon, p.fills, PARTICLE_SIZE),
      PARTICLE_SIZE,
      PARTICLE_SIZE,
    );
  }

  const xmas = path.join(ROOT, 'static/festival/christmas');
  const cny = path.join(ROOT, 'static/festival/cny');
  fs.mkdirSync(xmas, { recursive: true });
  fs.mkdirSync(cny, { recursive: true });

  /* 仅生成运行时用到的：灯带 header + 底栏默认 bank；顶栏图由管理员上传 */
  await sharp(Buffer.from(christmasHeaderSvg()))
    .png({ compressionLevel: 9 })
    .toFile(path.join(xmas, 'header.png'));
  console.log('OK static/festival/christmas/header.png');

  await sharp(Buffer.from(snowBankSvg()))
    .png({ compressionLevel: 9 })
    .toFile(path.join(xmas, 'snow-bank.png'));
  console.log('OK static/festival/christmas/snow-bank.png');

  await sharp(Buffer.from(cnyHeaderSvg()))
    .png({ compressionLevel: 9 })
    .toFile(path.join(cny, 'header.png'));
  console.log('OK static/festival/cny/header.png');

  await sharp(Buffer.from(cnyBankSvg()))
    .png({ compressionLevel: 9 })
    .toFile(path.join(cny, 'gold-bank.png'));
  console.log('OK static/festival/cny/gold-bank.png');

  console.log('DONE particles + headers/banks');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
