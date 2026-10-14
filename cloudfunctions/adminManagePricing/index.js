const cloud = require('wx-server-sdk');
const {
  PRODUCT_IDS,
  DEFAULT_PRODUCTS,
  getPricingDoc,
  savePricingDoc,
  normalizeProduct,
  clampInt,
  listLiveProducts,
  genProductId,
  isValidWxProductId,
} = require('./pricingSettings');
const {
  PAY_ENV,
  resolveItemUrl,
  uploadGoods,
  publishGoods,
  queryUploadGoods,
  queryPublishGoods,
} = require('./wxPayHelpers');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

/**
 * 改价策略（对齐微信官方限制）：
 * 已上线道具不能改价 → 为槽位生成新的 productId，upload + publish，确认后再把 live 切到新 ID。
 * 旧 ID 仍留在微信后台，可手动下架/删除，不影响支付。
 */

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function publicProduct(entry, slotId) {
  return {
    slotId: slotId || entry.slotId || '',
    productId: entry.productId,
    planKey: entry.planKey,
    title: entry.title,
    type: entry.type,
    value: entry.value,
    priceFen: entry.priceFen,
    itemFileId: entry.itemFileId || '',
    wx: entry.wx || { status: 'ok', error: '', at: null },
    draft: entry.draft || null,
  };
}

/** 微信无删除道具 API；限频/批量任务中 → 保持排队，勿标失败 */
function isRetryableWxErr(err) {
  const msg = String((err && err.message) || err || '');
  const code = err && err.errcode;
  return (
    code === 268490012 ||
    code === 268490015 ||
    /268490012|268490015|批量任务|频率限制|请等待|请稍后/i.test(msg)
  );
}

function markQueued(entry, hint) {
  entry.wx = {
    status: 'syncing',
    error: String(hint || '排队等待微信批量任务空闲').slice(0, 500),
    at: new Date(),
    syncStartedAt: (entry.wx && entry.wx.syncStartedAt) || Date.now(),
  };
}

async function startUploadNewGoods(cloudInst, entry, draft) {
  if (!entry.itemFileId) {
    throw new Error('未上传道具图，无法向微信创建新道具');
  }
  if (!draft || !isValidWxProductId(draft.productId)) {
    throw new Error('缺少有效的新道具 ID');
  }
  if (draft.productId === entry.productId) {
    throw new Error('新道具 ID 不能与现网相同');
  }
  const itemUrl = await resolveItemUrl(cloudInst, entry.itemFileId);
  const name = String(draft.title || entry.title).slice(0, 20);
  await uploadGoods(cloudInst, {
    id: draft.productId,
    name,
    price: Number(draft.priceFen),
    remark: name,
    itemUrl,
  });
}

function promoteDraft(entry) {
  if (!entry || !entry.draft) return false;
  if (entry.draft.productId && isValidWxProductId(entry.draft.productId)) {
    entry.productId = entry.draft.productId;
  }
  entry.title = entry.draft.title;
  entry.value = entry.draft.value;
  entry.priceFen = entry.draft.priceFen;
  entry.draft = null;
  entry.wx = { status: 'ok', error: '', at: new Date(), syncStartedAt: null };
  return true;
}

function markFail(entry, err) {
  entry.wx = {
    status: 'fail',
    error: String((err && err.message) || err || '同步失败').slice(0, 500),
    at: new Date(),
    syncStartedAt: (entry.wx && entry.wx.syncStartedAt) || null,
  };
}

function wxBatchBusy(uploadData, publishData) {
  return Number(uploadData && uploadData.status) === 1 || Number(publishData && publishData.status) === 1;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'get';

  try {
    if (action === 'public') {
      const doc = await getPricingDoc(db);
      return {
        ok: true,
        products: listLiveProducts(doc),
        payEnv: PAY_ENV,
      };
    }

    if (!assertAdmin(OPENID)) {
      return { ok: false, code: 'FORBIDDEN', message: '无管理员权限' };
    }

    if (action === 'get') {
      const doc = await getPricingDoc(db);
      return {
        ok: true,
        products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
        payEnv: PAY_ENV,
      };
    }

    if (action === 'set') {
      const incoming = Array.isArray(event.products) ? event.products : [];
      if (!incoming.length) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少 products' };
      }
      const doc = await getPricingDoc(db);
      const toSync = [];
      const errors = [];

      for (const patch of incoming) {
        const slotId = String((patch && (patch.slotId || patch.productId)) || '').trim();
        // 管理端传来的 productId 可能是槽位 id（兼容旧前端）或当前微信 id
        let slot = PRODUCT_IDS.includes(slotId) ? slotId : '';
        if (!slot) {
          slot = PRODUCT_IDS.find((id) => doc.products[id].productId === slotId) || '';
        }
        if (!slot || !DEFAULT_PRODUCTS[slot]) {
          errors.push(`未知商品 ${slotId}`);
          continue;
        }
        const cur = doc.products[slot];
        const nextTitle =
          patch.title !== undefined && patch.title !== null
            ? String(patch.title).trim().slice(0, 20)
            : cur.title;
        const nextValue =
          patch.value !== undefined && patch.value !== null
            ? clampInt(patch.value, 1, 99999, cur.value)
            : cur.value;
        // 管理端编辑的是「目标价」；若传的是当前微信 id 作 key，priceFen 仍是目标
        const nextPrice =
          patch.priceFen !== undefined && patch.priceFen !== null
            ? clampInt(patch.priceFen, 1, 99999900, cur.priceFen)
            : cur.priceFen;
        if (patch.itemFileId !== undefined && patch.itemFileId !== null) {
          cur.itemFileId = String(patch.itemFileId || '').trim();
        }

        // 价未变 / 仍等于当前 draft 目标价 → 不新开 ID（避免补传道具图误触发）
        const priceChanged =
          nextPrice !== cur.priceFen && !(cur.draft && nextPrice === cur.draft.priceFen);
        const valueChanged = nextValue !== cur.value;
        const titleChanged = nextTitle !== cur.title;

        if (priceChanged) {
          if (!cur.itemFileId) {
            errors.push(`${slot} 改价前请先上传道具图`);
            continue;
          }
          // 新微信道具 ID（旧 ID 保留在微信，本系统切走）
          let newPid = genProductId(slot, nextPrice);
          // 极低概率碰撞：与现网或其它槽位冲突则再生成
          const used = new Set(PRODUCT_IDS.map((id) => doc.products[id].productId));
          used.add(cur.productId);
          let guard = 0;
          while (used.has(newPid) && guard < 5) {
            newPid = genProductId(slot, nextPrice);
            guard += 1;
          }
          cur.draft = {
            productId: newPid,
            title: nextTitle || cur.title,
            value: nextValue,
            priceFen: nextPrice,
          };
          if (valueChanged) cur.value = nextValue;
          cur.wx = {
            status: 'syncing',
            error: '',
            at: new Date(),
            syncStartedAt: Date.now(),
          };
          toSync.push(slot);
        } else {
          cur.title = nextTitle || cur.title;
          cur.value = nextValue;
          if (titleChanged && cur.draft) {
            cur.draft.title = nextTitle || cur.draft.title;
          }
          if (!cur.draft) {
            cur.wx = { status: 'ok', error: '', at: new Date(), syncStartedAt: null };
          }
        }
        doc.products[slot] = normalizeProduct(cur, DEFAULT_PRODUCTS[slot], slot);
      }

      if (
        errors.length &&
        !toSync.length &&
        incoming.every((p) => {
          const id = String((p && (p.slotId || p.productId)) || '');
          return errors.some((e) => e.includes(id));
        })
      ) {
        return { ok: false, code: 'BAD_PARAM', message: errors.join('；') };
      }

      await savePricingDoc(db, doc, { openid: OPENID });

      // 微信一次只能跑一个批量任务：只启动队列里第一个，其余等 syncStatus 接力
      const syncResults = [];
      if (toSync.length) {
        const first = toSync[0];
        const entry = doc.products[first];
        try {
          await startUploadNewGoods(cloud, entry, entry.draft);
          entry.wx = {
            status: 'syncing',
            error: '',
            at: new Date(),
            syncStartedAt: Date.now(),
          };
          syncResults.push({ slotId: first, productId: entry.draft.productId, ok: true });
        } catch (e) {
          if (isRetryableWxErr(e)) {
            markQueued(entry, e.message || '微信忙碌，排队自动重试');
            syncResults.push({ slotId: first, ok: true, queued: true, message: e.message });
          } else {
            markFail(entry, e);
            syncResults.push({ slotId: first, ok: false, message: e.message || String(e) });
          }
        }
        for (let i = 1; i < toSync.length; i += 1) {
          const slot = toSync[i];
          markQueued(doc.products[slot], '排队中：前一个道具上传完成后再提交');
          syncResults.push({ slotId: slot, ok: true, queued: true });
        }
        await savePricingDoc(db, doc, { openid: OPENID });
      }

      const fresh = await getPricingDoc(db);
      return {
        ok: true,
        products: PRODUCT_IDS.map((id) => publicProduct(fresh.products[id], id)),
        syncResults,
        warnings: errors,
        message: toSync.length
          ? '已排队上传新道具（微信同时只能跑一个任务）。完成后点「确认切换」。旧道具微信无删除 API，可在 MP 下架或留着不用。'
          : errors.length
            ? errors.join('；')
            : '已保存',
      };
    }

    if (action === 'retrySync') {
      const slotOrId = String(event.productId || event.slotId || '').trim();
      let slot = PRODUCT_IDS.includes(slotOrId) ? slotOrId : '';
      const doc = await getPricingDoc(db);
      if (!slot) {
        slot = PRODUCT_IDS.find((id) => doc.products[id].productId === slotOrId) || '';
      }
      if (!slot || !DEFAULT_PRODUCTS[slot]) {
        return { ok: false, code: 'BAD_PARAM', message: '未知商品' };
      }
      const entry = doc.products[slot];
      if (!entry.draft || !entry.draft.priceFen) {
        return { ok: false, code: 'NO_DRAFT', message: '没有待发布的新价' };
      }
      if (!entry.draft.productId || entry.draft.productId === entry.productId) {
        entry.draft.productId = genProductId(slot, entry.draft.priceFen);
      }
      if (!entry.itemFileId) {
        return { ok: false, code: 'NO_IMAGE', message: '请先上传道具图' };
      }

      let uploadData = null;
      let publishData = null;
      try {
        uploadData = await queryUploadGoods(cloud);
      } catch (e) {
        /* ignore */
      }
      try {
        publishData = await queryPublishGoods(cloud);
      } catch (e) {
        /* ignore */
      }
      if (wxBatchBusy(uploadData, publishData)) {
        markQueued(entry, '微信批量任务仍在运行，请稍后再点重试（页面会自动轮询）');
        await savePricingDoc(db, doc, { openid: OPENID });
        return {
          ok: true,
          queued: true,
          message: '微信仍有批量任务在跑，已改回排队；请等 1–2 分钟后自动继续或再点重试',
          products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
        };
      }

      entry.wx = { status: 'syncing', error: '', at: new Date(), syncStartedAt: Date.now() };
      try {
        await startUploadNewGoods(cloud, entry, entry.draft);
      } catch (e) {
        if (isRetryableWxErr(e)) {
          markQueued(entry, e.message || '微信忙碌，排队自动重试');
          await savePricingDoc(db, doc, { openid: OPENID });
          return {
            ok: true,
            queued: true,
            message: e.message || '已排队，稍后自动重试',
            products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
          };
        }
        markFail(entry, e);
        await savePricingDoc(db, doc, { openid: OPENID });
        return {
          ok: false,
          code: 'SYNC_FAIL',
          message: e.message || '上传失败',
          products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
        };
      }
      await savePricingDoc(db, doc, { openid: OPENID });
      return {
        ok: true,
        message: `已重新上传新道具 ${entry.draft.productId}`,
        products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
      };
    }

    if (action === 'syncStatus') {
      const doc = await getPricingDoc(db);
      const syncingSlots = PRODUCT_IDS.filter(
        (id) => doc.products[id].wx && doc.products[id].wx.status === 'syncing',
      );
      let uploadData = null;
      let publishData = null;
      try {
        uploadData = await queryUploadGoods(cloud);
      } catch (e) {
        console.warn('query_upload_goods', e.message || e);
      }
      try {
        publishData = await queryPublishGoods(cloud);
      } catch (e) {
        console.warn('query_publish_goods', e.message || e);
      }

      const uploadItems = (uploadData && uploadData.upload_item) || [];
      const publishItems = (publishData && publishData.publish_item) || [];
      let changed = false;
      const MIN_READY_MS = 60 * 1000;

      for (const slot of syncingSlots) {
        const entry = doc.products[slot];
        const newId = entry.draft && entry.draft.productId;
        if (!newId) continue;
        const up = uploadItems.find((x) => String(x.id) === newId);
        const pub = publishItems.find((x) => String(x.id) === newId);
        const startedAt = Number((entry.wx && entry.wx.syncStartedAt) || 0);
        const waitedEnough = !startedAt || Date.now() - startedAt >= MIN_READY_MS;

        // upload_status: 0 上传中 / 1 id已存在 / 2 成功 / 3 失败
        if (up && Number(up.upload_status) === 3) {
          markFail(entry, up.errmsg || '上传新道具失败');
          changed = true;
          continue;
        }
        if (up && Number(up.upload_status) === 1) {
          // 新 ID 碰撞：换 ID 重传（须等批次空闲）
          entry.draft.productId = genProductId(slot, entry.draft.priceFen);
          if (!wxBatchBusy(uploadData, publishData)) {
            try {
              await startUploadNewGoods(cloud, entry, entry.draft);
              entry.wx.error = '';
              entry.wx.syncStartedAt = Date.now();
              changed = true;
            } catch (e) {
              if (isRetryableWxErr(e)) markQueued(entry, e.message);
              else markFail(entry, e);
              changed = true;
            }
          } else {
            markQueued(entry, 'ID 冲突已换新，等待批次空闲后重传');
            changed = true;
          }
          continue;
        }
        if (pub && Number(pub.publish_status) === 3) {
          markFail(entry, pub.errmsg || '发布新道具失败');
          changed = true;
          continue;
        }
        // 上传成功后再发布（不要误用任务级 status=2，那是失败）
        const uploadOk = up && Number(up.upload_status) === 2;
        if (uploadOk && (!pub || Number(pub.publish_status) === 0)) {
          try {
            await publishGoods(cloud, { id: newId });
          } catch (e) {
            if (!isRetryableWxErr(e)) {
              console.warn('publish', newId, e.message || e);
            }
          }
        }
        // publish_status 2 = 该道具发布成功
        if (pub && Number(pub.publish_status) === 2 && waitedEnough && entry.draft) {
          if (up && up.price != null && Number(up.price) !== Number(entry.draft.priceFen)) {
            markFail(
              entry,
              `微信上传价 ${up.price} 分与目标 ${entry.draft.priceFen} 分不一致`,
            );
            changed = true;
            continue;
          }
          entry.wx = {
            status: 'ready',
            error: '',
            at: new Date(),
            syncStartedAt: startedAt || null,
          };
          changed = true;
        }
      }

      // 批次空闲时，启动下一个「已排队但尚未出现在 upload_item」的槽位
      if (!wxBatchBusy(uploadData, publishData)) {
        for (const slot of PRODUCT_IDS) {
          const entry = doc.products[slot];
          if (!entry.wx || entry.wx.status !== 'syncing' || !entry.draft || !entry.draft.productId) {
            continue;
          }
          const newId = entry.draft.productId;
          const up = uploadItems.find((x) => String(x.id) === newId);
          if (up) continue; // 已在上传列表
          try {
            await startUploadNewGoods(cloud, entry, entry.draft);
            entry.wx = {
              status: 'syncing',
              error: '',
              at: new Date(),
              syncStartedAt: Date.now(),
            };
            changed = true;
            break; // 一次只启动一个
          } catch (e) {
            if (isRetryableWxErr(e)) {
              markQueued(entry, e.message || '仍在排队');
            } else {
              markFail(entry, e);
            }
            changed = true;
            break;
          }
        }
      }

      if (changed) {
        await savePricingDoc(db, doc, { openid: OPENID });
      }

      const fresh = changed ? await getPricingDoc(db) : doc;
      const stillSyncing = PRODUCT_IDS.some((id) => {
        const st = fresh.products[id].wx && fresh.products[id].wx.status;
        return st === 'syncing' || st === 'ready';
      });
      return {
        ok: true,
        products: PRODUCT_IDS.map((id) => publicProduct(fresh.products[id], id)),
        stillSyncing,
        uploadStatus: uploadData && uploadData.status,
        publishStatus: publishData && publishData.status,
      };
    }

    if (action === 'confirmLive') {
      const slotOrId = String(event.productId || event.slotId || '').trim();
      let slot = PRODUCT_IDS.includes(slotOrId) ? slotOrId : '';
      const doc = await getPricingDoc(db);
      if (!slot) {
        slot =
          PRODUCT_IDS.find((id) => doc.products[id].productId === slotOrId) ||
          PRODUCT_IDS.find(
            (id) =>
              doc.products[id].draft && doc.products[id].draft.productId === slotOrId,
          ) ||
          '';
      }
      if (!slot || !DEFAULT_PRODUCTS[slot]) {
        return { ok: false, code: 'BAD_PARAM', message: '未知商品' };
      }
      const entry = doc.products[slot];
      if (!entry.draft) {
        return { ok: false, code: 'NO_DRAFT', message: '没有待切换的新价' };
      }
      const oldId = entry.productId;
      const newId = entry.draft.productId;
      promoteDraft(entry);
      await savePricingDoc(db, doc, { openid: OPENID });
      return {
        ok: true,
        message: newId
          ? `已切换支付到新道具 ${newId}（旧 ${oldId} 可在 MP 下架）。请等发布全网生效后再试购。`
          : '已切换现网售价',
        products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
      };
    }

    if (action === 'cancelDraft') {
      const slotOrId = String(event.productId || event.slotId || '').trim();
      let slot = PRODUCT_IDS.includes(slotOrId) ? slotOrId : '';
      const doc = await getPricingDoc(db);
      if (!slot) {
        slot = PRODUCT_IDS.find((id) => doc.products[id].productId === slotOrId) || '';
      }
      if (!slot || !DEFAULT_PRODUCTS[slot]) {
        return { ok: false, code: 'BAD_PARAM', message: '未知商品' };
      }
      const entry = doc.products[slot];
      entry.draft = null;
      entry.wx = { status: 'ok', error: '', at: new Date(), syncStartedAt: null };
      await savePricingDoc(db, doc, { openid: OPENID });
      return {
        ok: true,
        message: '已放弃；支付仍用原道具 ID',
        products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
      };
    }

    if (action === 'forceLive') {
      const slotOrId = String(event.productId || event.slotId || '').trim();
      let slot = PRODUCT_IDS.includes(slotOrId) ? slotOrId : '';
      const doc = await getPricingDoc(db);
      if (!slot) {
        slot = PRODUCT_IDS.find((id) => doc.products[id].productId === slotOrId) || '';
      }
      if (!slot || !DEFAULT_PRODUCTS[slot]) {
        return { ok: false, code: 'BAD_PARAM', message: '未知商品' };
      }
      const priceFen = clampInt(event.priceFen, 1, 99999900, 0);
      if (!priceFen) {
        return { ok: false, code: 'BAD_PARAM', message: '售价无效' };
      }
      const entry = doc.products[slot];
      // 仅改库价对齐微信，不轮换 ID
      entry.priceFen = priceFen;
      if (event.title != null) entry.title = String(event.title).trim().slice(0, 20) || entry.title;
      if (event.value != null) entry.value = clampInt(event.value, 1, 99999, entry.value);
      entry.draft = null;
      entry.wx = { status: 'ok', error: '', at: new Date(), syncStartedAt: null };
      await savePricingDoc(db, doc, { openid: OPENID });
      return {
        ok: true,
        message: `已把支付价对齐为 ¥${(priceFen / 100).toFixed(2).replace(/\.00$/, '')}（道具 ID 仍为 ${entry.productId}）`,
        products: PRODUCT_IDS.map((id) => publicProduct(doc.products[id], id)),
      };
    }

    return { ok: false, code: 'BAD_ACTION', message: `未知 action: ${action}` };
  } catch (e) {
    console.error('adminManagePricing', e);
    return { ok: false, code: 'FAIL', message: e.message || '失败' };
  }
};
