/**
 * 拼豆图纸核心算法
 * 移植自 https://github.com/ya-chang/bead-pattern-generator （MIT）
 */
import { PAL, rgb2lab } from './palette';

export const TRANSPARENT = -1;

const K25_7 = 6103515625;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const HALF_PI_360 = Math.PI / 360;

function dE00(l1, a1, b1, c1, l2, a2, b2, c2) {
  const Cb = (c1 + c2) * 0.5;
  const m2 = Cb * Cb;
  const m3 = m2 * Cb;
  const m7 = m3 * m3 * Cb;
  const G = 0.5 * (1 - Math.sqrt(m7 / (m7 + K25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  let h1p = Math.atan2(b1, a1p) * DEG;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * DEG;
  if (h2p < 0) h2p += 360;
  const dLp = l2 - l1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p !== 0 && C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * HALF_PI_360);
  const Lbp = (l1 + l2) * 0.5;
  const Cbp = (C1p + C2p) * 0.5;
  let Hbp;
  if (C1p * C2p === 0) Hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) Hbp = (h1p + h2p) * 0.5;
  else if (h1p + h2p < 360) Hbp = (h1p + h2p + 360) * 0.5;
  else Hbp = (h1p + h2p - 360) * 0.5;
  const T =
    1 -
    0.17 * Math.cos((Hbp - 30) * RAD) +
    0.24 * Math.cos(2 * Hbp * RAD) +
    0.32 * Math.cos((3 * Hbp + 6) * RAD) -
    0.2 * Math.cos((4 * Hbp - 63) * RAD);
  const dt = (Hbp - 275) * 0.04;
  const dTheta = 30 * Math.exp(-dt * dt);
  const q2 = Cbp * Cbp;
  const q3 = q2 * Cbp;
  const q7 = q3 * q3 * Cbp;
  const Rc = 2 * Math.sqrt(q7 / (q7 + K25_7));
  const dl = Lbp - 50;
  const Sl = 1 + (0.015 * dl * dl) / Math.sqrt(20 + dl * dl);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc;
  const tL = dLp / Sl;
  const tC = dCp / Sc;
  const tH = dHp / Sh;
  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
}

export function deltaE(a, b, algo) {
  if (algo === 'rgb') {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  const dL = a.L - b.L;
  const dA = a.A - b.A;
  const dB = a.B - b.B;
  if (algo === 'lab') return Math.sqrt(dL * dL + dA * dA + dB * dB);
  return dE00(a.L, a.A, a.B, a.C || Math.sqrt(a.A * a.A + a.B * a.B), b.L, b.A, b.B, b.C);
}

export function bestMatch(probe, algo) {
  const n = PAL.length;
  if (algo === 'rgb') {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dr = probe.r - PAL[i].r;
      const dg = probe.g - PAL[i].g;
      const db = probe.b - PAL[i].b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  }
  const L = probe.L;
  const A = probe.A;
  const B = probe.B;
  if (algo === 'lab') {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const u = L - PAL[i].L;
      const v = A - PAL[i].A;
      const w = B - PAL[i].B;
      const d = u * u + v * v + w * w;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  }
  const c1 = Math.sqrt(A * A + B * B);
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const p = PAL[i];
    const d = dE00(L, A, B, c1, p.L, p.A, p.B, p.C);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}

export function sobelGradient(data, w, h) {
  const g = new Uint8Array(w * h);
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = lum[i - w - 1];
      const tc = lum[i - w];
      const tr = lum[i - w + 1];
      const ml = lum[i - 1];
      const mr = lum[i + 1];
      const bl = lum[i + w - 1];
      const bc = lum[i + w];
      const br = lum[i + w + 1];
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const v = Math.sqrt(gx * gx + gy * gy) / 4;
      g[i] = v > 255 ? 255 : v;
    }
  }
  return g;
}

export function sampleCell(data, gw, x0, y0, cw, ch, mode, grad, gw2) {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  let gs = 0;
  const hist = new Map();
  let best = null;
  for (let y = y0; y < y0 + ch; y++) {
    for (let x = x0; x < x0 + cw; x++) {
      const i = (y * gw + x) * 4;
      const a = data[i + 3];
      if (a < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sr += r;
      sg += g;
      sb += b;
      n++;
      if (grad) gs += grad[y * gw2 + x];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const e = hist.get(key);
      if (e) {
        e.n++;
        e.r += r;
        e.g += g;
        e.b += b;
      } else hist.set(key, { n: 1, r, g, b });
      if (mode === 'nearest' && best === null) best = { r, g, b };
    }
  }
  if (n === 0) return null;
  if (mode === 'nearest') return best || { r: sr / n, g: sg / n, b: sb / n };
  if (mode === 'average') return { r: sr / n, g: sg / n, b: sb / n };
  if (mode === 'dominant') {
    let top = null;
    hist.forEach((e) => {
      if (!top || e.n > top.n) top = e;
    });
    return { r: top.r / top.n, g: top.g / top.n, b: top.b / top.n };
  }
  const avgGrad = grad ? gs / n : 0;
  if (avgGrad > 26) {
    let top = null;
    hist.forEach((e) => {
      if (!top || e.n > top.n) top = e;
    });
    return { r: top.r / top.n, g: top.g / top.n, b: top.b / top.n };
  }
  return { r: sr / n, g: sg / n, b: sb / n };
}

export function removeBg(data, w, h, tol) {
  const corners = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
    [w >> 1, 1],
    [w >> 1, h - 2],
    [1, h >> 1],
    [w - 2, h >> 1],
  ];
  let br = 0;
  let bg = 0;
  let bb = 0;
  for (let c = 0; c < corners.length; c++) {
    const x = corners[c][0];
    const y = corners[c][1];
    const i = (y * w + x) * 4;
    br += data[i];
    bg += data[i + 1];
    bb += data[i + 2];
  }
  br /= corners.length;
  bg /= corners.length;
  bb /= corners.length;
  const t2 = tol * tol;
  const grad = sobelGradient(data, w, h);
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (x, y) => {
    const i = y * w + x;
    const j = i * 4;
    if (seen[i]) return;
    const dr = data[j] - br;
    const dg = data[j + 1] - bg;
    const db = data[j + 2] - bb;
    if (dr * dr + dg * dg + db * db > t2) return;
    seen[i] = 1;
    q[tail++] = i;
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (head < tail) {
    const i = q[head++];
    const x = i % w;
    const y = (i - x) / w;
    if (grad[i] > 110) continue;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const out = new Uint8ClampedArray(data);
  let removed = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    if (seen[i]) {
      out[j + 3] = 0;
      removed++;
    }
  }
  return { data: out, removed, bg: [Math.round(br), Math.round(bg), Math.round(bb)] };
}

/**
 * @param {Uint8ClampedArray} data 离屏像素
 * @param {number} ow 离屏宽
 * @param {number} oh 离屏高
 * @param {{ gw:number, mode:string, algo:string, removeBg?:boolean, tol?:number }} opts
 */
export function buildGrid(data, ow, oh, opts) {
  const gw = Math.max(8, Math.min(120, opts.gw | 0));
  const gh = Math.max(1, Math.round((gw * oh) / ow));
  const mode = opts.mode || 'structural';
  const algo = opts.algo || 'ciede';
  let pixels = data;
  let removed = 0;
  if (opts.removeBg) {
    const r = removeBg(pixels, ow, oh, opts.tol == null ? 28 : opts.tol);
    pixels = r.data;
    removed = r.removed;
  }
  const cw = ow / gw;
  const ch = oh / gh;
  const grad = mode === 'structural' ? sobelGradient(pixels, ow, oh) : null;
  const cache = new Map();
  const grid = new Int16Array(gw * gh);
  const probe = { r: 0, g: 0, b: 0, L: 0, A: 0, B: 0 };
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const x0 = Math.floor(cx * cw);
      const y0 = Math.floor(cy * ch);
      const c = sampleCell(
        pixels,
        ow,
        x0,
        y0,
        Math.max(1, Math.round(cw)),
        Math.max(1, Math.round(ch)),
        mode,
        grad,
        ow,
      );
      if (!c) {
        grid[cy * gw + cx] = TRANSPARENT;
        continue;
      }
      const key = ((c.r >> 3) << 10) | ((c.g >> 3) << 5) | (c.b >> 3);
      let hit = cache.get(key);
      if (hit === undefined) {
        probe.r = c.r;
        probe.g = c.g;
        probe.b = c.b;
        const L = rgb2lab(c.r, c.g, c.b);
        probe.L = L[0];
        probe.A = L[1];
        probe.B = L[2];
        hit = bestMatch(probe, algo);
        cache.set(key, hit);
      }
      grid[cy * gw + cx] = hit;
    }
  }
  return { grid, W: gw, H: gh, removed };
}

export function countColors(grid) {
  const m = new Map();
  if (!grid) return m;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === TRANSPARENT) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

/** 用量低于 minCount 的色号并入最接近的常用色 */
export function mergeSimilarity(grid, minCount, algo) {
  const c = countColors(grid);
  const keep = [];
  const drop = [];
  c.forEach((n, i) => {
    if (n >= minCount) keep.push(i);
    else drop.push(i);
  });
  if (!keep.length || !drop.length) return 0;
  let changed = 0;
  for (let di = 0; di < drop.length; di++) {
    const d = drop[di];
    let bi = keep[0];
    let bd = Infinity;
    for (let ki = 0; ki < keep.length; ki++) {
      const k = keep[ki];
      const dist = deltaE(PAL[d], PAL[k], algo || 'ciede');
      if (dist < bd) {
        bd = dist;
        bi = k;
      }
    }
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === d) {
        grid[i] = bi;
        changed++;
      }
    }
  }
  return changed;
}

/**
 * K-Means 把现有色号压到 k 种，再映射回色板
 * （聚类在 Lab 空间；与原项目一致）
 */
export function mergeKmeans(grid, k, algo) {
  const c = countColors(grid);
  const used = [];
  c.forEach((n, i) => used.push({ i, n }));
  const target = Math.max(2, Math.min(120, k | 0));
  if (used.length <= target) return 0;

  used.sort((a, b) => b.n - a.n);
  const pts = used.map((u) => ({
    i: u.i,
    n: u.n,
    L: PAL[u.i].L,
    A: PAL[u.i].A,
    B: PAL[u.i].B,
    c: 0,
  }));
  const cents = [];
  for (let j = 0; j < target; j++) {
    const p = pts[Math.floor(((j + 0.5) * pts.length) / target)];
    cents.push({ L: p.L, A: p.A, B: p.B, pi: p.i });
  }

  for (let iter = 0; iter < 24; iter++) {
    for (let pi = 0; pi < pts.length; pi++) {
      const p = pts[pi];
      let bi = 0;
      let bd = Infinity;
      for (let j = 0; j < target; j++) {
        const cj = cents[j];
        const dL = p.L - cj.L;
        const dA = p.A - cj.A;
        const dB = p.B - cj.B;
        const d = dL * dL + dA * dA + dB * dB;
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      p.c = bi;
    }
    const s = Array.from({ length: target }, () => ({ L: 0, A: 0, B: 0, n: 0 }));
    for (let pi = 0; pi < pts.length; pi++) {
      const p = pts[pi];
      const t = s[p.c];
      t.L += p.L * p.n;
      t.A += p.A * p.n;
      t.B += p.B * p.n;
      t.n += p.n;
    }
    let moved = false;
    for (let j = 0; j < target; j++) {
      if (!s[j].n) {
        const p = pts[Math.floor(Math.random() * pts.length)];
        cents[j] = { L: p.L, A: p.A, B: p.B, pi: p.i };
        moved = true;
        continue;
      }
      const nc = {
        L: s[j].L / s[j].n,
        A: s[j].A / s[j].n,
        B: s[j].B / s[j].n,
        pi: cents[j].pi,
      };
      if (
        Math.abs(nc.L - cents[j].L) +
          Math.abs(nc.A - cents[j].A) +
          Math.abs(nc.B - cents[j].B) >
        0.01
      ) {
        moved = true;
      }
      cents[j] = nc;
    }
    if (!moved && iter > 0) break;
  }

  const probe = { r: 0, g: 0, b: 0, L: 0, A: 0, B: 0 };
  // 质心在 Lab，映回色板用 lab/ciede（与原项目一致；rgb 模式也走 lab）
  const snapAlgo = algo === 'ciede' ? 'ciede' : 'lab';
  for (let j = 0; j < target; j++) {
    probe.L = cents[j].L;
    probe.A = cents[j].A;
    probe.B = cents[j].B;
    cents[j].pi = bestMatch(probe, snapAlgo);
  }

  const map = new Map();
  for (let pi = 0; pi < pts.length; pi++) {
    const p = pts[pi];
    map.set(p.i, cents[p.c].pi);
  }
  let changed = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === TRANSPARENT) continue;
    const t = map.get(v);
    if (t !== undefined && t !== v) {
      grid[i] = t;
      changed++;
    }
  }
  return changed;
}

/** 孤立单格（四邻皆不同色）并入周围主色 / 最近色 */
export function removeStray(grid, W, H, algo) {
  if (!grid || !W || !H) return 0;
  let changed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = grid[i];
      if (v === TRANSPARENT) continue;
      const nb = [];
      if (x > 0 && grid[i - 1] !== TRANSPARENT) nb.push(grid[i - 1]);
      if (x < W - 1 && grid[i + 1] !== TRANSPARENT) nb.push(grid[i + 1]);
      if (y > 0 && grid[i - W] !== TRANSPARENT) nb.push(grid[i - W]);
      if (y < H - 1 && grid[i + W] !== TRANSPARENT) nb.push(grid[i + W]);
      if (nb.length < 2) continue;
      let same = 0;
      for (let ni = 0; ni < nb.length; ni++) {
        if (nb[ni] === v) same++;
      }
      if (same > 0) continue;
      const freq = new Map();
      for (let ni = 0; ni < nb.length; ni++) {
        const n = nb[ni];
        freq.set(n, (freq.get(n) || 0) + 1);
      }
      let best = null;
      let bn = 0;
      freq.forEach((f, n) => {
        if (f > bn) {
          bn = f;
          best = n;
        }
      });
      if (best === null) continue;
      let bd = Infinity;
      let bi = best;
      freq.forEach((_, n) => {
        const d = deltaE(PAL[v], PAL[n], algo || 'ciede');
        if (d < bd) {
          bd = d;
          bi = n;
        }
      });
      grid[i] = bi;
      changed++;
    }
  }
  return changed;
}

const PNG_MAX_SIDE = 4096;
const PNG_MAX_AREA = 16e6;
/** 色号图至少要能放下编号；优先保证可读，再尽量拉高清晰度 */
const LABEL_MIN_CELL = 16;

/** 导出格宽：优先保证色号可读，再乘清晰度倍率，并钳到画布上限 */
export function exportCellSize(W, H, scale) {
  const mul = Math.max(1, Math.min(4, Number(scale) || 1));
  const maxDim = Math.max(W, H);
  // 基准就按「能标色号」来，不再用过小的 8px 格
  let c = Math.min(48, Math.max(LABEL_MIN_CELL, Math.floor(PNG_MAX_SIDE / maxDim)));
  c = Math.max(LABEL_MIN_CELL, Math.floor(c * mul));
  while (
    c > LABEL_MIN_CELL &&
    (W * c > PNG_MAX_SIDE || H * c > PNG_MAX_SIDE || W * c * (H * c) > PNG_MAX_AREA)
  ) {
    c -= 1;
  }
  // 极端大图才允许低于可读格宽
  while (
    c > 1 &&
    (W * c > PNG_MAX_SIDE || H * c > PNG_MAX_SIDE || W * c * (H * c) > PNG_MAX_AREA)
  ) {
    c -= 1;
  }
  return c;
}

export function pixelScale(W, H, scale) {
  const mul = Math.max(1, Math.min(4, Number(scale) || 1));
  let s = Math.max(1, Math.min(32, Math.floor(PNG_MAX_SIDE / Math.max(W, H))));
  s = Math.max(1, Math.floor(s * mul));
  while (s > 1 && W * s * (H * s) > PNG_MAX_AREA) s -= 1;
  return s;
}

function drawBeadCode(ctx, code, cx, cy, cell, r, g, b) {
  const len = String(code || '').length;
  const fs = Math.max(10, Math.floor(cell * (len > 3 ? 0.34 : 0.42)));
  // 微信 Canvas 对 font-weight 支持不稳定，用最朴素写法；坐标取整避免发糊
  const x = Math.round(cx);
  const y = Math.round(cy);
  ctx.font = `${fs}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const fill = lum > 150 ? '#111111' : '#ffffff';
  const stroke = lum > 150 ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, Math.round(cell * 0.1));
  ctx.strokeStyle = stroke;
  ctx.strokeText(code, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(code, x, y);
}

/** 生成 W×H 色块缓存，拖动/缩放时用 drawImage 提速 */
export function buildLiveColorCanvas(canvas, grid, W, H) {
  if (!canvas || !grid || !W || !H) return null;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < W * H; i++) {
    const v = grid[i];
    const o = i * 4;
    if (v === TRANSPARENT) {
      const x = i % W;
      const y = (i / W) | 0;
      const alt = (x + y) & 1;
      d[o] = alt ? 232 : 243;
      d[o + 1] = alt ? 235 : 245;
      d[o + 2] = alt ? 233 : 244;
      d[o + 3] = 255;
    } else {
      const p = PAL[v];
      d[o] = p.r;
      d[o + 1] = p.g;
      d[o + 2] = p.b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * 视口内现画拼豆图（按当前缩放重绘文字，放大也不糊）
 * opts.draft + colorCanvas：交互中只贴色块图，松手后再画色号
 * @param {CanvasRenderingContext2D} ctx 已按 dpr setTransform 到 CSS 像素
 */
export function paintLiveViewport(ctx, grid, W, H, opts) {
  const cssW = opts.cssW || 0;
  const cssH = opts.cssH || 0;
  const tx = opts.tx || 0;
  const ty = opts.ty || 0;
  const zoom = Math.max(0.04, opts.zoom || 1);
  const baseCell = opts.baseCell || 32;
  const mode = opts.mode || 'chart';
  const draft = !!opts.draft;
  const cell = baseCell * zoom;

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#eef1ef';
  ctx.fillRect(0, 0, cssW, cssH);

  if (!grid || !W || !H || cell <= 0) return;

  // 交互草稿：整图贴图，避免逐格+描字
  if (draft && opts.colorCanvas) {
    if (typeof ctx.imageSmoothingEnabled === 'boolean') ctx.imageSmoothingEnabled = false;
    ctx.drawImage(opts.colorCanvas, tx, ty, W * cell, H * cell);
    return;
  }

  // 格够大才标号；阈值略降，避免缩放边界附近时隐时现
  const showCode = mode === 'chart' && cell >= 12;
  const showGrid = mode === 'chart';

  const x0 = Math.max(0, Math.floor(-tx / cell));
  const y0 = Math.max(0, Math.floor(-ty / cell));
  const x1 = Math.min(W, Math.ceil((cssW - tx) / cell));
  const y1 = Math.min(H, Math.ceil((cssH - ty) / cell));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = grid[y * W + x];
      const px = tx + x * cell;
      const py = ty + y * cell;
      if (v === TRANSPARENT) {
        ctx.fillStyle = (x + y) & 1 ? '#e8ebe9' : '#f3f5f4';
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5);
        continue;
      }
      const p = PAL[v];
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.fillRect(px, py, cell + 0.5, cell + 0.5);
      if (showCode) {
        drawBeadCode(ctx, p.code, px + cell / 2, py + cell / 2, cell, p.r, p.g, p.b);
      }
    }
  }

  if (showGrid && cell >= 8) {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const px = Math.round(tx + x * cell) + 0.5;
      ctx.moveTo(px, ty + y0 * cell);
      ctx.lineTo(px, ty + y1 * cell);
    }
    for (let y = y0; y <= y1; y++) {
      const py = Math.round(ty + y * cell) + 0.5;
      ctx.moveTo(tx + x0 * cell, py);
      ctx.lineTo(tx + x1 * cell, py);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) {
      const px = Math.round(tx + x * cell) + 0.5;
      ctx.moveTo(px, ty + y0 * cell);
      ctx.lineTo(px, ty + y1 * cell);
    }
    for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) {
      const py = Math.round(ty + y * cell) + 0.5;
      ctx.moveTo(tx + x0 * cell, py);
      ctx.lineTo(tx + x1 * cell, py);
    }
    ctx.stroke();
  }
}

/** 预览 / 色号图：格线 + 色块 + 色号（导出时可带标题边距） */
export function paintPattern(ctx, grid, W, H, cell, opts) {
  const showCode = opts && opts.showCode !== false;
  const showGrid = !(opts && opts.showGrid === false);
  const pad = Math.max(0, (opts && opts.pad) || 0);
  const title = (opts && opts.title) || '';
  const titleBand = title ? Math.max(28, Math.round(cell * 0.7)) : 0;
  const width = pad * 2 + W * cell;
  const height = pad * 2 + H * cell + titleBand;
  const ox = pad;
  const oy = pad + titleBand;

  if (typeof ctx.imageSmoothingEnabled === 'boolean') {
    ctx.imageSmoothingEnabled = false;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (title) {
    ctx.fillStyle = '#1b1e21';
    ctx.font = `${Math.max(14, Math.round(16 * (cell >= 24 ? 1.1 : 1)))}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, pad, pad + Math.round(titleBand * 0.62));
  }

  // 色号图默认就标号；仅格宽极小时才省略
  const forceLabel = showCode && cell >= 10;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = grid[y * W + x];
      const px = ox + x * cell;
      const py = oy + y * cell;
      if (v === TRANSPARENT) {
        ctx.fillStyle = (x + y) & 1 ? '#eef0f2' : '#f8f9fa';
        ctx.fillRect(px, py, cell, cell);
        continue;
      }
      const p = PAL[v];
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.fillRect(px, py, cell, cell);
      if (forceLabel) {
        drawBeadCode(ctx, p.code, px + cell / 2, py + cell / 2, cell, p.r, p.g, p.b);
      }
    }
  }

  if (showGrid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, W * cell - 1, H * cell - 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    for (let x = 1; x < W; x++) {
      ctx.moveTo(ox + x * cell + 0.5, oy);
      ctx.lineTo(ox + x * cell + 0.5, oy + H * cell);
    }
    for (let y = 1; y < H; y++) {
      ctx.moveTo(ox, oy + y * cell + 0.5);
      ctx.lineTo(ox + W * cell, oy + y * cell + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(1, Math.round(cell / 20));
    ctx.beginPath();
    for (let x = 10; x < W; x += 10) {
      ctx.moveTo(ox + x * cell + 0.5, oy);
      ctx.lineTo(ox + x * cell + 0.5, oy + H * cell);
    }
    for (let y = 10; y < H; y += 10) {
      ctx.moveTo(ox, oy + y * cell + 0.5);
      ctx.lineTo(ox + W * cell, oy + y * cell + 0.5);
    }
    ctx.stroke();
  }

  return { width, height, labeled: forceLabel };
}

/** 像素图：无格线、无色号，纯色块（可再最近邻放大） */
export function paintPixelMap(ctx, grid, W, H) {
  const im = ctx.createImageData(W, H);
  const px = im.data;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    const o = i << 2;
    if (v === TRANSPARENT) {
      px[o] = 0;
      px[o + 1] = 0;
      px[o + 2] = 0;
      px[o + 3] = 0;
    } else {
      const p = PAL[v];
      px[o] = p.r;
      px[o + 1] = p.g;
      px[o + 2] = p.b;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
}

export function buildSvg(grid, W, H) {
  const cell = 24;
  const pad = 16;
  const showText = W * H <= 40000;
  let s =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * cell + pad * 2}" height="${H * cell + pad * 2}" shape-rendering="crispEdges">` +
    '<rect width="100%" height="100%" fill="#fff"/><g>';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = grid[y * W + x];
      if (v === TRANSPARENT) continue;
      const p = PAL[v];
      s +=
        `<rect x="${pad + x * cell}" y="${pad + y * cell}" width="${cell}" height="${cell}" fill="rgb(${p.r},${p.g},${p.b})"/>`;
    }
  }
  s += '</g>';
  if (showText) {
    s +=
      `<g font-family="sans-serif" font-size="${Math.floor(cell * 0.3)}" text-anchor="middle" dominant-baseline="central">`;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = grid[y * W + x];
        if (v === TRANSPARENT) continue;
        const p = PAL[v];
        const lum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
        s +=
          `<text x="${pad + x * cell + cell / 2}" y="${pad + y * cell + cell / 2}" fill="${lum > 150 ? '#111' : '#fff'}">${p.code}</text>`;
      }
    }
    s += '</g>';
  }
  s += '<g stroke="rgba(0,0,0,.16)" stroke-width="1">';
  for (let x = 1; x < W; x++) {
    s += `<line x1="${pad + x * cell}" y1="${pad}" x2="${pad + x * cell}" y2="${pad + H * cell}"/>`;
  }
  for (let y = 1; y < H; y++) {
    s += `<line x1="${pad}" y1="${pad + y * cell}" x2="${pad + W * cell}" y2="${pad + y * cell}"/>`;
  }
  s += '</g></svg>';
  return { svg: s, withCodes: showText };
}

/** 全部色号（按用量降序） */
export function listColors(grid) {
  const m = countColors(grid);
  const rows = [];
  m.forEach((n, i) => {
    const p = PAL[i];
    rows.push({
      index: i,
      code: p.code,
      hex: p.hex,
      count: n,
    });
  });
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

/** @deprecated 用 listColors */
export function topColors(grid, limit) {
  const rows = listColors(grid);
  return limit ? rows.slice(0, limit) : rows;
}

export function measureColorList(rows, scale) {
  const list = rows || [];
  const mul = Math.max(1, Math.min(4, Number(scale) || 2));
  const pad = Math.round(28 * mul);
  const titleH = Math.round(44 * mul);
  const subH = Math.round(26 * mul);
  const rowH = Math.round(36 * mul);
  const gap = Math.round(18 * mul);
  const colW = Math.round(300 * mul);
  let cols = 1;
  for (; cols <= 4; cols++) {
    const per = Math.ceil(list.length / cols) || 1;
    const h = pad * 2 + titleH + subH + per * rowH + Math.round(12 * mul);
    const w = pad * 2 + cols * colW + (cols - 1) * gap;
    if (h <= PNG_MAX_SIDE && w <= PNG_MAX_SIDE && w * h <= PNG_MAX_AREA) break;
  }
  if (cols > 4) cols = 4;
  const perCol = Math.ceil(list.length / cols) || 1;
  return {
    mul,
    pad,
    titleH,
    subH,
    rowH,
    gap,
    colW,
    cols,
    perCol,
    sw: Math.round(22 * mul),
    fontTitle: Math.round(18 * mul),
    fontSub: Math.round(13 * mul),
    fontRow: Math.round(15 * mul),
    fontCount: Math.round(14 * mul),
    width: pad * 2 + cols * colW + (cols - 1) * gap,
    height: pad * 2 + titleH + subH + perCol * rowH + Math.round(12 * mul),
  };
}

/**
 * 高清色号清单图（全部色号）
 * @param {CanvasRenderingContext2D} ctx
 * @param {{code:string,hex:string,count:number}[]} rows
 * @param {{ scale?:number, title?:string, subtitle?:string }} opts
 */
export function paintColorList(ctx, rows, opts) {
  const list = rows || [];
  const layout = measureColorList(list, opts && opts.scale);
  const {
    mul,
    pad,
    titleH,
    subH,
    rowH,
    gap,
    colW,
    perCol,
    sw,
    fontTitle,
    fontSub,
    fontRow,
    fontCount,
    width,
    height,
  } = layout;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const title = (opts && opts.title) || '色号清单';
  const subtitle = (opts && opts.subtitle) || `共 ${list.length} 色`;

  ctx.fillStyle = '#111827';
  ctx.font = `700 ${fontTitle}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, pad, pad + fontTitle);

  ctx.fillStyle = '#6b7280';
  ctx.font = `500 ${fontSub}px sans-serif`;
  ctx.fillText(subtitle, pad, pad + titleH + fontSub - 4);

  const startY = pad + titleH + subH;

  for (let i = 0; i < list.length; i++) {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const item = list[i];
    const x = pad + col * (colW + gap);
    const y = startY + row * rowH;
    const cy = y + rowH / 2;

    if (row % 2 === 0) {
      ctx.fillStyle = '#f8faf9';
      ctx.fillRect(x, y, colW, rowH);
    }

    ctx.fillStyle = item.hex || '#ccc';
    const sx = x + Math.round(10 * mul);
    const sy = cy - sw / 2;
    const rr = Math.max(2, Math.round(4 * mul));
    roundRect(ctx, sx, sy, sw, sw, rr);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = Math.max(1, mul * 0.5);
    ctx.stroke();

    ctx.fillStyle = '#111827';
    ctx.font = `700 ${fontRow}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.code, sx + sw + Math.round(12 * mul), cy);

    ctx.fillStyle = '#6b7280';
    ctx.font = `600 ${fontCount}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`×${item.count}`, x + colW - Math.round(12 * mul), cy);
  }

  return { width, height };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
