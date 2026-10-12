const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

/** 识图优先；旧 vision 实验名仍可作回退 */
const DEFAULT_MODELS = ['deepseek-flash', 'deepseek-v4-flash-vision-exp'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function assertAdmin(openid) {
  return !!openid && getAdminList().includes(openid);
}

function getApiKeys() {
  const raw = process.env.DEEPSEEK_API_KEYS || process.env.DEEPSEEK_API_KEY || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getModels() {
  const fromList = process.env.DEEPSEEK_MODELS || '';
  if (fromList.trim()) {
    return fromList
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const preferred = (process.env.DEEPSEEK_MODEL || '').trim();
  if (preferred) {
    const rest = DEFAULT_MODELS.filter((m) => m !== preferred);
    return [preferred, ...rest];
  }
  return DEFAULT_MODELS.slice();
}

function getApiBase() {
  // 不要回退到 GEMINI_API_BASE：旧 workers.dev 地址会把国内云函数拖超时
  const raw = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').trim();
  return raw.replace(/\/$/, '');
}

function isNetworkBlocked(err) {
  const msg = String((err && (err.message || err.errMsg)) || err || '');
  const code = err && err.code;
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|network|超时|timeout|getaddrinfo/i.test(
      msg,
    )
  );
}

function networkBlockedError() {
  const err = new Error(
    '云函数无法访问 DeepSeek API。请确认环境变量 DEEPSEEK_API_KEY 已配置，且未把 GEMINI_API_BASE 指到不可达地址',
  );
  err.code = 'DEEPSEEK_BLOCKED';
  return err;
}

function guessMime(fileID, fileContentType) {
  if (fileContentType && /^image\//i.test(fileContentType)) return fileContentType;
  const lower = String(fileID || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function httpsRequest(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body;
  const wait = Math.max(3000, Number(options.timeoutMs) || 15000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    const headers = Object.assign({}, options.headers || {});
    const payload = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : null;
    if (payload) {
      headers['Content-Length'] = payload.length;
    }
    const req = https.request(
      url,
      {
        method,
        headers,
        timeout: wait,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          done(resolve, {
            statusCode: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', (e) => done(reject, e));
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('请求超时');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function httpsJson(url, body, timeoutMs, headers) {
  return httpsRequest(url, {
    method: 'POST',
    timeoutMs,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  }).then((res) => {
    let json = null;
    try {
      json = res.text ? JSON.parse(res.text) : {};
    } catch (e) {
      throw new Error(`DeepSeek 响应非 JSON：${String(res.text || '').slice(0, 120)}`);
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return json;
    }
    const msg =
      (json.error && json.error.message) ||
      String(res.text || '').slice(0, 200) ||
      `HTTP ${res.statusCode}`;
    const err = new Error(msg);
    err.status = res.statusCode;
    err.retryable =
      res.statusCode === 429 ||
      res.statusCode === 503 ||
      /quota|rate|limit|insufficient|余额|balance/i.test(msg);
    throw err;
  });
}

/** 检测云函数能否访问 DeepSeek（models 列表） */
async function pingApi() {
  const base = getApiBase();
  const keys = getApiKeys();
  if (!keys.length) {
    return {
      ok: false,
      code: 'NO_KEY',
      message: '未配置 DEEPSEEK_API_KEY，请在云函数环境变量中填写',
      data: { base, hasKeys: false },
    };
  }
  try {
    const res = await httpsRequest(`${base}/models`, {
      method: 'GET',
      timeoutMs: 12000,
      headers: { Authorization: `Bearer ${keys[0]}` },
    });
    let body = null;
    try {
      body = res.text ? JSON.parse(res.text) : null;
    } catch (e) {
      body = null;
    }
    const apiOk = res.statusCode >= 200 && res.statusCode < 300;
    return {
      ok: true,
      data: {
        base,
        statusCode: res.statusCode,
        apiOk,
        provider: 'deepseek',
        hasKeys: true,
        keyCount: keys.length,
        models: getModels().slice(0, 3),
        tip: apiOk
          ? 'DeepSeek 连通正常，可以点「根据封面生成」'
          : `已访问 ${base}，但未通过鉴权（HTTP ${res.statusCode}）。请检查 DEEPSEEK_API_KEY`,
        raw: String(res.text || '').slice(0, 160),
        bodyOk: !!(body && (body.data || body.object)),
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: 'PING_FAIL',
      message: `无法访问 DeepSeek API（${base}）：${e.message || e}。请确认未误配 GEMINI_API_BASE，并已重新部署云函数`,
      data: { base, hasKeys: keys.length > 0 },
    };
  }
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    /* try fenced / substring */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (e) {
      /* continue */
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function buildPrompt(categoryName, includeArticle) {
  const theme = String(categoryName || '').trim();
  const articleBlock = includeArticle
    ? `3. article：适合发「微信公众号」的推文正文（纯文本，可分段），约 200～450 字；围绕「${theme}」写亮点、适用场景、结尾引导（如下载小程序「趣集」查看合集），不要写 Markdown 标题符号 #，不要编造不存在的价格/活动。

只输出一个 JSON 对象，不要其它说明，格式：
{"title":"...","description":"...","article":"..."}`
    : `不要生成公众号长文，也不要输出 article 字段。

只输出一个 JSON 对象，不要其它说明，格式：
{"title":"...","description":"..."}`;

  return `你是微信生态内容运营助手。请根据「主题分类」和这张合集封面图，生成中文文案。

【主题分类（以它为准识别角色/系列，不要猜错）】
${theme}

说明：封面图可能画风抽象，仅靠识图容易认错角色。文案中的角色名、系列名必须围绕上述主题分类展开；可结合封面风格、配色、表情氛围做补充，但不要写成与主题无关的内容。

要求：
1. title：合集标题，适合小程序列表展示，15 字以内，带一点吸引力，不要引号；应能看出与「${theme}」相关。
2. description：用户可见简介，1～3 句，可换行，合计不超过 120 字，语气轻松；点明主题「${theme}」。
${articleBlock}`;
}

async function callDeepSeekOnce(
  apiKey,
  model,
  mimeType,
  base64,
  categoryName,
  includeArticle,
) {
  const base = getApiBase();
  const url = `${base}/chat/completions`;
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(categoryName, includeArticle) },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'low',
            },
          },
        ],
      },
    ],
    temperature: 0.7,
    // 不生成公众号文案时压低输出上限，省 token
    max_tokens: includeArticle ? 1024 : 400,
    response_format: { type: 'json_object' },
  };
  const json = await httpsJson(url, body, 45000, {
    Authorization: `Bearer ${apiKey}`,
  });
  const text =
    json &&
    json.choices &&
    json.choices[0] &&
    json.choices[0].message &&
    json.choices[0].message.content;
  const parsed = extractJsonObject(text);
  if (!parsed || !parsed.title) {
    throw new Error('模型未返回有效 JSON，请重试');
  }
  return {
    title: String(parsed.title || '')
      .trim()
      .slice(0, 40),
    description: String(parsed.description || '')
      .trim()
      .slice(0, 800),
    article: includeArticle ? String(parsed.article || '').trim() : '',
    includeArticle: !!includeArticle,
  };
}

async function callWithFailover(mimeType, base64, categoryName, includeArticle) {
  const keys = getApiKeys();
  if (!keys.length) {
    const err = new Error(
      '未配置 DEEPSEEK_API_KEY，请在云函数环境变量中填写（多个 Key 用逗号分隔可用 DEEPSEEK_API_KEYS）',
    );
    err.code = 'NO_KEY';
    throw err;
  }
  const models = getModels();
  if (!models.length) {
    const err = new Error('未配置可用模型 DEEPSEEK_MODELS / DEEPSEEK_MODEL');
    err.code = 'NO_MODEL';
    throw err;
  }

  let lastErr = null;
  for (let ki = 0; ki < keys.length; ki += 1) {
    for (let mi = 0; mi < models.length; mi += 1) {
      const model = models[mi];
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await callDeepSeekOnce(
          keys[ki],
          model,
          mimeType,
          base64,
          categoryName,
          includeArticle,
        );
        return { ...data, model, keyIndex: ki + 1 };
      } catch (e) {
        lastErr = e;
        console.warn(
          `[generatePackCopy] key#${ki + 1} model=${model} base=${getApiBase()} fail`,
          e.message || e,
        );
        if (isNetworkBlocked(e)) {
          throw networkBlockedError();
        }
        if (/not found|invalid|UNSUPPORTED|404|does not support image/i.test(e.message || '')) {
          continue;
        }
        if (e.retryable) continue;
      }
    }
  }
  if (isNetworkBlocked(lastErr)) {
    throw networkBlockedError();
  }
  const tip =
    (lastErr && lastErr.retryable) ||
    /quota|rate|429|insufficient|余额|balance/i.test((lastErr && lastErr.message) || '')
      ? '余额不足或触发限流，请到 DeepSeek 控制台充值后再试'
      : (lastErr && lastErr.message) || 'DeepSeek 调用失败';
  const err = new Error(tip);
  err.code = (lastErr && lastErr.code) || 'GEN_FAIL';
  throw err;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  if (event && event.action === 'ping') {
    return pingApi();
  }

  const coverFileID = (event && event.coverFileID) || '';
  const categoryName = String((event && event.categoryName) || '').trim();
  const includeArticle = !!(event && event.includeArticle);
  if (!categoryName) {
    return { ok: false, code: 'BAD_PARAM', message: '请先选择主题分类' };
  }
  if (!coverFileID || !String(coverFileID).startsWith('cloud://')) {
    return { ok: false, code: 'BAD_PARAM', message: '请先上传封面' };
  }

  try {
    const dl = await cloud.downloadFile({ fileID: coverFileID });
    const buf = dl.fileContent;
    if (!buf || !buf.length) {
      return { ok: false, code: 'EMPTY_FILE', message: '封面下载失败' };
    }
    if (buf.length > 3.5 * 1024 * 1024) {
      return {
        ok: false,
        code: 'TOO_LARGE',
        message: '封面过大，请换一张更小的图再试',
      };
    }
    const mimeType = guessMime(coverFileID, dl.contentType);
    const base64 = buf.toString('base64');
    const data = await callWithFailover(
      mimeType,
      base64,
      categoryName,
      includeArticle,
    );
    return {
      ok: true,
      data: { ...data, categoryName },
    };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: e.code || 'GEN_FAIL',
      message: e.message || '生成失败',
    };
  }
};
