/**
 * AI 文案生成配置（app_config/ai）
 * - custom：OpenAI 兼容（baseURL + apiKey）
 * - cloudbase：云开发体验/资源点模型（cloud.ai()，免自备 Key）
 * @see https://docs.cloudbase.net/ai/model/overview
 */

const DEFAULT_MODELS = ['deepseek-flash', 'deepseek-v4-flash-vision-exp'];
const DEFAULT_BASE = 'https://api.deepseek.com';

/**
 * 小程序成长计划可抵扣模型（官方公告）
 * @see https://docs.cloudbase.net/ai/ai-inspire-plan-new-models-2026-11
 */
const CLOUDBASE_MODEL_META = [
  { id: 'hy4', vision: true, ctx: '1M' },
  { id: 'hy4-preview', vision: false, ctx: '1M' },
  { id: 'hy3', vision: false, ctx: '256K' },
  { id: 'deepseek-v4.1-flash', vision: true, ctx: '1M' },
  { id: 'deepseek-v4.1-flash-1017', vision: true, ctx: '1M' },
];

const CLOUDBASE_EXPERIENCE_MODELS = CLOUDBASE_MODEL_META.map((m) => m.id);
const CLOUDBASE_VISION_MODELS = CLOUDBASE_MODEL_META.filter((m) => m.vision).map((m) => m.id);
const CLOUDBASE_VISION_MODEL = 'hy4';

function mergeCloudbaseModels(list) {
  return normalizeModels([...CLOUDBASE_EXPERIENCE_MODELS, ...(list || [])]);
}

function cloudbaseModelOptions(list) {
  const ids = mergeCloudbaseModels(list);
  const metaMap = {};
  CLOUDBASE_MODEL_META.forEach((m) => {
    metaMap[m.id] = m;
  });
  return ids.map((id) => {
    const meta = metaMap[id] || { id, vision: false, ctx: '' };
    return {
      id,
      vision: !!meta.vision,
      ctx: meta.ctx || '',
      label: meta.vision ? `${id} · 识图` : id,
    };
  });
}

function genProviderId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBaseURL(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '');
}

function maskApiKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

function looksMaskedApiKey(key) {
  return /\*{2,}/.test(String(key || ''));
}

function normalizeModels(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((m) => {
    const id = String(m || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out.slice(0, 200);
}

function resolveType(raw, prev) {
  const t = String((raw && raw.type) || (prev && prev.type) || '').trim().toLowerCase();
  if (t === 'cloudbase') return 'cloudbase';
  const base = normalizeBaseURL((raw && raw.baseURL) || (prev && prev.baseURL) || '');
  if (base === 'cloudbase') return 'cloudbase';
  return 'custom';
}

function isCloudbaseProvider(p) {
  return !!(p && (p.type === 'cloudbase' || p.baseURL === 'cloudbase'));
}

function buildCloudbaseProvider(overrides = {}) {
  return normalizeProvider({
    id: 'cloudbase_experience',
    type: 'cloudbase',
    name: '云开发体验模型',
    baseURL: 'cloudbase',
    apiKey: '',
    model: CLOUDBASE_VISION_MODEL,
    models: CLOUDBASE_EXPERIENCE_MODELS.slice(),
    ...overrides,
  });
}

function normalizeProvider(raw = {}, prev = null) {
  const type = resolveType(raw, prev);
  const id = String((raw && raw.id) || (prev && prev.id) || '').trim() || genProviderId();
  let apiKey = String((raw && raw.apiKey) || '').trim();
  if ((!apiKey || looksMaskedApiKey(apiKey)) && prev && prev.apiKey) {
    apiKey = prev.apiKey;
  }

  let models = normalizeModels(
    raw && raw.models != null ? raw.models : (prev && prev.models) || [],
  );
  if (type === 'cloudbase') {
    models = mergeCloudbaseModels(models);
  }

  let model = String((raw && raw.model) || (prev && prev.model) || '').trim();
  if (type === 'cloudbase' && !model) {
    model = CLOUDBASE_VISION_MODEL;
  }
  if (model && models.length && !models.includes(model)) {
    models.unshift(model);
  }
  if (!model && models.length) model = models[0];

  const baseURL =
    type === 'cloudbase'
      ? 'cloudbase'
      : normalizeBaseURL((raw && raw.baseURL) || (prev && prev.baseURL) || '') || DEFAULT_BASE;

  return {
    id,
    type,
    name:
      String((raw && raw.name) || (prev && prev.name) || (type === 'cloudbase' ? '云开发体验模型' : '未命名'))
        .trim()
        .slice(0, 40) || (type === 'cloudbase' ? '云开发体验模型' : '未命名'),
    baseURL,
    apiKey: type === 'cloudbase' ? '' : apiKey,
    model,
    models,
  };
}

function buildDefaultFromEnv() {
  const keys = String(process.env.DEEPSEEK_API_KEYS || process.env.DEEPSEEK_API_KEY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromList = String(process.env.DEEPSEEK_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const preferred = String(process.env.DEEPSEEK_MODEL || '').trim();
  let models = fromList.length ? fromList : DEFAULT_MODELS.slice();
  if (preferred) {
    models = [preferred, ...models.filter((m) => m !== preferred)];
  }
  const baseURL = normalizeBaseURL(process.env.DEEPSEEK_API_BASE || DEFAULT_BASE) || DEFAULT_BASE;

  // 无自备 Key 时默认给云开发体验模型（成长计划免费）
  if (!keys.length) {
    const p = buildCloudbaseProvider();
    return { activeProviderId: p.id, providers: [p] };
  }

  const providers = keys.map((apiKey, i) =>
    normalizeProvider({
      id: `env_${i + 1}`,
      type: 'custom',
      name: keys.length > 1 ? `环境变量 Key#${i + 1}` : '环境变量 DeepSeek',
      baseURL,
      apiKey,
      model: models[0] || '',
      models,
    }),
  );
  return {
    activeProviderId: providers[0].id,
    providers,
  };
}

function normalizeAiDoc(raw = {}) {
  const prevMap = {};
  ((raw && raw.providers) || []).forEach((p) => {
    if (p && p.id) prevMap[p.id] = p;
  });
  const providers = ((raw && raw.providers) || [])
    .map((p) => normalizeProvider(p, prevMap[p && p.id]))
    .filter((p) => p.type === 'cloudbase' || !!p.baseURL);
  let activeProviderId = String((raw && raw.activeProviderId) || '').trim();
  if (activeProviderId && !providers.some((p) => p.id === activeProviderId)) {
    activeProviderId = '';
  }
  if (!activeProviderId && providers.length) {
    activeProviderId = providers[0].id;
  }
  return { activeProviderId, providers };
}

function publicProvider(p, { revealKey = false } = {}) {
  if (!p) return null;
  const cloudbase = isCloudbaseProvider(p);
  return {
    id: p.id,
    type: cloudbase ? 'cloudbase' : 'custom',
    name: p.name,
    baseURL: p.baseURL,
    apiKey: cloudbase ? '' : revealKey ? p.apiKey : maskApiKey(p.apiKey),
    apiKeySet: cloudbase ? true : !!p.apiKey,
    model: p.model || '',
    models: Array.isArray(p.models) ? p.models.slice() : [],
  };
}

function publicAiDoc(doc, opts) {
  const normalized = normalizeAiDoc(doc || {});
  return {
    activeProviderId: normalized.activeProviderId,
    providers: normalized.providers.map((p) => publicProvider(p, opts)),
    experienceModels: CLOUDBASE_EXPERIENCE_MODELS.slice(),
    experienceModelOptions: cloudbaseModelOptions(),
    visionModels: CLOUDBASE_VISION_MODELS.slice(),
    visionHint:
      '封面识图可用：hy4 / deepseek-v4.1-flash / deepseek-v4.1-flash-1017；hy4-preview、hy3 不支持图片',
  };
}

async function ensureAppConfigCollection(db) {
  try {
    await db.createCollection('app_config');
  } catch (e) {
    /* ignore */
  }
}

async function getAiDoc(db) {
  try {
    const snap = await db.collection('app_config').doc('ai').get();
    const data = (snap && snap.data) || {};
    if (data && Array.isArray(data.providers) && data.providers.length) {
      return normalizeAiDoc(data);
    }
  } catch (e) {
    /* fallback */
  }
  return normalizeAiDoc(buildDefaultFromEnv());
}

async function saveAiDoc(db, doc, meta = {}) {
  const next = normalizeAiDoc(doc);
  await ensureAppConfigCollection(db);
  const payload = {
    activeProviderId: next.activeProviderId,
    providers: next.providers,
    updatedAt: db.serverDate(),
    updatedBy: meta.openid || '',
  };
  try {
    await db.collection('app_config').doc('ai').set({ data: payload });
  } catch (e) {
    const msg = String((e && (e.errMsg || e.message)) || e || '');
    if (/COLLECTION_NOT_EXIST|collection not exists|Db or Table not exist/i.test(msg)) {
      await ensureAppConfigCollection(db);
      await db.collection('app_config').doc('ai').set({ data: payload });
    } else {
      throw e;
    }
  }
  return next;
}

function getActiveProvider(doc) {
  const normalized = normalizeAiDoc(doc || {});
  if (!normalized.providers.length) return null;
  return (
    normalized.providers.find((p) => p.id === normalized.activeProviderId) ||
    normalized.providers[0] ||
    null
  );
}

function mergeProviders(existingDoc, incomingProviders, activeProviderId) {
  const prev = normalizeAiDoc(existingDoc || {});
  const prevMap = {};
  prev.providers.forEach((p) => {
    prevMap[p.id] = p;
  });
  const list = Array.isArray(incomingProviders) ? incomingProviders : [];
  const providers = list.map((raw) => {
    const id = String((raw && raw.id) || '').trim();
    return normalizeProvider(raw, id ? prevMap[id] : null);
  });
  return normalizeAiDoc({
    activeProviderId:
      activeProviderId != null ? activeProviderId : prev.activeProviderId,
    providers,
  });
}

module.exports = {
  DEFAULT_MODELS,
  DEFAULT_BASE,
  CLOUDBASE_MODEL_META,
  CLOUDBASE_EXPERIENCE_MODELS,
  CLOUDBASE_VISION_MODELS,
  CLOUDBASE_VISION_MODEL,
  mergeCloudbaseModels,
  cloudbaseModelOptions,
  genProviderId,
  normalizeBaseURL,
  maskApiKey,
  looksMaskedApiKey,
  normalizeModels,
  normalizeProvider,
  normalizeAiDoc,
  buildDefaultFromEnv,
  buildCloudbaseProvider,
  isCloudbaseProvider,
  publicProvider,
  publicAiDoc,
  getAiDoc,
  saveAiDoc,
  getActiveProvider,
  mergeProviders,
};
