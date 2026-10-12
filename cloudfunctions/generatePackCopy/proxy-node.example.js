/**
 * 海外 VPS 上的 Gemini 反代（Node 18+）
 *
 * 适用：腾讯云函数连不上 *.workers.dev（超时）时。
 * 在香港 / 新加坡 / 日本任意能访问 Google 的机器上运行即可。
 *
 * 用法：
 *   node proxy-node.example.js
 *   # 或：PORT=8787 node proxy-node.example.js
 *
 * 云函数环境变量：
 *   GEMINI_API_BASE=https://你的域名或IP:端口
 * （有 Nginx/Caddy 配 HTTPS 时写 https://你的域名，不要末尾 /）
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 8787;
const UPSTREAM = 'https://generativelanguage.googleapis.com';

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function proxy(req, res) {
  const incoming = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (
    req.method === 'GET' &&
    (incoming.pathname === '/' || incoming.pathname === '/health')
  ) {
    sendJson(res, 200, {
      ok: true,
      service: 'gemini-proxy-node',
      tip: '代理正常。请把本地址填到云函数 GEMINI_API_BASE',
    });
    return;
  }

  const target = new URL(incoming.pathname + incoming.search, UPSTREAM);
  const headers = {};
  if (req.headers['content-type']) {
    headers['content-type'] = req.headers['content-type'];
  }
  if (req.headers['content-length']) {
    headers['content-length'] = req.headers['content-length'];
  }

  const upstreamReq = https.request(
    target,
    { method: req.method, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, {
        'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
      });
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on('error', (e) => {
    sendJson(res, 502, { ok: false, error: e.message || 'upstream failed' });
  });

  req.pipe(upstreamReq);
}

http.createServer(proxy).listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[gemini-proxy] listening on :${PORT}`);
});
