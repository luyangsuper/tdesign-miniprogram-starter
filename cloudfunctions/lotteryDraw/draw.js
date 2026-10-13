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
  const _ = db.command;
  // 优先带 orderBy 分页；无复合索引时降级为 where+limit，避免开奖整段失败
  try {
    let lastId = '';
    const list = [];
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
  } catch (e) {
    console.warn('[draw] loadAllEntries fallback', e.message || e);
    const res = await db
      .collection('lottery_entries')
      .where({ lotteryId })
      .limit(PAGE)
      .get();
    return (res && res.data) || [];
  }
}

/**
 * 开奖后清掉全员邀请队列，避免未参与者继续弹「参与抽奖」
 */
async function clearInvitesForLottery(db, _, lotteryId) {
  const id = String(lotteryId || '').trim();
  if (!id) return;
  const PAGE = 20;
  let lastId = '';
  while (true) {
    let query = db.collection('users').orderBy('_id', 'asc').limit(PAGE);
    if (lastId) {
      query = db
        .collection('users')
        .where({ _id: _.gt(lastId) })
        .orderBy('_id', 'asc')
        .limit(PAGE);
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await query.get();
    const list = (res && res.data) || [];
    if (!list.length) break;

    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      list.map(async (row) => {
        const uid = row._id || row.openid;
        if (!uid) return;
        try {
          await db
            .collection('users')
            .doc(uid)
            .update({
              data: {
                pendingLotteryInvites: _.pull({ lotteryId: id }),
                updatedAt: db.serverDate(),
              },
            });
        } catch (e) {
          /* ignore */
        }
      }),
    );

    lastId = String(list[list.length - 1]._id || '');
    if (!lastId || list.length < PAGE) break;
  }
}

/**
 * 幂等发积分 + 写入开奖弹窗队列（仅参与者；两步分离，互不影响）
 */
async function creditAndPushResult(db, _, {
  openid,
  lotteryId,
  title,
  won,
  prizePoints,
  drawAtMs,
}) {
  if (!openid || !lotteryId) return;
  const userRef = db.collection('users').doc(openid);
  const pts = Math.max(0, Math.floor(Number(prizePoints) || 0));

  // 1) 先发积分（幂等）
  if (won && pts > 0) {
    try {
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(userRef);
        const data = (snap && snap.data) || null;
        if (!data) return;
        if (data.lotteryCredits && data.lotteryCredits[lotteryId]) return;
        transaction.update(userRef, {
          data: {
            points: _.inc(pts),
            [`lotteryCredits.${lotteryId}`]: true,
            updatedAt: db.serverDate(),
          },
        });
      });
    } catch (e) {
      console.warn('[draw] credit tx', openid, e.message || e);
      try {
        const data = (await userRef.get()).data;
        if (data && !(data.lotteryCredits && data.lotteryCredits[lotteryId])) {
          await userRef.update({
            data: {
              points: _.inc(pts),
              [`lotteryCredits.${lotteryId}`]: true,
              updatedAt: db.serverDate(),
            },
          });
        }
      } catch (e2) {
        console.error('[draw] credit fallback', openid, e2.message || e2);
      }
    }
  }

  // 2) 再写弹窗队列（幂等）
  try {
    const data = (await userRef.get()).data;
    if (!data) return;
    if (data.lotteryResultPushed && data.lotteryResultPushed[lotteryId]) return;
    if (data.lotteryResultsAcked && data.lotteryResultsAcked[lotteryId]) return;
    const resultId = `result_${lotteryId}_${openid}`;
    if (data.lotteryResultsAcked && data.lotteryResultsAcked[resultId]) return;
    await userRef.update({
      data: {
        pendingLotteryResults: _.push({
          id: resultId,
          lotteryId,
          title,
          won: !!won,
          prizePoints: pts,
          drawAt: drawAtMs || 0,
          at: Date.now(),
        }),
        [`lotteryResultPushed.${lotteryId}`]: true,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    console.warn('[draw] push result', openid, e.message || e);
  }
}

/**
 * 补发：用户已中奖但积分未到账 / 弹窗队列缺失时修复
 */
async function repairMyLotteryCredits(db, _, openid) {
  if (!openid) return { repaired: 0 };
  let entries = [];
  try {
    const res = await db
      .collection('lottery_entries')
      .where({ openid, won: true })
      .limit(50)
      .get();
    entries = (res && res.data) || [];
  } catch (e) {
    try {
      const res = await db
        .collection('lottery_entries')
        .where({ openid })
        .limit(50)
        .get();
      entries = ((res && res.data) || []).filter((r) => r && r.won);
    } catch (e2) {
      return { repaired: 0 };
    }
  }
  if (!entries.length) return { repaired: 0 };

  let user;
  try {
    user = (await db.collection('users').doc(openid).get()).data;
  } catch (e) {
    return { repaired: 0 };
  }
  if (!user) return { repaired: 0 };

  let repaired = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    const lotteryId = String(entry.lotteryId || '').trim();
    const pts = Math.max(0, Math.floor(Number(entry.prizePoints) || 0));
    if (!lotteryId || pts <= 0) continue;
    const credited = user.lotteryCredits && user.lotteryCredits[lotteryId];
    const pushed = user.lotteryResultPushed && user.lotteryResultPushed[lotteryId];
    const acked =
      (user.lotteryResultsAcked && user.lotteryResultsAcked[lotteryId]) ||
      (user.lotteryResultsAcked &&
        user.lotteryResultsAcked[`result_${lotteryId}_${openid}`]);
    if (credited && (pushed || acked)) continue;

    let title = '抽奖活动';
    let drawAtMs = 0;
    try {
      // eslint-disable-next-line no-await-in-loop
      const lot = (await db.collection('lotteries').doc(lotteryId).get()).data;
      if (lot) {
        title = String(lot.title || title);
        drawAtMs = toMs(lot.drawAt || lot.drawnAt);
      }
    } catch (e) {
      /* ignore */
    }

    // eslint-disable-next-line no-await-in-loop
    await creditAndPushResult(db, _, {
      openid,
      lotteryId,
      title,
      won: true,
      prizePoints: pts,
      drawAtMs,
    });
    repaired += 1;
    user.lotteryCredits = user.lotteryCredits || {};
    user.lotteryCredits[lotteryId] = true;
    user.lotteryResultPushed = user.lotteryResultPushed || {};
    user.lotteryResultPushed[lotteryId] = true;
  }
  return { repaired };
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

    // 发奖 + 写 entry + 推结果（积分与弹窗队列分开写，避免同事务 _.inc+_.push 整段失败）
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

      // eslint-disable-next-line no-await-in-loop
      await creditAndPushResult(db, _, {
        openid,
        lotteryId: id,
        title,
        won,
        prizePoints,
        drawAtMs,
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

    // 未参与者不应再看到邀请弹窗 / 误以为开奖提醒
    try {
      await clearInvitesForLottery(db, _, id);
    } catch (e) {
      console.warn('[draw] clear invites', e.message || e);
    }

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
  creditAndPushResult,
  repairMyLotteryCredits,
  clearInvitesForLottery,
};
