/**
 * 合集氛围配置（app_config/packMood）
 * - get：全员可读
 * - setOverlay / clearOverlay / reset：仅管理员
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DOC_ID = 'packMood';
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];
const MOOD_IDS = [
  'viral',
  'rising',
  'revived',
  'fresh',
  'popular',
  'sleeping',
  'cold',
];

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

function pickOverlay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fileID = String(raw.fileID || '').trim();
  if (!fileID) return null;
  const bg = raw.bg === 'light' ? 'light' : 'dark';
  const out = {
    fileID,
    bg,
    effectKey: String(raw.effectKey || '').trim(),
    color: String(raw.color || '').trim().toLowerCase(),
    name: String(raw.name || '').trim(),
  };
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (Number.isFinite(w) && w > 0) out.w = Math.floor(w);
  if (Number.isFinite(h) && h > 0) out.h = Math.floor(h);
  return out;
}

function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const overlaysIn =
    src.overlays && typeof src.overlays === 'object' ? src.overlays : {};
  const overlays = {};
  MOOD_IDS.forEach((id) => {
    const hit = pickOverlay(overlaysIn[id]);
    if (hit) overlays[id] = hit;
  });
  return {
    overlays,
    updatedAt: src.updatedAt || null,
  };
}

async function readDoc() {
  await ensureCollection('app_config');
  try {
    const snap = await db.collection('app_config').doc(DOC_ID).get();
    return normalizeDoc(snap && snap.data);
  } catch (e) {
    return normalizeDoc({});
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

exports.main = async (event = {}) => {
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

    if (action === 'setOverlay') {
      const moodId = String(event.moodId || '').trim();
      if (!MOOD_IDS.includes(moodId)) {
        return { ok: false, code: 'BAD_MOOD', message: '未知氛围状态' };
      }
      const overlay = pickOverlay(event.overlay || event);
      if (!overlay) {
        return { ok: false, code: 'BAD_FILE', message: '缺少 fileID' };
      }
      const doc = await readDoc();
      const overlays = { ...(doc.overlays || {}), [moodId]: overlay };
      const saved = await writeDoc({ overlays });
      return { ok: true, data: saved };
    }

    if (action === 'clearOverlay') {
      const moodId = String(event.moodId || '').trim();
      if (!MOOD_IDS.includes(moodId)) {
        return { ok: false, code: 'BAD_MOOD', message: '未知氛围状态' };
      }
      const doc = await readDoc();
      const overlays = { ...(doc.overlays || {}) };
      delete overlays[moodId];
      const saved = await writeDoc({ overlays });
      return { ok: true, data: saved };
    }

    if (action === 'reset') {
      const saved = await writeDoc({ overlays: {} });
      return { ok: true, data: saved };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error('packMoodConfig', e);
    return { ok: false, code: 'FAIL', message: e.message || '失败' };
  }
};
