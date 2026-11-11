/**
 * Kubai Icons：拉取彩色静态 SVG → PNG
 * API: https://icons.kubai.design/docs/static
 */
const https = require('https');
const http = require('http');

const API = 'https://icons.kubai.design/api/icon';

function hexNoHash(color) {
  return String(color || '5393FF')
    .trim()
    .replace(/^#/, '')
    .toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchOnce(url, name) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { Accept: 'image/svg+xml' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchOnce(res.headers.location, name).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Kubai ${name} HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const head = buf.slice(0, 64).toString('utf8');
        if (!head.includes('<svg')) {
          reject(new Error(`Kubai ${name} 非 SVG 响应`));
          return;
        }
        resolve(buf);
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Kubai ${name} 超时`));
    });
  });
}

/**
 * @param {string} name kebab-case icon name
 * @param {{ color?: string, size?: number, variant?: 'color' | 'soft' }} [opts]
 * @returns {Promise<Buffer>}
 */
async function fetchKubaiSvg(name, opts = {}) {
  const color = hexNoHash(opts.color || '07c160');
  const size = Math.max(16, Math.min(2048, Number(opts.size) || 128));
  const variant = opts.variant === 'soft' ? 'soft' : 'color';
  const url = `${API}/${encodeURIComponent(name)}.svg?color=${color}&variant=${variant}&size=${size}`;
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fetchOnce(url, name);
    } catch (e) {
      lastErr = e;
      await sleep(400 * attempt);
    }
  }
  throw lastErr;
}

module.exports = {
  hexNoHash,
  fetchKubaiSvg,
};
