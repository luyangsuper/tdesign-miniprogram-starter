/**
 * 用户上传图片安全检测（security.mediaCheckAsync）
 *
 * 部署后请在云开发控制台配置消息推送：
 *   消息类型 Event · 事件类型 wxa_media_check · 推送到本云函数
 * 否则异步结果无法写回，前端轮询会超时。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'media_check_jobs';
const POLL_MS = 400;
const WAIT_MS = 14000;

let collectionReady = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errText(e) {
  return String((e && (e.message || e.errMsg || e.errmsg)) || e || '');
}

function isCollectionMissing(e) {
  const msg = errText(e);
  const code = e && (e.errCode || e.code);
  return (
    code === -502005 ||
    code === -502001 ||
    /COLLECTION_NOT_EXIST|collection not exist|Db or Table not exist|database collection/i.test(
      msg,
    )
  );
}

function friendlyDbError(e) {
  if (isCollectionMissing(e)) {
    return '检测服务未就绪，请稍后重试（需创建集合 media_check_jobs）';
  }
  const msg = errText(e);
  // 避免把 -50200 这类底层错误直接抛给用户
  if (/document\.(set|update|get):fail|-5020\d/i.test(msg)) {
    return '图片检测服务异常，请稍后重试';
  }
  return msg || '图片检测失败，请稍后重试';
}

function normalizeSuggest(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'pass' || s === 'risky' || s === 'review') return s;
  return '';
}

async function ensureCollection() {
  if (collectionReady) return;
  try {
    await db.createCollection(COLLECTION);
  } catch (e) {
    /* 已存在或无权限时忽略，后续写入再判断 */
  }
  collectionReady = true;
}

async function createJob(traceId, patch) {
  const id = String(traceId || '').trim();
  if (!id) return;
  await ensureCollection();
  const payload = {
    data: {
      ...patch,
      updatedAt: db.serverDate(),
    },
  };
  try {
    await db.collection(COLLECTION).doc(id).set(payload);
  } catch (e) {
    if (isCollectionMissing(e)) {
      collectionReady = false;
      await ensureCollection();
      await db.collection(COLLECTION).doc(id).set(payload);
      return;
    }
    throw e;
  }
}

async function updateJob(traceId, patch) {
  const id = String(traceId || '').trim();
  if (!id) return;
  await ensureCollection();
  try {
    await db.collection(COLLECTION).doc(id).update({
      data: {
        ...patch,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    // 回调偶发早于写库 / 集合刚创建：补建文档
    try {
      await createJob(id, { ...patch, createdAt: db.serverDate() });
    } catch (e2) {
      console.warn('[mediaCheck] updateJob', errText(e2));
    }
  }
}

/** 消息推送：wxa_media_check */
async function handleMediaCheckEvent(event) {
  const traceId = String(event.trace_id || event.traceId || '').trim();
  const errcode = Number(event.errcode != null ? event.errcode : event.errCode);
  const result = event.result || {};
  const suggest = normalizeSuggest(result.suggest);
  const label = Number(result.label != null ? result.label : 0);

  let status = 'error';
  if (errcode === 0 && suggest === 'pass') status = 'pass';
  else if (errcode === 0 && (suggest === 'risky' || suggest === 'review')) status = suggest;
  else if (errcode === -1008) status = 'error';

  if (traceId) {
    await updateJob(traceId, {
      status,
      suggest: suggest || '',
      label,
      errcode,
      detail: event.detail || [],
      finished: true,
    });
  }

  return { errCode: 0, errMsg: 'ok' };
}

async function getTempUrl(fileID) {
  const id = String(fileID || '').trim();
  if (!id) throw new Error('缺少 fileID');
  const res = await cloud.getTempFileURL({ fileList: [id] });
  const item = (res.fileList && res.fileList[0]) || {};
  const url = String(item.tempFileURL || '').trim();
  if (!url) {
    const msg = item.errMsg || '无法获取图片临时链接';
    throw new Error(msg);
  }
  return url;
}

async function submitCheck({ openid, fileID, scene, biz }) {
  const mediaUrl = await getTempUrl(fileID);
  const sceneNum = [1, 2, 3, 4].includes(Number(scene)) ? Number(scene) : 1;

  const apiRes = await cloud.openapi.security.mediaCheckAsync({
    openid,
    mediaUrl,
    mediaType: 2,
    version: 2,
    scene: sceneNum,
  });

  const errCode = Number(
    apiRes.errCode != null ? apiRes.errCode : apiRes.errcode != null ? apiRes.errcode : 0,
  );
  const errMsg = apiRes.errMsg || apiRes.errmsg || '';
  const traceId = String(apiRes.traceId || apiRes.trace_id || '').trim();

  if (errCode !== 0 || !traceId) {
    const err = new Error(errMsg || '图片检测提交失败');
    err.code = 'SUBMIT_FAIL';
    err.errCode = errCode;
    throw err;
  }

  try {
    await createJob(traceId, {
      openid,
      fileID,
      biz: String(biz || 'bead'),
      scene: sceneNum,
      status: 'pending',
      suggest: '',
      label: 0,
      errcode: 0,
      finished: false,
      createdAt: db.serverDate(),
    });
  } catch (e) {
    const err = new Error(friendlyDbError(e));
    err.code = 'DB_FAIL';
    throw err;
  }

  return { traceId, mediaUrl };
}

async function readJob(traceId) {
  const id = String(traceId || '').trim();
  if (!id) return null;
  try {
    await ensureCollection();
    const snap = await db.collection(COLLECTION).doc(id).get();
    return snap.data || null;
  } catch (e) {
    return null;
  }
}

async function waitForResult(traceId, waitMs) {
  const deadline = Date.now() + Math.max(1000, waitMs);
  while (Date.now() < deadline) {
    const job = await readJob(traceId);
    if (job && job.finished) return job;
    if (job && job.status && job.status !== 'pending') return job;
    await sleep(POLL_MS);
  }
  return readJob(traceId);
}

function mapJobToClient(job, traceId) {
  const status = String((job && job.status) || 'pending');
  const suggest = normalizeSuggest(job && job.suggest) || status;
  const pass = status === 'pass' || suggest === 'pass';
  const blocked =
    status === 'risky' ||
    status === 'review' ||
    suggest === 'risky' ||
    suggest === 'review';
  return {
    ok: true,
    traceId,
    status,
    suggest,
    label: Number((job && job.label) || 0),
    pass,
    blocked,
    pending: status === 'pending' || (!pass && !blocked && status !== 'error'),
  };
}

async function safeDeleteFile(fileID) {
  const id = String(fileID || '').trim();
  if (!id.startsWith('cloud://')) return;
  try {
    await cloud.deleteFile({ fileList: [id] });
  } catch (e) {
    /* ignore */
  }
}

/** 拼豆选图：提交检测并短等回调 */
async function checkBeadImage(event, OPENID) {
  const fileID = String(event.fileID || '').trim();
  if (!fileID.startsWith('cloud://')) {
    return { ok: false, code: 'BAD_FILE', message: '图片无效，请重新选择' };
  }

  let result;
  try {
    let traceId = '';
    try {
      const submitted = await submitCheck({
        openid: OPENID,
        fileID,
        scene: event.scene || 1,
        biz: 'bead',
      });
      traceId = submitted.traceId;
    } catch (e) {
      console.error('[mediaCheck] submit', e);
      result = {
        ok: false,
        code: e.code || 'SUBMIT_FAIL',
        message: friendlyDbError(e),
      };
      return result;
    }

    const job = await waitForResult(traceId, WAIT_MS);
    if (!job || job.status === 'pending' || !job.finished) {
      result = {
        ok: false,
        code: 'CHECK_TIMEOUT',
        message: '图片检测超时，请确认已配置消息推送后重试',
        traceId,
        pending: true,
      };
      return result;
    }

    const mapped = mapJobToClient(job, traceId);
    if (mapped.blocked) {
      result = {
        ok: false,
        code: 'CONTENT_RISKY',
        message: '图片未通过安全检测，请更换图片',
        traceId,
        status: mapped.status,
        suggest: mapped.suggest,
        label: mapped.label,
      };
      return result;
    }
    if (mapped.status === 'error' || !mapped.pass) {
      result = {
        ok: false,
        code: 'CHECK_FAIL',
        message: '图片检测失败，请稍后重试',
        traceId,
        status: mapped.status,
      };
      return result;
    }

    result = {
      ok: true,
      pass: true,
      traceId,
      status: 'pass',
      suggest: 'pass',
      label: mapped.label || 100,
    };
    return result;
  } finally {
    // 无论通过/失败/超时，都清理临时云文件，避免堆积与误用
    await safeDeleteFile(fileID);
  }
}

exports.main = async (event = {}) => {
  if (event.MsgType === 'event' && event.Event === 'wxa_media_check') {
    return handleMediaCheckEvent(event);
  }

  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = String(event.action || 'checkBeadImage');

  if (action === 'checkBeadImage' || action === 'check') {
    return checkBeadImage(event, OPENID);
  }

  if (action === 'poll') {
    const traceId = String(event.traceId || event.trace_id || '').trim();
    const job = await readJob(traceId);
    if (!job) {
      return { ok: false, code: 'NOT_FOUND', message: '检测任务不存在', traceId };
    }
    return mapJobToClient(job, traceId);
  }

  return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
};
