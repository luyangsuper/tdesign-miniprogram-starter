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

/** 订阅消息 time：上海时区「YYYY年MM月DD日 HH:mm」 */
function formatNotifyTime(ms) {
  const raw = Number(ms) || Date.now();
  const d = new Date(raw + 8 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return '刚刚';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}年${pad(d.getUTCMonth() + 1)}月${pad(d.getUTCDate())}日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** developer | trial | formal */
function resolveMpState(explicit) {
  const fromArg = String(explicit || '').trim();
  if (
    fromArg === 'developer' ||
    fromArg === 'trial' ||
    fromArg === 'formal'
  ) {
    return fromArg;
  }
  const fromEnv = String(process.env.SUBSCRIBE_MP_STATE || '').trim();
  if (fromEnv === 'developer' || fromEnv === 'trial' || fromEnv === 'formal') {
    return fromEnv;
  }
  return 'formal';
}

/** 定时开奖无客户端上下文时，按优先级尝试，避免 develop 授权却用 formal 下发 → 43101 */
function mpStateCandidates(explicit) {
  const primary = resolveMpState(explicit);
  const list = [primary, 'formal', 'trial', 'developer'];
  return list.filter((s, i) => list.indexOf(s) === i);
}

async function clearCredit(db, openid, field) {
  try {
    await db.collection('users').doc(openid).update({
      data: {
        [field]: 0,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    /* ignore */
  }
}

function errInfo(err) {
  const code = err && (err.errCode || err.code);
  const msg = err && (err.errMsg || err.message || '');
  return { code: code != null ? String(code) : '', msg: String(msg || '') };
}

/** 拉取有「发布抽奖」提醒额度的用户；where 空时降级全表扫描（小用户量） */
async function loadInviteCreditUsers(db) {
  const _ = db.command;
  const PAGE = 100;
  try {
    const res = await db
      .collection('users')
      .where({ lotteryInviteNotifyCredits: _.gt(0) })
      .limit(PAGE)
      .get();
    const rows = (res && res.data) || [];
    if (rows.length) return { rows, via: 'where', winOnly: 0 };
  } catch (e) {
    console.warn('[lotteryInvite] where fail, fallback scan', e.message || e);
  }

  let lastId = '';
  const rows = [];
  let winOnly = 0;
  while (rows.length < 500) {
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
    const batch = (res && res.data) || [];
    if (!batch.length) break;
    batch.forEach((u) => {
      const invite = Math.max(0, Number(u.lotteryInviteNotifyCredits) || 0);
      const win = Math.max(0, Number(u.lotteryWinNotifyCredits) || 0);
      if (invite > 0) rows.push(u);
      else if (win > 0) winOnly += 1;
    });
    lastId = String(batch[batch.length - 1]._id || '');
    if (!lastId || batch.length < PAGE) break;
  }
  return { rows, via: 'scan', winOnly };
}

/**
 * 给有额度的用户发「获得抽奖机会」
 * @param {object} [opts.miniprogramState]
 */
async function sendLotteryInviteNotices(
  cloud,
  db,
  { lotteryId, title, miniprogramState, costPoints },
) {
  const mpState = resolveMpState(miniprogramState);
  let sent = 0;
  let skipped = 0;
  let lastError = '';
  let creditUsers = 0;
  let winOnlyUsers = 0;
  let queryVia = '';

  let rows = [];
  try {
    const loaded = await loadInviteCreditUsers(db);
    rows = loaded.rows || [];
    creditUsers = rows.length;
    winOnlyUsers = Number(loaded.winOnly) || 0;
    queryVia = loaded.via || '';
  } catch (e) {
    lastError = String((e && e.message) || e);
    console.warn('[lotteryInvite] load users fail', lastError);
    return { sent, skipped, lastError, creditUsers, winOnlyUsers, queryVia };
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const user of rows) {
    const openid = String(user._id || user.openid || '');
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
        miniprogramState: mpState,
        data: {
          // number 类字段须传数字字符串，否则易 47003
          number1: { value: '1' },
          thing3: {
            value: clipThing(
              Number(costPoints) > 0
                ? `投入${Number(costPoints)}分可抽「${title}」`
                : `「${title}」可参与抽奖`,
              '打开趣集参与抽奖',
            ),
          },
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
      const { code, msg } = errInfo(err);
      lastError = code || msg || 'send fail';
      console.warn(
        '[lotteryInvite] send fail',
        openid,
        lastError,
        msg,
        'mpState=',
        mpState,
      );
      if (code === '43101') {
        // eslint-disable-next-line no-await-in-loop
        await clearCredit(db, openid, 'lotteryInviteNotifyCredits');
      }
    }
  }

  return {
    sent,
    skipped,
    lastError,
    creditUsers,
    winOnlyUsers,
    queryVia,
  };
}

/**
 * 给中奖用户发「中奖结果通知」（需有额度）
 */
async function sendLotteryWinNotice(
  cloud,
  db,
  { openid, title, prizePoints, lotteryId, miniprogramState },
) {
  if (!openid || !(prizePoints > 0)) return false;
  let user = {};
  try {
    user = (await db.collection('users').doc(openid).get()).data || {};
  } catch (e) {
    return false;
  }
  const credits = Math.max(0, Number(user.lotteryWinNotifyCredits) || 0);
  if (credits <= 0) {
    console.warn('[lotteryWin] no credits', openid);
    return false;
  }

  const pts = Math.max(1, Math.floor(Number(prizePoints) || 0));
  const data = {
    thing1: { value: clipThing(`${pts}积分`, '趣集积分') },
    number2: { value: String(pts) },
    time3: { value: formatNotifyTime(Date.now()) },
    thing4: { value: clipThing('积分已到账，可兑原图', '请打开小程序查看') },
    thing5: { value: clipThing(title, '抽奖活动') },
  };
  const page = `pages/lottery/detail/index?id=${lotteryId}`;
  const states = mpStateCandidates(miniprogramState);
  let lastFail = '';

  // eslint-disable-next-line no-restricted-syntax
  for (const mpState of states) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: WIN_TMPL,
        page,
        lang: 'zh_CN',
        miniprogramState: mpState,
        data,
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
      const { code, msg } = errInfo(err);
      lastFail = code || msg || 'send fail';
      console.warn(
        '[lotteryWin] send fail',
        openid,
        lastFail,
        msg,
        'mpState=',
        mpState,
      );
      // 模板参数错误换版本也没用
      if (code === '47003' || code === '40037') break;
      // 43101：可能是版本不匹配，继续试下一档；全部失败再清额度
      if (code !== '43101') break;
    }
  }

  if (lastFail === '43101') {
    await clearCredit(db, openid, 'lotteryWinNotifyCredits');
  }
  return false;
}

module.exports = {
  sendLotteryInviteNotices,
  sendLotteryWinNotice,
  clipThing,
  formatNotifyTime,
  resolveMpState,
};
