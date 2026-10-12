const cloud = require('wx-server-sdk');
const { toMs, runDraw, ensureDrawn, ensureCollection } = require('./draw');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

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
    joined: !!(entry && entry.openid),
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
      // 拉队列前先扫到期开奖，避免首页只读 entitlement 时永远不开奖
      try {
        const due = await db
          .collection('lotteries')
          .where({ status: 'open', drawAt: _.lte(new Date()) })
          .limit(5)
          .get();
        const rows = (due && due.data) || [];
        // eslint-disable-next-line no-restricted-syntax
        for (const row of rows) {
          // eslint-disable-next-line no-await-in-loop
          await runDraw(cloud, db, row._id);
        }
      } catch (e) {
        /* ignore */
      }

      let user = {};
      try {
        user = (await db.collection('users').doc(OPENID).get()).data || {};
      } catch (e) {
        user = {};
      }
      return {
        ok: true,
        data: {
          pendingLotteryInvites: Array.isArray(user.pendingLotteryInvites)
            ? user.pendingLotteryInvites.slice(0, 20)
            : [],
          pendingLotteryResults: Array.isArray(user.pendingLotteryResults)
            ? user.pendingLotteryResults.slice(0, 20)
            : [],
        },
      };
    }

    if (action === 'list') {
      // 懒开奖：扫少量到期
      try {
        const due = await db
          .collection('lotteries')
          .where({ status: 'open', drawAt: _.lte(new Date()) })
          .limit(5)
          .get();
        const rows = (due && due.data) || [];
        // eslint-disable-next-line no-restricted-syntax
        for (const row of rows) {
          // eslint-disable-next-line no-await-in-loop
          await runDraw(cloud, db, row._id);
        }
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
        pendingLotteryInvites = Array.isArray(user.pendingLotteryInvites)
          ? user.pendingLotteryInvites.slice(0, 20)
          : [];
        pendingLotteryResults = Array.isArray(user.pendingLotteryResults)
          ? user.pendingLotteryResults.slice(0, 20)
          : [];
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
      const entry = await getEntry(lotteryId, OPENID);
      return { ok: true, data: mapLottery(lot, OPENID, entry) };
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
      const entryRef = db.collection('lottery_entries').doc(entryId);
      try {
        await entryRef.get();
        // 已存在
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
        await entryRef.set({
          data: {
            lotteryId,
            openid: OPENID,
            nickName: nickName || '趣集用户',
            joinedAt: db.serverDate(),
            won: false,
            prizePoints: 0,
          },
        });
      } catch (err) {
        return { ok: true, message: '已参与', data: { joined: true, already: true } };
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

      return { ok: true, message: '参与成功，等待开奖', data: { joined: true } };
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
        if (resultId) {
          await db
            .collection('users')
            .doc(OPENID)
            .update({
              data: {
                pendingLotteryResults: _.pull({ id: resultId }),
                updatedAt: db.serverDate(),
              },
            });
        } else if (lotteryId) {
          await db
            .collection('users')
            .doc(OPENID)
            .update({
              data: {
                pendingLotteryResults: _.pull({ lotteryId }),
                updatedAt: db.serverDate(),
              },
            });
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
