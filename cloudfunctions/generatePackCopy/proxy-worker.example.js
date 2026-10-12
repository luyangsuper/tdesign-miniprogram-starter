/**
 * Cloudflare Worker：Gemini API 反代（给国内微信云函数用）
 *
 * 部署后打开根路径应看到 {"ok":true,...}
 * 若仍是 Google 的 404 页面，说明还在用旧代码，请整份覆盖后重新 Deploy。
 *
 * 注意：腾讯云函数机房经常访问不了 *.workers.dev（浏览器能开、云函数超时）。
 * 请给 Worker 绑定「自定义域名」，再把该域名填到 GEMINI_API_BASE。
 * 详见同目录 README.md。
 *
 * 云函数环境变量：
 *   GEMINI_API_BASE=https://gemini-proxy.你的域名.com
 * （不要末尾斜杠，不要加 /v1beta）
 */
export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    // 健康检查：浏览器打开根路径应返回 JSON，而不是 Google 404
    if (
      request.method === 'GET' &&
      (incoming.pathname === '/' || incoming.pathname === '/health')
    ) {
      return Response.json({
        ok: true,
        service: 'gemini-proxy',
        tip: '代理正常。请把本地址填到云函数 GEMINI_API_BASE',
      });
    }

    const target = new URL(
      incoming.pathname + incoming.search,
      'https://generativelanguage.googleapis.com',
    );

    // 只转发必要头，避免带上 Cloudflare / Host 干扰上游
    const headers = new Headers();
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);

    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // arrayBuffer 比直接传 stream 更稳（大 JSON / 图片 base64）
      init.body = await request.arrayBuffer();
    }

    try {
      return await fetch(target.toString(), init);
    } catch (e) {
      return Response.json(
        {
          ok: false,
          error: (e && e.message) || 'proxy fetch failed',
        },
        { status: 502 },
      );
    }
  },
};
