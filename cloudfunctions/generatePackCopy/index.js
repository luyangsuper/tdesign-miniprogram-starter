const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');
const {
  DEFAULT_MODELS,
  CLOUDBASE_EXPERIENCE_MODELS,
  CLOUDBASE_VISION_MODELS,
  CLOUDBASE_VISION_MODEL,
  mergeCloudbaseModels,
  cloudbaseModelOptions,
  normalizeBaseURL,
  looksMaskedApiKey,
  normalizeModels,
  getAiDoc,
  saveAiDoc,
  publicAiDoc,
  getActiveProvider,
  mergeProviders,
  normalizeProvider,
  isCloudbaseProvider,
} = require('./aiSettings');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000,
});
const db = cloud.database();

function getCloudAiModel() {
  if (!cloud.ai || typeof cloud.ai !== 'function') {
    const err = new Error(
      '当前 wx-server-sdk 过旧，不支持 cloud.ai()。请把 generatePackCopy 依赖升级到 ≥3.0.5 并重新「云端安装依赖」部署',
    );
    err.code = 'SDK_TOO_OLD';
    throw err;
  }
  const ai = cloud.ai();
  return ai.createModel('cloudbase');
}

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

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

function networkBlockedError(base) {
  const err = new Error(
    `云函数无法访问 AI API（${base || '-'}）。请检查 baseURL、API Key，或换一套可用配置`,
  );
  err.code = 'AI_BLOCKED';
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

function httpRequest(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body;
  const wait = Math.max(3000, Number(options.timeoutMs) || 15000);
  const lib = /^http:\/\//i.test(url) ? http : https;
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
    const req = lib.request(
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
  return httpRequest(url, {
    method: 'POST',
    timeoutMs,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  }).then((res) => {
    let json = null;
    try {
      json = res.text ? JSON.parse(res.text) : {};
    } catch (e) {
      throw new Error(`AI 响应非 JSON：${String(res.text || '').slice(0, 120)}`);
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

function resolveCredential(doc, event = {}) {
  const providerId = String((event && event.providerId) || '').trim();
  const eventType = String((event && event.type) || '').trim().toLowerCase();
  let baseURL = normalizeBaseURL((event && event.baseURL) || '');
  let apiKey = String((event && event.apiKey) || '').trim();
  let model = String((event && event.model) || '').trim();
  let name = '';

  let provider = null;
  if (providerId) {
    provider = (doc.providers || []).find((p) => p.id === providerId) || null;
  }
  const eventHintsCloudbase =
    eventType === 'cloudbase' ||
    baseURL === 'cloudbase' ||
    providerId === 'cloudbase_experience';

  if (!provider && !eventHintsCloudbase && !baseURL && !apiKey) {
    provider = getActiveProvider(doc);
  }

  let type = 'custom';
  if (provider) {
    name = provider.name;
    if (eventHintsCloudbase || isCloudbaseProvider(provider)) {
      type = 'cloudbase';
      baseURL = 'cloudbase';
      apiKey = '';
    } else {
      type = 'custom';
      if (!baseURL) baseURL = provider.baseURL;
      if (!apiKey || looksMaskedApiKey(apiKey)) apiKey = provider.apiKey;
    }
    if (!model) model = provider.model || (provider.models && provider.models[0]) || '';
  } else if (eventHintsCloudbase) {
    type = 'cloudbase';
    baseURL = 'cloudbase';
    apiKey = '';
    name = '云开发体验模型';
    if (!model) model = CLOUDBASE_VISION_MODEL;
  }

  return {
    provider,
    providerId: (provider && provider.id) || providerId || '',
    type,
    name,
    baseURL,
    apiKey,
    model,
  };
}

async function fetchCloudbaseModels() {
  const models = mergeCloudbaseModels();
  return {
    ok: true,
    data: {
      baseURL: 'cloudbase',
      statusCode: 200,
      models,
      modelOptions: cloudbaseModelOptions(models),
      visionModels: CLOUDBASE_VISION_MODELS.slice(),
      tip: `已刷新成长计划 ${models.length} 个模型。识图可用：${CLOUDBASE_VISION_MODELS.join(' / ')}`,
    },
  };
}

async function fetchModels(baseURL, apiKey, type) {
  if (type === 'cloudbase' || baseURL === 'cloudbase') {
    return fetchCloudbaseModels();
  }
  const base = normalizeBaseURL(baseURL);
  if (!base) {
    return { ok: false, code: 'BAD_PARAM', message: '请填写 baseURL' };
  }
  if (!apiKey) {
    return { ok: false, code: 'NO_KEY', message: '请填写 API Key' };
  }
  const res = await httpRequest(`${base}/models`, {
    method: 'GET',
    timeoutMs: 15000,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  let body = null;
  try {
    body = res.text ? JSON.parse(res.text) : null;
  } catch (e) {
    body = null;
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const msg =
      (body && body.error && body.error.message) ||
      String(res.text || '').slice(0, 200) ||
      `HTTP ${res.statusCode}`;
    return {
      ok: false,
      code: 'MODELS_FAIL',
      message: `加载模型失败：${msg}`,
      data: { baseURL: base, statusCode: res.statusCode },
    };
  }
  const list = [];
  const rows = (body && body.data) || [];
  if (Array.isArray(rows)) {
    rows.forEach((row) => {
      const id = String((row && (row.id || row.name)) || '').trim();
      if (id) list.push(id);
    });
  }
  const models = normalizeModels(list.length ? list : DEFAULT_MODELS);
  return {
    ok: true,
    data: {
      baseURL: base,
      statusCode: res.statusCode,
      models,
      tip: models.length
        ? `已加载 ${models.length} 个模型，请选择后保存`
        : '接口成功但未返回模型列表',
    },
  };
}

async function pingCloudbase(cred) {
  const modelName = cred.model || CLOUDBASE_VISION_MODEL;
  try {
    const model = getCloudAiModel();
    const result = await model.generateText({
      model: modelName,
      messages: [{ role: 'user', content: '回复两个字：正常' }],
    });
    const text = String((result && result.text) || '').trim();
    const apiOk = !!text && !(result && result.error);
    return {
      ok: true,
      data: {
        base: 'cloudbase',
        statusCode: apiOk ? 200 : 500,
        apiOk,
        providerId: cred.providerId,
        name: cred.name || '云开发体验模型',
        hasKeys: true,
        keyCount: 0,
        model: modelName,
        models: CLOUDBASE_EXPERIENCE_MODELS.slice(0, 8),
        tip: apiOk
          ? `云开发体验模型连通正常（${modelName}）。${
              CLOUDBASE_VISION_MODELS.includes(modelName)
                ? '当前模型支持识图，可用于封面生成'
                : `注意：${modelName} 不支持图片，封面生成会自动改用 ${CLOUDBASE_VISION_MODELS.join(
                    ' / ',
                  )}`
            }`
          : `调用返回异常：${String((result && result.error) || '无文本').slice(0, 120)}。请确认控制台已开通 AI+ / 成长计划体验模型`,
        bodyOk: apiOk,
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: e.code || 'PING_FAIL',
      message: `云开发体验模型不可用：${e.message || e}。请确认：1) 控制台开通 AI+；2) 属于小程序成长计划/已开体验模型；3) 已升级并部署 generatePackCopy`,
      data: {
        base: 'cloudbase',
        hasKeys: true,
        providerId: cred.providerId,
        name: cred.name || '云开发体验模型',
      },
    };
  }
}

/** 检测连通性 */
async function pingApi(doc, event = {}) {
  const cred = resolveCredential(doc, event);
  // 云开发体验不走 HTTP + API Key
  if (cred.type === 'cloudbase') {
    return pingCloudbase(cred);
  }
  const base = cred.baseURL;
  if (!base || base === 'cloudbase') {
    return {
      ok: false,
      code: 'NO_CONFIG',
      message: '尚未配置 AI：可添加「云开发体验模型」或填写自备 baseURL / API Key',
      data: { base: '', hasKeys: false },
    };
  }
  if (!cred.apiKey) {
    return {
      ok: false,
      code: 'NO_KEY',
      message: '自备接口未配置 API Key（云开发体验模型无需 Key，请用「添加云开发体验」）',
      data: { base, hasKeys: false, providerId: cred.providerId, name: cred.name },
    };
  }
  try {
    const res = await httpRequest(`${base}/models`, {
      method: 'GET',
      timeoutMs: 12000,
      headers: { Authorization: `Bearer ${cred.apiKey}` },
    });
    let body = null;
    try {
      body = res.text ? JSON.parse(res.text) : null;
    } catch (e) {
      body = null;
    }
    const apiOk = res.statusCode >= 200 && res.statusCode < 300;
    const modelsFromApi = [];
    if (apiOk && body && Array.isArray(body.data)) {
      body.data.forEach((row) => {
        const id = String((row && (row.id || row.name)) || '').trim();
        if (id) modelsFromApi.push(id);
      });
    }
    const selected =
      cred.model ||
      (cred.provider && cred.provider.model) ||
      (modelsFromApi[0] || DEFAULT_MODELS[0]);
    return {
      ok: true,
      data: {
        base,
        statusCode: res.statusCode,
        apiOk,
        providerId: cred.providerId,
        name: cred.name || '',
        hasKeys: true,
        keyCount: 1,
        model: selected,
        models: normalizeModels(
          modelsFromApi.length
            ? modelsFromApi
            : (cred.provider && cred.provider.models) || [selected],
        ).slice(0, 8),
        tip: apiOk
          ? `连通正常（${cred.name || base}），可生成文案`
          : `已访问 ${base}，但未通过鉴权（HTTP ${res.statusCode}）。请检查 API Key`,
        raw: String(res.text || '').slice(0, 160),
        bodyOk: !!(body && (body.data || body.object)),
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: 'PING_FAIL',
      message: `无法访问 AI API（${base}）：${e.message || e}`,
      data: {
        base,
        hasKeys: !!cred.apiKey,
        providerId: cred.providerId,
        name: cred.name || '',
      },
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

const CONTENT_TYPE_LABELS = {
  emoji: '表情',
  wallpaper: '壁纸',
  avatar: '头像',
  video: '视频',
};

function normalizeContentType(value) {
  const t = String(value || '').trim();
  return CONTENT_TYPE_LABELS[t] ? t : 'emoji';
}

function contentTypeLabel(value) {
  return CONTENT_TYPE_LABELS[normalizeContentType(value)];
}

function buildPrompt(categoryName, includeArticle, contentType) {
  const type = normalizeContentType(contentType);
  const typeName = contentTypeLabel(type);
  const theme = String(categoryName || '').trim() || typeName;
  const typeHint =
    type === 'wallpaper'
      ? '这是壁纸合集：文案侧重手机/桌面壁纸观感、构图与氛围，不要写成表情包。'
      : type === 'avatar'
        ? '这是头像合集：文案侧重头像气质、适用社交场景，不要写成表情包。'
        : type === 'video'
          ? '这是视频合集：文案侧重短视频氛围与适用场景，不要写成静态表情包。'
          : '这是表情合集：可结合封面风格、配色、表情氛围补充，但角色名须围绕主题。';
  const articleBlock = includeArticle
    ? `3. article：适合发「微信公众号」的推文正文（纯文本，可分段），约 200～450 字；语气温馨可爱，可穿插少量 emoji；围绕「${theme}」与「${typeName}合集」写亮点、适用场景、结尾引导（如下载小程序「趣图铺子」查看合集），不要写 Markdown 标题符号 #，不要编造不存在的价格/活动。

只输出一个 JSON 对象，不要其它说明，格式：
{"title":"...","description":"...","article":"..."}`
    : `不要生成公众号长文，也不要输出 article 字段。

只输出一个 JSON 对象，不要其它说明，格式：
{"title":"...","description":"..."}`;

  return `你是微信生态内容运营助手。请根据「合集类型」「主题分类」和这张合集封面图，生成中文文案。语气要可爱、温馨、亲切，像朋友分享好物，可自然穿插少量 emoji（如 ✨💕🌸🐾🌈😊🥰 等），不要堆砌、不要每句都加。

【合集类型】
${typeName}

【主题分类（以它为准识别角色/系列，不要猜错；若仅有类型名则按类型写）】
${theme}

说明：封面图可能画风抽象，仅靠识图容易认错角色。文案中的角色名、系列名必须围绕上述主题分类展开。${typeHint}

要求：
1. title：合集标题，适合小程序列表展示，中文约 12 字以内（可另加 1～2 个可爱 emoji），带一点吸引力，不要引号；应能看出与「${theme}」相关，并可自然体现「${typeName}」。
2. description：用户可见简介，1～3 句，可换行，合计不超过 120 字；语气轻松温馨，可点缀 2～4 个 emoji；点明主题「${theme}」与合集类型「${typeName}」。
${articleBlock}`;
}

function parseCopyResult(text, includeArticle) {
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

function buildVisionMessages(mimeType, base64, categoryName, includeArticle, contentType) {
  // 多模态建议图片在前，避免部分模型忽略封面
  return [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64}`,
          },
        },
        {
          type: 'text',
          text: buildPrompt(categoryName, includeArticle, contentType),
        },
      ],
    },
  ];
}

async function callCloudbaseOnce(
  modelName,
  mimeType,
  base64,
  categoryName,
  includeArticle,
  contentType,
) {
  const model = getCloudAiModel();
  const result = await model.generateText({
    model: modelName,
    messages: buildVisionMessages(
      mimeType,
      base64,
      categoryName,
      includeArticle,
      contentType,
    ),
    temperature: 0.7,
  });
  if (result && result.error) {
    const err = new Error(
      typeof result.error === 'string'
        ? result.error
        : (result.error && result.error.message) || '云开发 AI 调用失败',
    );
    err.retryable = /quota|rate|limit|并发|busy/i.test(err.message);
    throw err;
  }
  const text = String((result && result.text) || '').trim();
  return parseCopyResult(text, includeArticle);
}

async function callChatOnce(
  baseURL,
  apiKey,
  model,
  mimeType,
  base64,
  categoryName,
  includeArticle,
  contentType,
) {
  const base = normalizeBaseURL(baseURL);
  const url = `${base}/chat/completions`;
  const body = {
    model,
    messages: buildVisionMessages(
      mimeType,
      base64,
      categoryName,
      includeArticle,
      contentType,
    ),
    temperature: 0.7,
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
  return parseCopyResult(text, includeArticle);
}

function modelsForProvider(provider) {
  if (!provider) return DEFAULT_MODELS.slice();
  const preferred = String(provider.model || '').trim();
  let list = normalizeModels(provider.models || []);
  // 封面识图：云开发体验优先保证走支持图片的模型
  if (isCloudbaseProvider(provider)) {
    const vision = CLOUDBASE_VISION_MODELS.slice();
    const visionSet = new Set(vision);
    if (preferred && visionSet.has(preferred)) {
      list = [preferred, ...vision.filter((m) => m !== preferred)];
    } else if (preferred && !visionSet.has(preferred)) {
      // 选了纯文本模型：先试识图模型，再回退用户所选（避免静默不看图）
      list = [...vision, preferred, ...list.filter((m) => m !== preferred && !visionSet.has(m))];
    } else {
      list = normalizeModels([...vision, ...list]);
    }
    return list.length ? list : [CLOUDBASE_VISION_MODEL];
  }
  if (preferred) {
    return [preferred, ...list.filter((m) => m !== preferred)];
  }
  if (list.length) return list;
  return DEFAULT_MODELS.slice();
}

async function callWithFailover(
  doc,
  mimeType,
  base64,
  categoryName,
  includeArticle,
  contentType,
) {
  const active = getActiveProvider(doc);
  const cloudbase = isCloudbaseProvider(active);
  if (!active || (!cloudbase && !active.apiKey)) {
    const err = new Error(
      '未配置可用 AI：请管理员在「我的」顶栏连点「我的」3 次进入 AI 配置，添加「云开发体验模型」或自备 Key 后再用',
    );
    err.code = 'NO_KEY';
    throw err;
  }
  const models = modelsForProvider(active);
  if (!models.length) {
    const err = new Error('未选择模型：请先刷新模型列表并选择一个识图模型后保存');
    err.code = 'NO_MODEL';
    throw err;
  }

  let lastErr = null;
  for (let mi = 0; mi < models.length; mi += 1) {
    const model = models[mi];
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = cloudbase
        ? await callCloudbaseOnce(
            model,
            mimeType,
            base64,
            categoryName,
            includeArticle,
            contentType,
          )
        : await callChatOnce(
            active.baseURL,
            active.apiKey,
            model,
            mimeType,
            base64,
            categoryName,
            includeArticle,
            contentType,
          );
      return {
        ...data,
        model,
        providerId: active.id,
        providerName: active.name,
        baseURL: active.baseURL,
        type: cloudbase ? 'cloudbase' : 'custom',
      };
    } catch (e) {
      lastErr = e;
      console.warn(
        `[generatePackCopy] provider=${active.id} model=${model} base=${active.baseURL} fail`,
        e.message || e,
      );
      if (isNetworkBlocked(e)) {
        throw networkBlockedError(active.baseURL);
      }
      if (/not found|invalid|UNSUPPORTED|404|does not support image|不支持.*图/i.test(e.message || '')) {
        continue;
      }
      if (e.retryable) continue;
    }
  }
  if (isNetworkBlocked(lastErr)) {
    throw networkBlockedError(active.baseURL);
  }
  const tip =
    (lastErr && lastErr.retryable) ||
    /quota|rate|429|insufficient|余额|balance|并发/i.test((lastErr && lastErr.message) || '')
      ? cloudbase
        ? '体验模型限流或并发已满（环境约 5 路），请稍后重试'
        : '余额不足或触发限流，请到对应平台充值后再试'
      : (lastErr && lastErr.message) || 'AI 调用失败';
  const err = new Error(tip);
  err.code = (lastErr && lastErr.code) || 'GEN_FAIL';
  throw err;
}

async function handleGetConfig() {
  const doc = await getAiDoc(db);
  return { ok: true, data: publicAiDoc(doc) };
}

async function handleSaveConfig(event, openid) {
  const existing = await getAiDoc(db);
  const next = mergeProviders(
    existing,
    event.providers,
    event.activeProviderId != null ? event.activeProviderId : existing.activeProviderId,
  );
  const missingKey = next.providers.find((p) => !isCloudbaseProvider(p) && !p.apiKey);
  if (missingKey) {
    return {
      ok: false,
      code: 'NO_KEY',
      message: `「${missingKey.name}」缺少 API Key`,
    };
  }
  const saved = await saveAiDoc(db, next, { openid });
  return {
    ok: true,
    message: 'AI 配置已保存',
    data: publicAiDoc(saved),
  };
}

async function handleSetActive(event, openid) {
  const providerId = String((event && event.providerId) || '').trim();
  if (!providerId) {
    return { ok: false, code: 'BAD_PARAM', message: '缺少 providerId' };
  }
  const existing = await getAiDoc(db);
  if (!(existing.providers || []).some((p) => p.id === providerId)) {
    return { ok: false, code: 'NOT_FOUND', message: '配置不存在' };
  }
  const saved = await saveAiDoc(
    db,
    { ...existing, activeProviderId: providerId },
    { openid },
  );
  return {
    ok: true,
    message: '已切换当前 AI 配置',
    data: publicAiDoc(saved),
  };
}

async function handleSetModel(event, openid) {
  const providerId = String((event && event.providerId) || '').trim();
  const model = String((event && event.model) || '').trim();
  if (!providerId || !model) {
    return { ok: false, code: 'BAD_PARAM', message: '请指定配置与模型' };
  }
  const existing = await getAiDoc(db);
  const providers = (existing.providers || []).map((p) => {
    if (p.id !== providerId) return p;
    const models = normalizeModels([model, ...(p.models || [])]);
    return normalizeProvider({ ...p, model, models }, p);
  });
  if (!providers.some((p) => p.id === providerId)) {
    return { ok: false, code: 'NOT_FOUND', message: '配置不存在' };
  }
  const saved = await saveAiDoc(
    db,
    { ...existing, providers },
    { openid },
  );
  return {
    ok: true,
    message: '已选择模型',
    data: publicAiDoc(saved),
  };
}

async function handleListModels(event) {
  const doc = await getAiDoc(db);
  const cred = resolveCredential(doc, event);
  try {
    const result = await fetchModels(cred.baseURL, cred.apiKey, cred.type);
    if (result.ok && event && event.persist && cred.providerId) {
      const models = result.data.models || [];
      const providers = (doc.providers || []).map((p) => {
        if (p.id !== cred.providerId) return p;
        const model =
          (p.model && models.includes(p.model) ? p.model : '') || models[0] || p.model || '';
        return normalizeProvider({ ...p, models, model }, p);
      });
      const saved = await saveAiDoc(db, { ...doc, providers }, {});
      result.data.config = publicAiDoc(saved);
      result.data.providerId = cred.providerId;
    }
    return result;
  } catch (e) {
    if (isNetworkBlocked(e)) {
      return {
        ok: false,
        code: 'PING_FAIL',
        message: `无法访问 ${cred.baseURL || '-'}：${e.message || e}`,
      };
    }
    return {
      ok: false,
      code: 'MODELS_FAIL',
      message: e.message || '加载模型失败',
    };
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  const action = (event && event.action) || 'generate';

  try {
    if (action === 'getConfig') {
      return await handleGetConfig();
    }
    if (action === 'saveConfig') {
      return await handleSaveConfig(event, OPENID);
    }
    if (action === 'setActive') {
      return await handleSetActive(event, OPENID);
    }
    if (action === 'setModel') {
      return await handleSetModel(event, OPENID);
    }
    if (action === 'listModels') {
      return await handleListModels(event);
    }
    if (action === 'ping') {
      const doc = await getAiDoc(db);
      return await pingApi(doc, event);
    }

    const coverFileID = (event && event.coverFileID) || '';
    const contentType = normalizeContentType(event && event.contentType);
    const categoryName = String((event && event.categoryName) || '').trim();
    const includeArticle = !!(event && event.includeArticle);
    const promptTheme = categoryName || contentTypeLabel(contentType);
    if (!promptTheme) {
      return { ok: false, code: 'BAD_PARAM', message: '请先选择主题分类' };
    }
    if (!coverFileID || !String(coverFileID).startsWith('cloud://')) {
      return { ok: false, code: 'BAD_PARAM', message: '请先上传封面' };
    }

    const doc = await getAiDoc(db);
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
      doc,
      mimeType,
      base64,
      promptTheme,
      includeArticle,
      contentType,
    );
    return {
      ok: true,
      data: { ...data, categoryName: promptTheme, contentType },
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
