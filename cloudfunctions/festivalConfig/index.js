/**
 * 节日氛围配置（app_config/festival）
 * - get：全员可读
 * - setEnabled / setBanner / clearBanner / setBank / clearBank / setWindow / clearWindow：仅管理员
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DOC_ID = 'festival';
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

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    /* ignore */
  }
}

function pickFileMap(src) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  Object.keys(src).forEach((k) => {
    const v = String(src[k] || '').trim();
    if (v) out[k] = v;
  });
  return out;
}

function pad2(n) {
  return `${Number(n)}`.padStart(2, '0');
}

function parseMonthDay(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const full = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (full) {
    const month = Number(full[2]);
    const day = Number(full[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day };
  }
  const md = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!md) return null;
  const month = Number(md[1]);
  const day = Number(md[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function pickWindowEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = parseMonthDay(raw.start);
  const end = parseMonthDay(raw.end);
  if (!start || !end) return null;
  return {
    start: `${pad2(start.month)}-${pad2(start.day)}`,
    end: `${pad2(end.month)}-${pad2(end.day)}`,
  };
}

function pickWindowMap(src) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  Object.keys(src).forEach((k) => {
    const w = pickWindowEntry(src[k]);
    if (w) out[k] = w;
  });
  return out;
}

function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: !!src.enabled,
    banners: pickFileMap(src.banners),
    banks: pickFileMap(src.banks),
    windows: pickWindowMap(src.windows),
    updatedAt: src.updatedAt || null,
  };
}

async function readDoc() {
  await ensureCollection('app_config');
  try {
    const snap = await db.collection('app_config').doc(DOC_ID).get();
    return normalizeDoc(snap && snap.data);
  } catch (e) {
    return normalizeDoc({
      enabled: false,
      banners: {},
      banks: {},
      windows: {},
    });
  }
}

async function writeDoc(payload) {
  await ensureCollection('app_config');
  const data = {
    ...normalizeDoc(payload),
    updatedAt: Date.now(),
  };
  try {
    await db.collection('app_config').doc(DOC_ID).set({ data });
  } catch (e) {
    await db.collection('app_config').doc(DOC_ID).set({ data });
  }
  return data;
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'get').trim();
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  try {
    if (action === 'get') {
      const doc = await readDoc();
      return { ok: true, data: doc };
    }

    if (!assertAdmin(openid)) {
      return { ok: false, code: 'FORBIDDEN', message: '无权限' };
    }

    if (action === 'setEnabled') {
      const doc = await readDoc();
      doc.enabled = !!(event && event.enabled);
      const saved = await writeDoc(doc);
      return { ok: true, data: saved };
    }

    if (action === 'setBanner') {
      const festivalId = String((event && event.festivalId) || '').trim();
      const fileID = String((event && event.fileID) || '').trim();
      if (!festivalId) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 festivalId' };
      }
      if (!fileID) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 fileID' };
      }
      const doc = await readDoc();
      doc.banners[festivalId] = fileID;
      const saved = await writeDoc(doc);
      return { ok: true, data: saved };
    }

    if (action === 'clearBanner') {
      const festivalId = String((event && event.festivalId) || '').trim();
      if (!festivalId) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 festivalId' };
      }
      const doc = await readDoc();
      delete doc.banners[festivalId];
      const saved = await writeDoc(doc);
      return { ok: true, data: saved };
    }

    if (action === 'setBank') {
      const festivalId = String((event && event.festivalId) || '').trim();
      const fileID = String((event && event.fileID) || '').trim();
      if (!festivalId) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 festivalId' };
      }
      if (!fileID) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 fileID' };
      }
      const doc = await readDoc();
      doc.banks[festivalId] = fileID;
      const saved = await writeDoc(doc);
      return { ok: true, data: saved };
    }

    if (action === 'clearBank') {
      const festivalId = String((event && event.festivalId) || '').trim();
      if (!festivalId) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 festivalId' };
      }
      const doc = await readDoc();
      delete doc.banks[festivalId];
      const saved = await writeDoc(doc);
      return { ok: true, data: saved };
    }

    if (action === 'setWindow') {
      const festivalId = String((event && event.festivalId) || '').trim();
      const start = parseMonthDay(event && event.start);
      const end = parseMonthDay(event && event.end);
      if (!festivalId) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 festivalId' };
      }
      if (!start || !end) {
        return { ok: false, code: 'BAD_REQUEST', message: '起止日期无效' };
      }
      const doc = await readDoc();
      doc.windows[festivalId] = {
        start: `${pad2(start.month)}-${pad2(start.day)}`,
        end: `${pad2(end.month)}-${pad2(end.day)}`,
      };
      const saved = await writeDoc(doc);
      return { ok: true, data: saved };
    }

    if (action === 'clearWindow') {
      const festivalId = String((event && event.festivalId) || '').trim();
      if (!festivalId) {
        return { ok: false, code: 'BAD_REQUEST', message: '缺少 festivalId' };
      }
      const doc = await readDoc();
      delete doc.windows[festivalId];
      const saved = await writeDoc(doc);
      return { ok: true, data: saved };
    }

    return { ok: false, code: 'BAD_REQUEST', message: `未知 action: ${action}` };
  } catch (err) {
    return {
      ok: false,
      code: 'INTERNAL',
      message: (err && err.message) || '节日配置失败',
    };
  }
};
