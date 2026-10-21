const cloud = require('wx-server-sdk');
const {
  toMs,
  runDraw,
  ensureDrawn,
  ensureCollection,
  repairMyLotteryCredits,
  repairMyPaidLottery,
} = require('./draw');
const { lotteryType, lotteryCost, lotteryFields } = require('./lotteryPaid');
const { recordPointsLog } = require('./pointsLog');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

async function lazyDrawDue() {
  const rows = [];
  const seen = new Set();
  const pushRows = (list) => {
    (list || []).forEach((row) => {
      if (row && row._id && !seen.has(row._id)) {
        seen.add(row._id);
        rows.push(row);
      }
    });
  };
  try {
    const due = await db
      .collection('lotteries')
      .where({ status: 'open', drawAt: _.lte(new Date()) })
      .limit(5)
      .get();
    pushRows(due && due.data);
  } catch (e) {
    /* ignore */
  }
  try {
    const drawing = await db
      .collection('lotteries')
      .where({ status: 'drawing' })
      .limit(5)
      .get();
    pushRows(drawing && drawing.data);
  } catch (e) {
    /* ignore */
  }
  // eslint-disable-next-line no-restricted-syntax
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await runDraw(cloud, db, row._id);
  }
}

function mapLottery(row, openid, entry) {
  if (!row) return null;
  const id = row._id || row.id;
  const winners = Array.isArray(row.winners) ? row.winners : [];
  const myWin = openid ? winners.find((w) => w && w.openid === openid) : null;
  return {
    id,
    title: row.title || '',
    poolPoints: Number(row.poolPoints) || 0,
    winnerCount: Number(row.winnerCount) || 0,
    drawAt: toMs(row.drawAt),
    drawAtText: '',
    status: row.status || 'open',
    participantCount: Number(row.participantCount) || 0,
    joined: !!(entry || myWin),
    won: entry ? !!entry.won : !!myWin,
    prizePoints: entry
      ? Number(entry.prizePoints) || 0
      : myWin
        ? Number(myWin.points) || 0
        : 0,
    winners: winners.map((w) => ({
      openid: w.openid,
      nickName: w.nickName || '趣集用户',
      points: Number(w.points) || 0,
      rank: Number(w.rank) || 0,
      isMe: !!(openid && w.openid === openid),
    })),
    drawnAt: toMs(row.drawnAt),
    ...lotteryFields(row),
    paidCost: entry ? Math.max(0, Number(entry.costPoints) || 0) : 0,
  };
}

async function getEntry(lotteryId, openid) {
  try {
    const snap = await db
      .collection('lottery_entries')
      .doc(`${lotteryId}_${openid}`)
      .get();
    return snap.data || null;
  } catch (e) {
    return null;
  }
}

/**
 * 清洗待办：
 * - 邀请：仅保留仍报名中且未到开奖时间的活动（已开奖/取消/过期一律丢掉）
 * - 结果：仅保留本人已参与的活动（未参与绝不弹开奖结果）
 */
async function sanitizeUserLotteryPending(openid, user) {
  const rawInvites = Array.isArray(user.pendingLotteryInvites)
    ? user.pendingLotteryInvites
    : [];
  const rawResults = Array.isArray(user.pendingLotteryResults)
    ? user.pendingLotteryResults
    : [];

  const keepInvites = [];
  const dropInviteLotteryIds = new Set();
  // eslint-disable-next-line no-restricted-syntax
  for (const inv of rawInvites) {
    if (!inv || !inv.lotteryId || !inv.id) continue;
    const lotteryId = String(inv.lotteryId);
    let lot = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      lot = (await db.collection('lotteries').doc(lotteryId).get()).data;
    } catch (e) {
      lot = null;
    }
    const drawAt = toMs(inv.drawAt || (lot && lot.drawAt));
    const status = (lot && lot.status) || '';
    const stillOpen =
      lot && status === 'open' && drawAt > Date.now();
    if (!stillOpen) {
      dropInviteLotteryIds.add(lotteryId);
      continue;
    }
    keepInvites.push(inv);
  }

  const keepResults = [];
  const dropResultIds = [];
  const ackedMap = (user && user.lotteryResultsAcked) || {};
  // eslint-disable-next-line no-restricted-syntax
  for (const r of rawResults) {
    if (!r || !r.lotteryId || !r.id) continue;
    const lid = String(r.lotteryId);
    // 用户已点过「好的」确认：不再下发，并清队列
    if (ackedMap[lid] || ackedMap[String(r.id)]) {
      dropResultIds.push(r.id);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const entry = await getEntry(r.lotteryId, openid);
    if (!entry) {
      dropResultIds.push(r.id);
      continue;
    }
    keepResults.push(r);
  }

  if (dropInviteLotteryIds.size || dropResultIds.length) {
    // eslint-disable-next-line no-restricted-syntax
    for (const lid of dropInviteLotteryIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await db
          .collection('users')
          .doc(openid)
          .update({
            data: {
              pendingLotteryInvites: _.pull({ lotteryId: lid }),
              updatedAt: db.serverDate(),
            },
          });
      } catch (e) {
        /* ignore */
      }
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const rid of dropResultIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await db
          .collection('users')
          .doc(openid)
          .update({
            data: {
              pendingLotteryResults: _.pull({ id: rid }),
              updatedAt: db.serverDate(),
            },
          });
      } catch (e) {
        /* ignore */
      }
    }
  }

  return {
    pendingLotteryInvites: keepInvites.slice(0, 20),
    pendingLotteryResults: keepResults.slice(0, 20),
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = event.action || 'list';

  try {
    await ensureCollection(db, 'lotteries');
    await ensureCollection(db, 'lottery_entries');

    if (action === 'pending') {
      // 拉队列前先扫到期 / 卡住的开奖
      try {
        await lazyDrawDue();
      } catch (e) {
        /* ignore */
      }

      // 历史中奖未到账 / 未入弹窗队列时补发
      try {
        await repairMyLotteryCredits(db, _, OPENID);
      } catch (e) {
        /* ignore */
      }
      try {
        await repairMyPaidLottery(db, _, OPENID);
      } catch (e) {
        /* ignore */
      }

      let user = {};
      try {
        user = (await db.collection('users').doc(OPENID).get()).data || {};
      } catch (e) {
        user = {};
      }
      const pending = await sanitizeUserLotteryPending(OPENID, user);
      return {
        ok: true,
        data: {
          ...pending,
          points: Math.max(0, Number(user.points) || 0),
        },
      };
    }

    if (action === 'list') {
      try {
        await lazyDrawDue();
      } catch (e) {
        /* ignore */
      }

      try {
        await repairMyLotteryCredits(db, _, OPENID);
      } catch (e) {
        /* ignore */
      }
      try {
        await repairMyPaidLottery(db, _, OPENID);
      } catch (e) {
        /* ignore */
      }

      let openRows = [];
      let drawnRows = [];
      try {
        openRows =
          (
            await db
              .collection('lotteries')
              .where({ status: 'open' })
              .orderBy('drawAt', 'asc')
              .limit(20)
              .get()
          ).data || [];
      } catch (e) {
        openRows = [];
      }
      try {
        drawnRows =
          (
            await db
              .collection('lotteries')
              .where({ status: 'drawn' })
              .orderBy('drawnAt', 'desc')
              .limit(20)
              .get()
          ).data || [];
      } catch (e) {
        drawnRows = [];
      }

      const list = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const row of openRows.concat(drawnRows)) {
        if (!row || !row._id) continue;
        // eslint-disable-next-line no-await-in-loop
        const entry = await getEntry(row._id, OPENID);
        list.push(mapLottery(row, OPENID, entry));
      }

      let pendingLotteryInvites = [];
      let pendingLotteryResults = [];
      try {
        const user = (await db.collection('users').doc(OPENID).get()).data || {};
        const pending = await sanitizeUserLotteryPending(OPENID, user);
        pendingLotteryInvites = pending.pendingLotteryInvites;
        pendingLotteryResults = pending.pendingLotteryResults;
      } catch (e) {
        /* ignore */
      }

      return {
        ok: true,
        data: { list, pendingLotteryInvites, pendingLotteryResults },
      };
    }

    if (action === 'get') {
      const lotteryId = String(event.lotteryId || '').trim();
      if (!lotteryId) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少活动 ID' };
      }
      let lot;
      try {
        lot = (await db.collection('lotteries').doc(lotteryId).get()).data;
        if (lot) lot._id = lotteryId;
      } catch (e) {
        return { ok: false, code: 'NOT_FOUND', message: '活动不存在' };
      }
      lot = await ensureDrawn(cloud, db, lot);
      try {
        await repairMyLotteryCredits(db, _, OPENID);
      } catch (e) {
        /* ignore */
      }
      try {
        await repairMyPaidLottery(db, _, OPENID);
      } catch (e) {
        /* ignore */
      }
      const entry = await getEntry(lotteryId, OPENID);
      const mapped = mapLottery(lot, OPENID, entry);
      let pendingLotteryResults = [];
      // 仅参与者才带回开奖结果待办，未参与不弹窗
      if (entry) {
        try {
          const user = (await db.collection('users').doc(OPENID).get()).data || {};
          pendingLotteryResults = (
            Array.isArray(user.pendingLotteryResults)
              ? user.pendingLotteryResults
              : []
          )
            .filter((g) => g && g.lotteryId === lotteryId)
            .slice(0, 5);
        } catch (e) {
          /* ignore */
        }
      }
      return {
        ok: true,
        data: {
          ...mapped,
          pendingLotteryResults,
        },
      };
    }

    if (action === 'join') {
      const lotteryId = String(event.lotteryId || '').trim();
      if (!lotteryId) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少活动 ID' };
      }
      let lot;
      try {
        lot = (await db.collection('lotteries').doc(lotteryId).get()).data;
        if (lot) lot._id = lotteryId;
      } catch (e) {
        return { ok: false, code: 'NOT_FOUND', message: '活动不存在' };
      }
      lot = await ensureDrawn(cloud, db, lot);
      if (!lot || lot.status === 'cancelled') {
        return { ok: false, code: 'CANCELLED', message: '活动已取消' };
      }
      if (lot.status === 'drawn' || lot.status === 'drawing') {
        return { ok: false, code: 'CLOSED', message: '已开奖，无法再参与' };
      }
      if (toMs(lot.drawAt) <= Date.now()) {
        await runDraw(cloud, db, lotteryId);
        return { ok: false, code: 'CLOSED', message: '已到开奖时间' };
      }

      let nickName = '';
      try {
        const u = (await db.collection('users').doc(OPENID).get()).data || {};
        nickName = String(u.nickName || '').trim().slice(0, 32);
      } catch (e) {
        /* ignore */
      }

      const entryId = `${lotteryId}_${OPENID}`;
      const paid = lotteryType(lot) === 'paid';
      const cost = paid ? lotteryCost(lot) : 0;
      const entryPayload = {
        lotteryId,
        openid: OPENID,
        nickName: nickName || '趣集用户',
        joinedAt: db.serverDate(),
        won: false,
        prizePoints: 0,
        costPoints: cost,
      };

      if (paid) {
        let joinRes;
        try {
          joinRes = await db.runTransaction(async (transaction) => {
            const lotSnap = await transaction.collection('lotteries').doc(lotteryId).get();
            const lotNow = (lotSnap && lotSnap.data) || null;
            if (!lotNow || lotNow.status !== 'open' || toMs(lotNow.drawAt) <= Date.now()) {
              return { closed: true };
            }
            const userSnap = await transaction.collection('users').doc(OPENID).get();
            const user = (userSnap && userSnap.data) || null;
            if (!user) return { noUser: true };
            let exists = false;
            try {
              const existSnap = await transaction
                .collection('lottery_entries')
                .doc(entryId)
                .get();
              exists = !!(existSnap && existSnap.data);
            } catch (e) {
              exists = false;
            }
            if (exists) return { already: true, deducted: false, prev: 0, next: 0 };

            const prev = Math.max(0, Number(user.points) || 0);
            if (prev < cost) return { noPoints: true, prev };
            await transaction.collection('lottery_entries').doc(entryId).set({
              data: entryPayload,
            });
            // 只扣积分，不在同一次 update 里 _.inc + _.pull（云库易整段失败）
            await transaction.collection('users').doc(OPENID).update({
              data: {
                points: _.inc(-cost),
                updatedAt: db.serverDate(),
              },
            });
            return { already: false, deducted: true, prev, next: prev - cost };
          });
        } catch (e) {
          const msg = (e && e.message) || '参与失败';
          return { ok: false, code: 'FAIL', message: msg };
        }

        if (!joinRes) {
          return { ok: false, code: 'FAIL', message: '参与失败' };
        }
        if (joinRes && joinRes.closed) {
          return { ok: false, code: 'CLOSED', message: '已无法参与' };
        }
        if (joinRes && joinRes.noUser) {
          return { ok: false, code: 'NO_USER', message: '请先登录' };
        }
        if (joinRes && joinRes.noPoints) {
          return { ok: false, code: 'NO_POINTS', message: `积分不足，需 ${cost} 分` };
        }
        if (joinRes && joinRes.already) {
          return { ok: true, message: '已参与', data: { joined: true, already: true } };
        }
        if (joinRes && joinRes.deducted) {
          try {
            await db
              .collection('users')
              .doc(OPENID)
              .update({
                data: {
                  pendingLotteryInvites: _.pull({ lotteryId }),
                  updatedAt: db.serverDate(),
                },
              });
          } catch (e) {
            /* ignore */
          }
        }
        if (joinRes && joinRes.deducted && cost > 0) {
          try {
            await recordPointsLog(db, {
              openid: OPENID,
              delta: -cost,
              balance: joinRes.next,
              reason: 'lottery_entry',
              title: `抽奖「${String(lot.title || '').slice(0, 20)}」投入`,
              meta: { lotteryId, costPoints: cost },
            });
          } catch (e) {
            /* ignore */
          }
        }
      } else {
        const entryRef = db.collection('lottery_entries').doc(entryId);
        try {
          await entryRef.get();
          await db
            .collection('users')
            .doc(OPENID)
            .update({
              data: {
                pendingLotteryInvites: _.pull({ lotteryId }),
                updatedAt: db.serverDate(),
              },
            })
            .catch(() => {});
          return { ok: true, message: '已参与', data: { joined: true, already: true } };
        } catch (e) {
          /* not exists → create */
        }

        try {
          await entryRef.set({ data: entryPayload });
        } catch (err) {
          return { ok: true, message: '已参与', data: { joined: true, already: true } };
        }

        try {
          await db
            .collection('users')
            .doc(OPENID)
            .update({
              data: {
                pendingLotteryInvites: _.pull({ lotteryId }),
                updatedAt: db.serverDate(),
              },
            });
        } catch (e) {
          /* ignore */
        }
      }

      try {
        await db
          .collection('lotteries')
          .doc(lotteryId)
          .update({
            data: {
              participantCount: _.inc(1),
              updatedAt: db.serverDate(),
            },
          });
      } catch (e) {
        /* ignore */
      }

      return {
        ok: true,
        message: paid ? `已投入 ${cost} 分，等待开奖` : '参与成功，等待开奖',
        data: { joined: true, costPoints: cost },
      };
    }

    if (action === 'ackInvite') {
      const lotteryId = String(event.lotteryId || '').trim();
      const inviteId = String(event.inviteId || '').trim();
      try {
        const patch = { updatedAt: db.serverDate() };
        if (lotteryId) {
          await db
            .collection('users')
            .doc(OPENID)
            .update({
              data: {
                pendingLotteryInvites: _.pull({ lotteryId }),
                ...patch,
              },
            });
        } else if (inviteId) {
          await db
            .collection('users')
            .doc(OPENID)
            .update({
              data: {
                pendingLotteryInvites: _.pull({ id: inviteId }),
                ...patch,
              },
            });
        }
      } catch (e) {
        /* ignore */
      }
      return { ok: true };
    }

    if (action === 'ackResult') {
      const resultId = String(event.resultId || '').trim();
      const lotteryId = String(event.lotteryId || '').trim();
      try {
        const patch = {
          updatedAt: db.serverDate(),
        };
        if (resultId) {
          patch.pendingLotteryResults = _.pull({ id: resultId });
          patch[`lotteryResultsAcked.${resultId}`] = true;
        }
        if (lotteryId) {
          if (!resultId) {
            patch.pendingLotteryResults = _.pull({ lotteryId });
          }
          patch[`lotteryResultsAcked.${lotteryId}`] = true;
        }
        if (resultId || lotteryId) {
          await db.collection('users').doc(OPENID).update({ data: patch });
        }
      } catch (e) {
        /* ignore */
      }
      return { ok: true };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'FAIL',
      message: (e && e.message) || '操作失败',
    };
  }
};
