/**
 * 投入积分抽奖：类型字段、实发奖池、报名费退回。
 */
const { recordPointsLog } = require('./pointsLog');

function lotteryType(row) {
  return String((row && row.type) || 'free') === 'paid' ? 'paid' : 'free';
}

function lotteryCost(row) {
  if (lotteryType(row) !== 'paid') return 0;
  const n = Math.floor(Number(row && row.costPoints) || 0);
  return Math.max(1, Math.min(999, n));
}

function lotteryPayoutRate(row) {
  const r = Number(row && row.payoutRate);
  if (!Number.isFinite(r)) return 0.5;
  return Math.min(0.9, Math.max(0.1, r));
}

/**
 * paid：actualPool = min(T, floor(collected * rate))，N 保证每份至少 cost+1。
 * 算不出赢家则 refundAll。
 */
function planPaidDraw(lot, entryCount) {
  const n = Math.max(0, Math.floor(Number(entryCount) || 0));
  const poolCap = Math.max(0, Math.floor(Number(lot && lot.poolPoints) || 0));
  const wantWinners = Math.max(1, Math.floor(Number(lot && lot.winnerCount) || 1));
  if (lotteryType(lot) !== 'paid') {
    const k = Math.min(wantWinners, n);
    return {
      paid: false,
      collected: 0,
      actualPool: poolCap,
      k,
      minPrize: 1,
      refundAll: false,
      cost: 0,
    };
  }
  const cost = lotteryCost(lot);
  const collected = n * cost;
  const rate = lotteryPayoutRate(lot);
  const actualPool = Math.min(poolCap, Math.floor(collected * rate));
  const minPrize = cost + 1;
  const k = Math.min(wantWinners, n, Math.floor(actualPool / minPrize));
  if (k < 1) {
    return {
      paid: true,
      collected,
      actualPool: 0,
      k: 0,
      minPrize,
      refundAll: true,
      cost,
      payoutRate: rate,
    };
  }
  return {
    paid: true,
    collected,
    actualPool,
    k,
    minPrize,
    refundAll: false,
    cost,
    payoutRate: rate,
  };
}

function lotteryFields(row) {
  const type = lotteryType(row);
  const costPoints = type === 'paid' ? lotteryCost(row) : 0;
  const payoutRate = type === 'paid' ? lotteryPayoutRate(row) : 0;
  const collectedPoints = Math.max(0, Math.floor(Number(row && row.collectedPoints) || 0));
  const actualPool = Math.max(0, Math.floor(Number(row && row.actualPool) || 0));
  const drawOutcome = String((row && row.drawOutcome) || '');
  return {
    type,
    costPoints,
    payoutRate,
    collectedPoints,
    actualPool,
    drawOutcome,
    refunded: drawOutcome === 'refunded',
  };
}

async function refundOneEntry(db, command, opts) {
  const openid = String((opts && opts.openid) || '').trim();
  const entryId = String((opts && opts.entryId) || '').trim();
  const lotteryId = String((opts && opts.lotteryId) || '').trim();
  const title = String((opts && opts.title) || '抽奖活动').slice(0, 20);
  const cost = Math.max(0, Math.floor(Number(opts && opts.cost) || 0));
  if (!openid || !entryId) return { refunded: false, delta: 0 };

  let credited = 0;
  try {
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.collection('lottery_entries').doc(entryId).get();
      const data = (snap && snap.data) || null;
      if (!data || data.refunded) {
        credited = 0;
        return;
      }
      await transaction.collection('lottery_entries').doc(entryId).update({
        data: {
          refunded: true,
          updatedAt: db.serverDate(),
        },
      });
      if (cost > 0) {
        await transaction.collection('users').doc(openid).update({
          data: {
            points: command.inc(cost),
            updatedAt: db.serverDate(),
          },
        });
        credited = cost;
      }
    });
  } catch (e) {
    console.warn('[lotteryPaid] refund tx', entryId, (e && e.message) || e);
    return { refunded: false, delta: 0 };
  }

  if (credited > 0) {
    try {
      const after = (await db.collection('users').doc(openid).get()).data || {};
      await recordPointsLog(db, {
        openid,
        delta: credited,
        balance: Math.max(0, Number(after.points) || 0),
        reason: 'lottery_refund',
        title: `抽奖「${title}」退回`,
        meta: { lotteryId },
      });
    } catch (e) {
      /* ignore */
    }
  }
  return { refunded: true, delta: credited };
}

async function refundPaidEntries(db, command, { lotteryId, title, costFallback, entries }) {
  const list = Array.isArray(entries) ? entries : [];
  let refunded = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const entry of list) {
    if (!entry) continue;
    const entryId = entry._id || (lotteryId && entry.openid ? `${lotteryId}_${entry.openid}` : '');
    const cost = Math.max(
      0,
      Math.floor(Number(entry.costPoints) || Number(costFallback) || 0),
    );
    // eslint-disable-next-line no-await-in-loop
    const r = await refundOneEntry(db, command, {
      openid: entry.openid,
      entryId,
      lotteryId,
      title,
      cost,
    });
    if (r.refunded) refunded += 1;
  }
  return { refunded };
}

module.exports = {
  lotteryType,
  lotteryCost,
  lotteryPayoutRate,
  lotteryFields,
  planPaidDraw,
  refundOneEntry,
  refundPaidEntries,
};
