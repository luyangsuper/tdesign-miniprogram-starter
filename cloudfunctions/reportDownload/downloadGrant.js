/**
 * 下载扣费凭证：保存失败只能凭本次下发的 grantId 退回，不能任意加额度。
 * 集合 download_grants，客户端不可读写。
 */

const COL = 'download_grants';
const GRANT_TTL_MS = 10 * 60 * 1000;

async function ensureGrantCollection(db) {
  try {
    await db.createCollection(COL);
  } catch (e) {
    /* exists */
  }
}

function nowMs() {
  return Date.now();
}

/**
 * @returns {Promise<string>} grantId
 */
async function createDownloadGrant(db, payload = {}) {
  await ensureGrantCollection(db);
  const openid = String(payload.openid || '').trim();
  const packId = String(payload.packId || '').trim();
  const index = Math.floor(Number(payload.index));
  const variant = payload.variant === 'anim' ? 'anim' : 'static';
  const fromVip = Math.max(0, Math.floor(Number(payload.fromVip) || 0));
  const fromPoints = Math.max(0, Math.floor(Number(payload.fromPoints) || 0));
  const cost = Math.max(0, Math.floor(Number(payload.cost) || 0));
  const grantType = String(payload.grantType || '').trim();
  if (!openid || !packId || Number.isNaN(index) || index < 0) {
    throw new Error('grant 参数错误');
  }
  const createdMs = nowMs();
  try {
    const add = await db.collection(COL).add({
      data: {
        openid,
        packId,
        index,
        variant,
        fromVip,
        fromPoints,
        cost,
        grantType,
        status: 'pending',
        createdMs,
        expiresAt: createdMs + GRANT_TTL_MS,
        createdAt: db.serverDate(),
      },
    });
    return add._id;
  } catch (e) {
    const msg = String((e && (e.message || e.errMsg)) || e || '');
    if (/COLLECTION_NOT_EXIST|not exist/i.test(msg)) {
      await ensureGrantCollection(db);
      const add = await db.collection(COL).add({
        data: {
          openid,
          packId,
          index,
          variant,
          fromVip,
          fromPoints,
          cost,
          grantType,
          status: 'pending',
          createdMs,
          expiresAt: createdMs + GRANT_TTL_MS,
          createdAt: db.serverDate(),
        },
      });
      return add._id;
    }
    throw e;
  }
}

async function loadGrant(db, grantId) {
  const id = String(grantId || '').trim();
  if (!id) return null;
  try {
    const snap = await db.collection(COL).doc(id).get();
    return snap && snap.data ? { _id: id, ...snap.data } : null;
  } catch (e) {
    return null;
  }
}

/**
 * 相册保存成功后作废凭证，避免再退。
 */
async function consumeDownloadGrant(db, { grantId, openid, packId, index, variant }) {
  const id = String(grantId || '').trim();
  const oid = String(openid || '').trim();
  if (!id || !oid) return { ok: false, code: 'BAD_GRANT' };
  const grant = await loadGrant(db, id);
  if (!grant || grant.openid !== oid) {
    return { ok: false, code: 'GRANT_NOT_FOUND' };
  }
  if (packId && String(grant.packId || '') !== String(packId)) {
    return { ok: false, code: 'GRANT_MISMATCH' };
  }
  if (index != null && Number(grant.index) !== Number(index)) {
    return { ok: false, code: 'GRANT_MISMATCH' };
  }
  if (variant && String(grant.variant || 'static') !== String(variant)) {
    return { ok: false, code: 'GRANT_MISMATCH' };
  }
  if (grant.status !== 'pending') {
    return { ok: true, already: grant.status };
  }
  try {
    await db.collection(COL).doc(id).update({
      data: {
        status: 'consumed',
        consumedAt: db.serverDate(),
      },
    });
  } catch (e) {
    console.warn('[downloadGrant] consume', e.message || e);
  }
  return { ok: true };
}

/**
 * 原子地将 pending 标为 refunded；成功才允许加回额度。
 */
async function markGrantRefunded(db, { grantId, openid }) {
  const id = String(grantId || '').trim();
  const oid = String(openid || '').trim();
  if (!id || !oid) {
    return { ok: false, code: 'BAD_GRANT', message: '缺少退款凭证' };
  }
  const grant = await loadGrant(db, id);
  if (!grant || grant.openid !== oid) {
    return { ok: false, code: 'GRANT_NOT_FOUND', message: '退款凭证无效' };
  }
  if (grant.status === 'refunded') {
    return { ok: false, code: 'GRANT_USED', message: '已退过，请勿重复' };
  }
  if (grant.status === 'consumed') {
    return { ok: false, code: 'GRANT_CONSUMED', message: '该张已保存，不能退回' };
  }
  if (grant.status !== 'pending') {
    return { ok: false, code: 'GRANT_USED', message: '退款凭证已失效' };
  }
  const exp = Number(grant.expiresAt) || 0;
  if (exp && nowMs() > exp) {
    try {
      await db.collection(COL).doc(id).update({
        data: { status: 'expired', expiredAt: db.serverDate() },
      });
    } catch (e) {
      /* ignore */
    }
    return { ok: false, code: 'GRANT_EXPIRED', message: '退款已超时' };
  }
  try {
    await db.collection(COL).doc(id).update({
      data: {
        status: 'refunded',
        refundedAt: db.serverDate(),
      },
    });
  } catch (e) {
    return { ok: false, code: 'GRANT_UPDATE_FAIL', message: '退款凭证更新失败' };
  }
  return {
    ok: true,
    grant,
  };
}

module.exports = {
  COL,
  GRANT_TTL_MS,
  ensureGrantCollection,
  createDownloadGrant,
  consumeDownloadGrant,
  markGrantRefunded,
};
