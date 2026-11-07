const cloud = require('wx-server-sdk');
const { invalidateListCaches } = require('./invalidateCaches');
const {
  SCHEMA_VERSION,
  ALIGNERS,
  listAligners,
  asString,
} = require('./schemaAlign');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];
const BATCH = 80;
const MAX_PAGES = 200;

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

function serverDate() {
  return db.serverDate();
}

async function runCollectionAligner(aligner, { dryRun, openid }) {
  const col = aligner.collection;
  const fieldCounts = {};
  const samples = [];
  let scanned = 0;
  let patched = 0;
  let lastId = '';
  let guard = 0;

  while (guard < MAX_PAGES) {
    guard += 1;
    let query = db.collection(col).orderBy('_id', 'asc').limit(BATCH);
    if (lastId) {
      query = db
        .collection(col)
        .where({ _id: _.gt(lastId) })
        .orderBy('_id', 'asc')
        .limit(BATCH);
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await query.get();
    const list = (res && res.data) || [];
    if (!list.length) break;

    for (let i = 0; i < list.length; i += 1) {
      const doc = list[i];
      lastId = doc._id;
      scanned += 1;
      const built = aligner.alignDoc(doc, { dryRun, openid, serverDate, db });
      if (!built || !built.fields || !built.fields.length) continue;
      patched += 1;
      built.fields.forEach((f) => {
        fieldCounts[f] = (fieldCounts[f] || 0) + 1;
      });
      if (samples.length < 6) {
        samples.push({
          id: doc._id,
          title:
            asString(doc.title || doc.name || doc.openid || doc._id).slice(0, 40) ||
            doc._id,
          fields: built.fields,
        });
      }
      if (!dryRun) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection(col).doc(doc._id).update({ data: built.patch });
      }
    }
    if (list.length < BATCH) break;
  }

  return {
    id: aligner.id,
    kind: 'collection',
    label: aligner.label,
    description: aligner.description,
    scanned,
    patched,
    fieldCounts,
    samples,
    changed: patched > 0,
  };
}

async function runConfigAligner(aligner, { dryRun, openid }) {
  const result = await aligner.align(db, { dryRun, openid, serverDate });
  const missingKeys = (result && result.missingKeys) || [];
  const patched = !!(result && result.patched);
  return {
    id: aligner.id,
    kind: 'config',
    label: aligner.label,
    description: aligner.description,
    scanned: 1,
    patched: patched ? 1 : 0,
    fieldCounts: missingKeys.reduce((acc, k) => {
      acc[k] = 1;
      return acc;
    }, {}),
    samples: [],
    changed: patched,
    detail: result || {},
  };
}

async function runAllAligners({ dryRun, openid, onlyIds }) {
  const want = Array.isArray(onlyIds) && onlyIds.length
    ? new Set(onlyIds.map(String))
    : null;
  const results = [];
  let anyChanged = false;

  for (let i = 0; i < ALIGNERS.length; i += 1) {
    const aligner = ALIGNERS[i];
    if (want && !want.has(aligner.id)) continue;
    let one;
    if (aligner.kind === 'collection') {
      // eslint-disable-next-line no-await-in-loop
      one = await runCollectionAligner(aligner, { dryRun, openid });
    } else if (aligner.kind === 'config') {
      // eslint-disable-next-line no-await-in-loop
      one = await runConfigAligner(aligner, { dryRun, openid });
    } else {
      one = {
        id: aligner.id,
        kind: aligner.kind || 'unknown',
        label: aligner.label,
        description: aligner.description,
        scanned: 0,
        patched: 0,
        fieldCounts: {},
        samples: [],
        changed: false,
        error: '未知 aligner 类型',
      };
    }
    if (one.changed) anyChanged = true;
    results.push(one);
  }

  return { results, anyChanged };
}

async function writeSchemaMeta({ openid, dryRun, results }) {
  if (dryRun) return;
  try {
    await db.collection('app_config').doc('schema_meta').set({
      data: {
        schemaVersion: SCHEMA_VERSION,
        alignedAt: db.serverDate(),
        alignedBy: openid || '',
        aligners: results.map((r) => ({
          id: r.id,
          scanned: r.scanned,
          patched: r.patched,
          changed: !!r.changed,
        })),
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    console.warn('schema_meta write failed', e.message || e);
  }
}

/**
 * action:
 * - info：当前 schema 版本与 aligner 清单（不加扫描）
 * - scan：只统计，不写库
 * - applyAll：跑完全部 aligner 并写入
 * only：可选 string[]，只跑指定 aligner id
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  const action = String(event.action || 'scan').trim();
  const only = Array.isArray(event.only)
    ? event.only.map(String).filter(Boolean)
    : [];

  if (action === 'info') {
    return {
      ok: true,
      data: {
        schemaVersion: SCHEMA_VERSION,
        aligners: listAligners(),
      },
    };
  }

  const dryRun = action === 'scan' || !!event.dryRun;
  if (action !== 'scan' && action !== 'applyAll' && action !== 'apply') {
    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  }

  try {
    const { results, anyChanged } = await runAllAligners({
      dryRun,
      openid: OPENID,
      onlyIds: only,
    });

    if (!dryRun && anyChanged) {
      await invalidateListCaches(db);
    }
    await writeSchemaMeta({ openid: OPENID, dryRun, results });

    const totalScanned = results.reduce((s, r) => s + (r.scanned || 0), 0);
    const totalPatched = results.reduce((s, r) => s + (r.patched || 0), 0);
    const changedLabels = results.filter((r) => r.changed).map((r) => r.label);
    const verb = dryRun ? '需对齐' : '已对齐';

    let message;
    if (!totalPatched && !anyChanged) {
      message = `schema v${SCHEMA_VERSION}：扫描完成，与线上一致`;
    } else if (changedLabels.length === 1) {
      message = `schema v${SCHEMA_VERSION}：${verb} ${changedLabels[0]}（${totalPatched}）`;
    } else {
      message = `schema v${SCHEMA_VERSION}：${verb} ${changedLabels.length} 项 / 触及 ${totalPatched} 条`;
    }

    // 兼容旧前端摘要字段
    const packs = results.find((r) => r.id === 'packs') || {
      scanned: 0,
      patched: 0,
      fieldCounts: {},
      samples: [],
    };
    const points = results.find((r) => r.id === 'app_config.points');

    return {
      ok: true,
      message,
      data: {
        schemaVersion: SCHEMA_VERSION,
        dryRun,
        done: true,
        scanned: totalScanned,
        patched: totalPatched,
        results,
        aligners: listAligners(),
        // 兼容旧 UI
        fieldCounts: packs.fieldCounts || {},
        samples: packs.samples || [],
        points: points
          ? {
              patched: !!points.changed,
              missingKeys: Object.keys(points.fieldCounts || {}),
            }
          : { patched: false, missingKeys: [] },
      },
    };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'ALIGN_FAIL',
      message: (e && e.message) || '对齐失败',
    };
  }
};
