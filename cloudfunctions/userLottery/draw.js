/**
 * 抽奖开奖核心：随机抽人 + 奖池随机拆分 + 幂等发奖
 */
const { sendLotteryWinNotice } = require('./notify');

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * 把总奖池 T 随机拆成 k 份正整数（有大有小，总和 = T）
 * 用指数随机权重，均等概率很低
 */
function splitPoolRandomly(total, k) {
  const T = Math.max(0, Math.floor(Number(total) || 0));
  const n = Math.max(0, Math.floor(Number(k) || 0));
  if (n <= 0 || T <= 0) return [];
  if (T < n) {
    return Array.from({ length: T }, () => 1).concat(Array.from({ length: n - T }, () => 0));
  }
  if (n === 1) return [T];

  const weights = [];
  let sumW = 0;
  for (let i = 0; i < n; i += 1) {
    // -ln(U) 指数分布，拉开差距
    const u = Math.max(1e-12, Math.random());
    const w = -Math.log(u);
    weights.push(w);
    sumW += w;
  }
  const raw = weights.map((w) => (w / sumW) * T);
  const floors = raw.map((x) => Math.max(1, Math.floor(x)));
  let used = floors.reduce((s, x) => s + x, 0);
  // 若 floor 后超过 T（每人至少 1），改成先给 1 再按权重分剩余
  if (used > T) {
    const base = Array.from({ length: n }, () => 1);
    let rest = T - n;
    const order = shuffle(Array.from({ length: n }, (_, i) => i));
    let idx = 0;
    while (rest > 0) {
      base[order[idx % n]] += 1;
      rest -= 1;
      idx += 1;
    }
    return base;
  }
  let rem = T - used;
  const order = shuffle(Array.from({ length: n }, (_, i) => i));
  let i = 0;
  while (rem > 0) {
    floors[order[i % n]] += 1;
    rem -= 1;
    i += 1;
  }
  return floors;
}

async function ensureCollection(db, name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    /* ignore */
  }
}

async function loadAllEntries(db, lotteryId) {
  const PAGE = 100;
  let lastId = '';
  const list = [];
  const _ = db.command;
  while (true) {
    let query = db
      .collection('lottery_entries')
      .where({ lotteryId })
      .orderBy('_id', 'asc')
      .limit(PAGE);
    if (lastId) {
      query = db
        .collection('lottery_entries')
        .where({ lotteryId, _id: _.gt(lastId) })
        .orderBy('_id', 'asc')
        .limit(PAGE);
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await query.get();
    const rows = (res && res.data) || [];
    if (!rows.length) break;
    list.push(...rows);
    lastId = String(rows[rows.length - 1]._id || '');
    if (!lastId || rows.length < PAGE) break;
  }
  return list;
}

/**
 * 执行开奖。可被定时器 / 懒开奖调用。
 * @returns {{ ok: boolean, code?: string, message?: string, data?: object }}
 */
async function runDraw(cloud, db, lotteryId, { force = false } = {}) {
  const _ = db.command;
  const id = String(lotteryId || '').trim();
  if (!id) return { ok: false, code: 'BAD_PARAM', message: '缺少活动 ID' };

  await ensureCollection(db, 'lotteries');
  await ensureCollection(db, 'lottery_entries');

  const lotRef = db.collection('lotteries').doc(id);
  let lot;
  try {
    lot = (await lotRef.get()).data;
  } catch (e) {
    return { ok: false, code: 'NOT_FOUND', message: '活动不存在' };
  }
  if (!lot) return { ok: false, code: 'NOT_FOUND', message: '活动不存在' };

  if (lot.status === 'drawn') {
    return { ok: true, code: 'ALREADY', data: { lotteryId: id, winners: lot.winners || [] } };
  }
  if (lot.status === 'cancelled') {
    return { ok: false, code: 'CANCELLED', message: '活动已取消' };
  }
  if (lot.status === 'drawing') {
    const drawingAt = toMs(lot.drawingAt || lot.updatedAt);
    const stale = !drawingAt || Date.now() - drawingAt > 45 * 1000;
    if (!stale) {
      return { ok: false, code: 'BUSY', message: '正在开奖' };
    }
    // 卡住的 drawing 回收后再开
    try {
      await lotRef.update({
        data: { status: 'open', updatedAt: db.serverDate() },
      });
      lot.status = 'open';
    } catch (e) {
      return { ok: false, code: 'BUSY', message: '正在开奖' };
    }
  }
  if (lot.status !== 'open') {
    return { ok: false, code: 'BAD_STATUS', message: '活动状态不可开奖' };
  }

  const drawAtMs = toMs(lot.drawAt);
  if (!force && drawAtMs > Date.now()) {
    return { ok: false, code: 'TOO_EARLY', message: '尚未到开奖时间' };
  }

  // 单飞：open → drawing
  try {
    await lotRef.update({
      data: {
        status: 'drawing',
        drawingAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    return { ok: false, code: 'BUSY', message: '开奖冲突，请稍后' };
  }

  try {
    const entries = await loadAllEntries(db, id);
    const poolPoints = Math.max(0, Math.floor(Number(lot.poolPoints) || 0));
    const winnerCount = Math.max(1, Math.floor(Number(lot.winnerCount) || 1));
    const title = String(lot.title || '抽奖活动');

    const shuffled = shuffle(entries);
    const k = Math.min(winnerCount, shuffled.length);
    const picked = shuffled.slice(0, k);
    let amounts = splitPoolRandomly(poolPoints, k).filter((n) => n > 0);
    // 若 T < k，amounts 可能短于 picked
    const winners = [];
    for (let i = 0; i < amounts.length; i += 1) {
      const row = picked[i];
      if (!row) break;
      winners.push({
        openid: row.openid,
        nickName: row.nickName || '趣集用户',
        points: amounts[i],
      });
    }
    // 按积分降序方便展示
    winners.sort((a, b) => b.points - a.points);
    winners.forEach((w, idx) => {
      w.rank = idx + 1;
    });

    const winMap = new Map(winners.map((w) => [w.openid, w]));

    // 发奖 + 写 entry + 推结果
    // eslint-disable-next-line no-restricted-syntax
    for (const entry of entries) {
      const openid = entry.openid;
      const win = winMap.get(openid);
      const won = !!win;
      const prizePoints = won ? win.points : 0;
      const entryId = entry._id || `${id}_${openid}`;
      const entryRef = db.collection('lottery_entries').doc(entryId);
      try {
        // eslint-disable-next-line no-await-in-loop
        await entryRef.update({
          data: {
            won,
            prizePoints,
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        console.warn('[draw] entry update', entryId, e.message || e);
      }

      const userRef = db.collection('users').doc(openid);
      try {
        // 弹窗队列与发奖拆开：即使积分已幂等发过，也要能补写 pending
        // eslint-disable-next-line no-await-in-loop
        await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(userRef);
          const data = (snap && snap.data) || null;
          if (!data) return;
          const alreadyPushed =
            data.lotteryResultPushed && data.lotteryResultPushed[id];
          const alreadyCredited =
            data.lotteryCredits && data.lotteryCredits[id];
          const patch = { updatedAt: db.serverDate() };
          let needUpdate = false;
          if (!alreadyPushed) {
            patch.pendingLotteryResults = _.push({
              id: `result_${id}_${openid}`,
              lotteryId: id,
              title,
              won,
              prizePoints,
              drawAt: drawAtMs,
              at: Date.now(),
            });
            patch[`lotteryResultPushed.${id}`] = true;
            needUpdate = true;
          }
          if (won && prizePoints > 0 && !alreadyCredited) {
            patch.points = _.inc(prizePoints);
            patch[`lotteryCredits.${id}`] = true;
            needUpdate = true;
          }
          if (needUpdate) {
            transaction.update(userRef, { data: patch });
          }
        });
        if (won && prizePoints > 0) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await sendLotteryWinNotice(cloud, db, {
              openid,
              title,
              prizePoints,
              lotteryId: id,
            });
          } catch (e) {
            console.warn('[draw] win notify', openid, e.message || e);
          }
        }
      } catch (e) {
        console.warn('[draw] user result', openid, e.message || e);
      }
    }

    await lotRef.update({
      data: {
        status: 'drawn',
        winners,
        drawnAt: db.serverDate(),
        participantCount: entries.length,
        updatedAt: db.serverDate(),
      },
    });

    return {
      ok: true,
      data: {
        lotteryId: id,
        winners,
        participantCount: entries.length,
      },
    };
  } catch (e) {
    console.error('[draw] fail', e);
    try {
      await lotRef.update({
        data: {
          status: 'open',
          updatedAt: db.serverDate(),
        },
      });
    } catch (err) {
      /* ignore */
    }
    return {
      ok: false,
      code: 'FAIL',
      message: (e && e.message) || '开奖失败',
    };
  }
}

/** 若已到期则开奖；drawing 卡住会在 runDraw 内回收 */
async function ensureDrawn(cloud, db, lotteryOrId) {
  let lot = lotteryOrId;
  let id = '';
  if (typeof lotteryOrId === 'string') {
    id = lotteryOrId;
    try {
      lot = (await db.collection('lotteries').doc(id).get()).data;
    } catch (e) {
      return null;
    }
  } else {
    id = lot && (lot._id || lot.id);
  }
  if (!lot || !id) return lot;
  if (lot.status === 'drawn' || lot.status === 'cancelled') {
    if (lot) lot._id = id;
    return lot;
  }
  const due = toMs(lot.drawAt) <= Date.now();
  const stuckDrawing = lot.status === 'drawing';
  if (due || stuckDrawing) {
    await runDraw(cloud, db, id);
    try {
      lot = (await db.collection('lotteries').doc(id).get()).data;
      if (lot) lot._id = id;
    } catch (e) {
      /* ignore */
    }
  }
  return lot;
}

async function scanAndDrawDue(cloud, db, limit = 10) {
  const res = await db
    .collection('lotteries')
    .where({
      status: 'open',
      drawAt: db.command.lte(new Date()),
    })
    .limit(Math.min(20, Math.max(1, limit)))
    .get();
  const rows = (res && res.data) || [];
  const results = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const row of rows) {
    const lid = row._id;
    // eslint-disable-next-line no-await-in-loop
    const r = await runDraw(cloud, db, lid);
    results.push({ lotteryId: lid, ...r });
  }
  return { scanned: rows.length, results };
}

module.exports = {
  toMs,
  shuffle,
  splitPoolRandomly,
  runDraw,
  ensureDrawn,
  scanAndDrawDue,
  ensureCollection,
  loadAllEntries,
};
