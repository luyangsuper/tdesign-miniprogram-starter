/**
 * 定价目录（app_config/pricing）
 * 槽位 key（vip_month 等）稳定；微信 productId 可随改价轮换（已上线道具不能改价，只能发新 ID）
 */

const DEFAULT_PRODUCTS = {
  vip_month: {
    productId: 'vip_month',
    planKey: 'month',
    title: '趣集包月',
    type: 'vip_days',
    value: 30,
    priceFen: 1000,
  },
  vip_quarter: {
    productId: 'vip_quarter',
    planKey: 'quarter',
    title: '趣集季卡',
    type: 'vip_days',
    value: 90,
    priceFen: 2500,
  },
  vip_year: {
    productId: 'vip_year',
    planKey: 'year',
    title: '趣集年卡',
    type: 'vip_days',
    value: 365,
    priceFen: 6800,
  },
  points_20: {
    productId: 'points_20',
    planKey: 'p0',
    title: '积分20',
    type: 'points',
    value: 20,
    priceFen: 600,
  },
  points_66: {
    productId: 'points_66',
    planKey: 'p1',
    title: '积分66',
    type: 'points',
    value: 66,
    priceFen: 1500,
  },
  points_170: {
    productId: 'points_170',
    planKey: 'p2',
    title: '积分170',
    type: 'points',
    value: 170,
    priceFen: 3000,
  },
};

/** 槽位 id（云库 products 的 key），不等于微信 productId */
const PRODUCT_IDS = Object.keys(DEFAULT_PRODUCTS);

const SLOT_PREFIX = {
  vip_month: 'm',
  vip_quarter: 'q',
  vip_year: 'y',
  points_20: 'p0',
  points_66: 'p1',
  points_170: 'p2',
};

const WX_STATUS = ['ok', 'syncing', 'ready', 'fail', 'await_mp'];

function emptyWx() {
  return { status: 'ok', error: '', at: null, syncStartedAt: null };
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

/** 微信道具 id：长度 (0,20]，字母数字 _ - */
function isValidWxProductId(id) {
  const s = String(id || '');
  return s.length > 0 && s.length <= 20 && /^[A-Za-z0-9_-]+$/.test(s);
}

/**
 * 生成不重复的新道具 ID（改价用）
 * 例：m_200_a1b2c3
 */
function genProductId(slotId, priceFen) {
  const prefix = SLOT_PREFIX[slotId] || 'g';
  const fen = clampInt(priceFen, 1, 99999900, 100);
  const rand = Math.random().toString(36).slice(2, 8);
  let id = `${prefix}_${fen}_${rand}`;
  if (id.length > 20) id = `${prefix}${fen}${rand}`.slice(0, 20);
  return id;
}

function normalizeProduct(raw, fallback, slotId) {
  const slot = String(slotId || (fallback && fallback._slotId) || '').trim();
  const def = (slot && DEFAULT_PRODUCTS[slot]) || fallback || {};
  let productId = String((raw && raw.productId) || def.productId || slot || '').trim();
  if (!isValidWxProductId(productId)) productId = def.productId || slot;

  const type = raw && raw.type === 'points' ? 'points' : def.type || 'vip_days';
  const wxRaw = (raw && raw.wx) || {};
  const draftRaw = raw && raw.draft;
  let draft = null;
  if (draftRaw && typeof draftRaw === 'object') {
    let draftPid = String(draftRaw.productId || '').trim();
    if (!isValidWxProductId(draftPid)) draftPid = '';
    draft = {
      productId: draftPid,
      title: String(draftRaw.title || '').trim().slice(0, 20) || def.title,
      value: clampInt(draftRaw.value, 1, 99999, def.value),
      priceFen: clampInt(draftRaw.priceFen, 1, 99999900, def.priceFen),
    };
  }
  return {
    slotId: slot || def.productId || productId,
    productId,
    planKey: String((raw && raw.planKey) || def.planKey || '').trim(),
    title: String((raw && raw.title) || def.title || productId).trim().slice(0, 20),
    type,
    value: clampInt(raw && raw.value, 1, 99999, def.value),
    priceFen: clampInt(raw && raw.priceFen, 1, 99999900, def.priceFen),
    itemFileId: String((raw && raw.itemFileId) || '').trim(),
    wx: {
      status: WX_STATUS.includes(wxRaw.status) ? wxRaw.status : 'ok',
      error: String(wxRaw.error || '').slice(0, 500),
      at: wxRaw.at || null,
      syncStartedAt: wxRaw.syncStartedAt || null,
    },
    draft,
  };
}

function buildDefaultDoc() {
  const products = {};
  PRODUCT_IDS.forEach((id) => {
    products[id] = normalizeProduct(
      { ...DEFAULT_PRODUCTS[id], itemFileId: '', wx: emptyWx(), draft: null },
      DEFAULT_PRODUCTS[id],
      id,
    );
  });
  return { products };
}

function normalizePricingDoc(raw = {}) {
  const defaults = buildDefaultDoc();
  const src = (raw && raw.products) || {};
  const products = {};
  PRODUCT_IDS.forEach((id) => {
    products[id] = normalizeProduct(src[id] || defaults.products[id], defaults.products[id], id);
  });
  return { products };
}

function toLiveProduct(entry, slotId) {
  if (!entry) return null;
  const slot = slotId || entry.slotId || '';
  return {
    slotId: slot,
    productId: entry.productId,
    planKey: entry.planKey,
    title: entry.title,
    type: entry.type,
    value: entry.value,
    priceFen: entry.priceFen,
  };
}

async function ensureAppConfigCollection(db) {
  try {
    await db.createCollection('app_config');
  } catch (e) {
    /* ignore */
  }
}

async function getPricingDoc(db) {
  try {
    const snap = await db.collection('app_config').doc('pricing').get();
    return normalizePricingDoc((snap && snap.data) || {});
  } catch (e) {
    return buildDefaultDoc();
  }
}

async function savePricingDoc(db, doc, meta = {}) {
  const next = normalizePricingDoc(doc);
  await ensureAppConfigCollection(db);
  const payload = {
    products: next.products,
    updatedAt: db.serverDate(),
    updatedBy: meta.openid || '',
  };
  try {
    await db.collection('app_config').doc('pricing').set({ data: payload });
  } catch (e) {
    const msg = String((e && (e.errMsg || e.message)) || e || '');
    if (/COLLECTION_NOT_EXIST|collection not exists|Db or Table not exist/i.test(msg)) {
      await ensureAppConfigCollection(db);
      await db.collection('app_config').doc('pricing').set({ data: payload });
    } else {
      throw e;
    }
  }
  return next;
}

/** 按下单传来的微信 productId 查 live（支持轮换后的新 ID）；也认槽位 id */
async function getLiveProduct(db, productId) {
  const id = String(productId || '').trim();
  if (!id) return null;
  try {
    const doc = await getPricingDoc(db);
    for (const slot of PRODUCT_IDS) {
      const entry = doc.products[slot];
      if (entry && entry.productId === id) return toLiveProduct(entry, slot);
    }
    // 客户端可能仍传槽位 id（vip_month），改价轮换后 live.productId 已变
    if (PRODUCT_IDS.includes(id) && doc.products[id]) {
      return toLiveProduct(doc.products[id], id);
    }
  } catch (e) {
    /* fallback */
  }
  if (DEFAULT_PRODUCTS[id]) return { ...DEFAULT_PRODUCTS[id], slotId: id };
  return null;
}

function productIdByPlanKeyFromDoc(doc, planKey) {
  const key = String(planKey || '').trim();
  if (!key) return '';
  const products = (doc && doc.products) || {};
  const hit = Object.values(products).find((p) => p && p.planKey === key);
  return hit ? hit.productId : '';
}

async function productIdByPlanKey(db, planKey) {
  try {
    const doc = await getPricingDoc(db);
    const id = productIdByPlanKeyFromDoc(doc, planKey);
    if (id) return id;
  } catch (e) {
    /* fallback */
  }
  const hit = Object.values(DEFAULT_PRODUCTS).find((p) => p.planKey === String(planKey || '').trim());
  return hit ? hit.productId : '';
}

/**
 * 下单解析：优先稳定键 slotId / planKey，再才用微信 productId
 * （改价轮换后客户端缓存的 productId 可能已过期）
 */
async function resolveLiveProduct(db, query = {}) {
  const slotId = String((query && query.slotId) || '').trim();
  const planKey = String((query && query.planKey) || '').trim();
  const productId = String((query && query.productId) || '').trim();

  if (slotId && PRODUCT_IDS.includes(slotId)) {
    try {
      const doc = await getPricingDoc(db);
      if (doc.products[slotId]) return toLiveProduct(doc.products[slotId], slotId);
    } catch (e) {
      /* fallback */
    }
    if (DEFAULT_PRODUCTS[slotId]) return { ...DEFAULT_PRODUCTS[slotId], slotId };
  }

  if (planKey) {
    try {
      const doc = await getPricingDoc(db);
      for (const slot of PRODUCT_IDS) {
        const entry = doc.products[slot];
        if (entry && entry.planKey === planKey) return toLiveProduct(entry, slot);
      }
    } catch (e) {
      /* fallback */
    }
    const hit = Object.entries(DEFAULT_PRODUCTS).find(([, p]) => p.planKey === planKey);
    if (hit) return { ...hit[1], slotId: hit[0] };
  }

  return getLiveProduct(db, productId);
}

function listLiveProducts(doc) {
  const normalized = normalizePricingDoc(doc || {});
  return PRODUCT_IDS.map((id) => toLiveProduct(normalized.products[id], id));
}

module.exports = {
  DEFAULT_PRODUCTS,
  PRODUCT_IDS,
  SLOT_PREFIX,
  emptyWx,
  normalizeProduct,
  normalizePricingDoc,
  buildDefaultDoc,
  toLiveProduct,
  getPricingDoc,
  savePricingDoc,
  getLiveProduct,
  resolveLiveProduct,
  productIdByPlanKey,
  productIdByPlanKeyFromDoc,
  listLiveProducts,
  clampInt,
  genProductId,
  isValidWxProductId,
};
