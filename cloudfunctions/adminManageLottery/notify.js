/** 抽奖订阅消息发送（获得抽奖机会 / 中奖结果） */

const INVITE_TMPL =
  process.env.SUBSCRIBE_LOTTERY_INVITE_TMPL_ID ||
  'qVZWH6E_XuOXoh7Zob5gc5yTPWX48KwPq1UaBlo_iyc';
const WIN_TMPL =
  process.env.SUBSCRIBE_LOTTERY_WIN_TMPL_ID ||
  '4YaXF8Jp4lZGNUOmVyF5gvSO8EVMMv1IoYKUmiF9Gk8';

function clipThing(s, fallback = '-') {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return fallback;
  return t.length > 20 ? `${t.slice(0, 19)}…` : t;
}

function formatNotifyTime(ms) {
  const d = new Date(ms || Date.now());
  if (Number.isNaN(d.getTime())) return '刚刚';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 给有额度的用户发「获得抽奖机会」
 */
async function sendLotteryInviteNotices(cloud, db, { lotteryId, title }) {
  const _ = db.command;
  let sent = 0;
  let skipped = 0;
  let lastId = '';
  const PAGE = 100;

  while (true) {
    let query = db
      .collection('users')
      .where({ lotteryInviteNotifyCredits: _.gt(0) })
      .orderBy('_id', 'asc')
      .limit(PAGE);
    if (lastId) {
      query = db
        .collection('users')
        .where({
          lotteryInviteNotifyCredits: _.gt(0),
          _id: _.gt(lastId),
        })
        .orderBy('_id', 'asc')
        .limit(PAGE);
    }
    let rows = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await query.get();
      rows = (res && res.data) || [];
    } catch (e) {
      // 无索引时降级：扫少量用户
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await db.collection('users').limit(PAGE).get();
        rows = ((res && res.data) || []).filter(
          (u) => Math.max(0, Number(u.lotteryInviteNotifyCredits) || 0) > 0,
        );
      } catch (err) {
        break;
      }
      lastId = '';
    }
    if (!rows.length) break;

    // eslint-disable-next-line no-restricted-syntax
    for (const user of rows) {
      const openid = user._id || user.openid;
      if (!openid) {
        skipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      const credits = Math.max(0, Number(user.lotteryInviteNotifyCredits) || 0);
      if (credits <= 0) {
        skipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await cloud.openapi.subscribeMessage.send({
          touser: openid,
          templateId: INVITE_TMPL,
          page: `pages/lottery/detail/index?id=${lotteryId}`,
          lang: 'zh_CN',
          miniprogramState: 'formal',
          data: {
            number1: { value: 1 },
            thing3: { value: clipThing(`「${title}」可参与抽奖`, '打开趣集参与抽奖') },
          },
        });
        // eslint-disable-next-line no-await-in-loop
        await db
          .collection('users')
          .doc(openid)
          .update({
            data: {
              lotteryInviteNotifyCredits: Math.max(0, credits - 1),
              updatedAt: db.serverDate(),
            },
          });
        sent += 1;
      } catch (err) {
        skipped += 1;
        console.warn('[lotteryInvite] send fail', openid, err.errCode || err.message);
      }
    }

    if (!lastId && rows.length) {
      // 降级路径只跑一轮
      break;
    }
    lastId = String(rows[rows.length - 1]._id || '');
    if (!lastId || rows.length < PAGE) break;
  }

  return { sent, skipped };
}

/**
 * 给中奖用户发「中奖结果通知」（需有额度）
 */
async function sendLotteryWinNotice(cloud, db, { openid, title, prizePoints, lotteryId }) {
  if (!openid || !(prizePoints > 0)) return false;
  let user = {};
  try {
    user = (await db.collection('users').doc(openid).get()).data || {};
  } catch (e) {
    return false;
  }
  const credits = Math.max(0, Number(user.lotteryWinNotifyCredits) || 0);
  if (credits <= 0) return false;

  const pts = Math.max(1, Math.floor(Number(prizePoints) || 0));
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: WIN_TMPL,
      page: `pages/lottery/detail/index?id=${lotteryId}`,
      lang: 'zh_CN',
      miniprogramState: 'formal',
      data: {
        thing1: { value: clipThing(`${pts}积分`, '趣集积分') },
        number2: { value: pts },
        time3: { value: formatNotifyTime(Date.now()) },
        thing4: { value: clipThing('积分已到账，可兑原图', '请打开小程序查看') },
        thing5: { value: clipThing(title, '抽奖活动') },
      },
    });
    await db
      .collection('users')
      .doc(openid)
      .update({
        data: {
          lotteryWinNotifyCredits: Math.max(0, credits - 1),
          updatedAt: db.serverDate(),
        },
      });
    return true;
  } catch (err) {
    console.warn('[lotteryWin] send fail', openid, err.errCode || err.message);
    return false;
  }
}

module.exports = {
  sendLotteryInviteNotices,
  sendLotteryWinNotice,
  clipThing,
  formatNotifyTime,
};
