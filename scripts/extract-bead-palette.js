/**
 * 从 ya-chang/bead-pattern-generator 的 index.html 提取 MARD 色板
 * Usage: node scripts/extract-bead-palette.js [path-to-index.html]
 */
const fs = require('fs');
const path = require('path');

const srcPath =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/d-code-emojiShare/agent-tools/b6f5560c-7350-4fde-8f6e-b1e777b83d50.txt',
  );

const src = fs.readFileSync(srcPath, 'utf8');
const rawM = src.match(/const RAW\s*=\s*(\{[\s\S]*?\});/);
if (!rawM) {
  console.error('RAW object not found in', srcPath);
  process.exit(1);
}

const outDir = path.join(__dirname, '../pages/tools/bead');
fs.mkdirSync(outDir, { recursive: true });

const palette = `/**
 * MARD 221 色板
 * 来源：https://github.com/ya-chang/bead-pattern-generator （MIT）
 * 格式：{ 色号: hex }
 */
export const RAW = ${rawM[1]};

export function rgb2lab(r, g, b) {
  let R = r / 255;
  let G = g / 255;
  let B = b / 255;
  R = R <= 0.04045 ? R / 12.92 : Math.pow((R + 0.055) / 1.055, 2.4);
  G = G <= 0.04045 ? G / 12.92 : Math.pow((G + 0.055) / 1.055, 2.4);
  B = B <= 0.04045 ? B / 12.92 : Math.pow((B + 0.055) / 1.055, 2.4);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const PAL = Object.keys(RAW).map((code) => {
  const h = String(RAW[code]).replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lab = rgb2lab(r, g, b);
  return {
    code,
    hex: RAW[code],
    r,
    g,
    b,
    L: lab[0],
    A: lab[1],
    B: lab[2],
    C: Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]),
  };
});
`;

fs.writeFileSync(path.join(outDir, 'palette.js'), palette);
const n = (rawM[1].match(/"[A-Z0-9]+"/g) || []).length;
console.log('wrote palette.js', n, 'colors, bytes', palette.length);
