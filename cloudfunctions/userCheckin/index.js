const cloud = require('wx-server-sdk');
const { dayjs, TZ } = require('./time');
const { buildEntitlement } = require('./membership');
const { getPointsSettings } = require('./pointsSettings');
const { recordPointsLog } = require('./pointsLog');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
/** 事务内 doc.get 找不到记录时不抛错（官方推荐）；ensureUser 等仍用默认 db */
const dbTx = cloud.database({ throwOnNotFound: false });
const _ = db.command;

/** 每天最多补签次数、每月最多补签次数（固定规则） */
const MAKEUP_MAX_PER_DAY = 1;
const MAKEUP_MAX_PER_MONTH = 3;

function isCollectionMissing(err) {
  const code = err && (err.errCode || err.code);
  const msg = String((err && (err.errMsg || err.message)) || err || '');
  return (
    code === -502005 ||
    /COLLECTION_NOT_EXIST|database collection not exists|Db or Table not exist/i.test(
      msg,
    )
  );
}

/** 云开发未建表时查询会直接报错；启动时尝试建表，查询失败则当空 */
async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 已存在 / 无权限等：忽略，后续按查询结果处理
  }
}

let collectionsReady = false;
async function ensureCheckinCollections() {
  if (collectionsReady) return;
  await Promise.all([
    ensureCollection('user_checkins'),
    ensureCollection('app_config'),
  ]);
  collectionsReady = true;
}

function monthKeyOf(d) {
  return d.tz(TZ).format('YYYY-MM');
}

function dayKeyOf(d) {
  return d.tz(TZ).format('YYYY-MM-DD');
}

function parseMonthKey(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) {
    const d = dayjs.tz(`${s}-01`, TZ);
    if (d.isValid()) return monthKeyOf(d);
  }
  return monthKeyOf(dayjs());
}

function buildCalendar(monthKey, checkedSet, makeupSet, todayKey) {
  const start = dayjs.tz(`${monthKey}-01`, TZ).startOf('day');
  const daysInMonth = start.daysInMonth();
  const firstWeekday = (start.day() + 6) % 7;
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({
      type: 'pad',
      day: 0,
      dateKey: '',
      checked: false,
      isMakeup: false,
      isToday: false,
      isFuture: false,
      canMakeup: false,
    });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`;
    const isFuture = dateKey > todayKey;
    const checked = checkedSet.has(dateKey);
    const isToday = dateKey === todayKey;
    cells.push({
      type: 'day',
      day,
      dateKey,
      checked,
      isMakeup: makeupSet.has(dateKey),
      isToday,
      isFuture,
      // 前端再结合今日/本月剩余次数判断是否可点
      canMakeup: !checked && !isFuture && !isToday && dateKey < todayKey,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({
      type: 'pad',
      day: 0,
      dateKey: '',
      checked: false,
      isMakeup: false,
      isToday: false,
      isFuture: false,
      canMakeup: false,
    });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return { weeks, daysInMonth };
}

async function ensureUser(openid) {
  const ref = db.collection('users').doc(openid);
  try {
    const snap = await ref.get();
    return { ref, user: { _id: openid, ...(snap.data || {}) } };
  } catch (e) {
    // 不抢建 users：与 login 并发 set(points:0) 会抢走见面礼；建档交给 login
    return {
      ref,
      user: {
        _id: openid,
        openid,
        points: 0,
        vipMonthQuota: 0,
        vipQuotaPeriod: '',
        vipExpireAt: null,
      },
    };
  }
}

async function loadMonthRows(openid, monthKey) {
  try {
    const res = await db
      .collection('user_checkins')
      .where({ openid, monthKey })
      .limit(40)
      .get();
    return (res && res.data) || [];
  } catch (e) {
    if (isCollectionMissing(e)) {
      await ensureCollection('user_checkins');
      return [];
    }
    throw e;
  }
}

async function countMakeupOnDay(openid, makeupOnDateKey) {
  try {
    const res = await db
      .collection('user_checkins')
      .where({ openid, isMakeup: true, makeupOnDateKey })
      .limit(MAKEUP_MAX_PER_DAY + 2)
      .get();
    return ((res && res.data) || []).length;
  } catch (e) {
    if (isCollectionMissing(e)) return 0;
    throw e;
  }
}

async function countMakeupInMonth(openid, monthKey) {
  try {
    const res = await db
      .collection('user_checkins')
      .where({ openid, monthKey, isMakeup: true })
      .limit(MAKEUP_MAX_PER_MONTH + 2)
      .get();
    return ((res && res.data) || []).length;
  } catch (e) {
    if (isCollectionMissing(e)) return 0;
    throw e;
  }
}

/** 本月最早一个漏签日（不含今天） */
function findEarliestMissedDay(checkedSet, todayKey, monthKey) {
  const currentMonthKey = monthKeyOf(dayjs().tz(TZ));
  if (monthKey !== currentMonthKey) return '';
  const start = dayjs.tz(`${monthKey}-01`, TZ).startOf('day');
  const daysInMonth = start.daysInMonth();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`;
    if (dateKey >= todayKey) break;
    if (!checkedSet.has(dateKey)) return dateKey;
  }
  return '';
}

function formatDateLabel(dateKey) {
  const parts = String(dateKey || '').split('-');
  if (parts.length !== 3) return dateKey || '';
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function buildStatusPayload({
  monthKey,
  todayKey,
  settings,
  rows,
  currentMonthRows,
  points,
  makeupUsedToday,
  makeupUsedMonth,
}) {
  const checkedSet = new Set();
  const makeupSet = new Set();
  rows.forEach((row) => {
    if (row && row.dateKey) {
      checkedSet.add(String(row.dateKey));
      if (row.isMakeup) makeupSet.add(String(row.dateKey));
    }
  });
  const { weeks, daysInMonth } = buildCalendar(
    monthKey,
    checkedSet,
    makeupSet,
    todayKey,
  );
  const currentMonthKey = monthKeyOf(dayjs().tz(TZ));
  // 补签资格始终按「本月」记录算，避免翻到其他月份时误判
  const currentCheckedSet = new Set();
  (currentMonthRows || rows).forEach((row) => {
    if (row && row.dateKey) currentCheckedSet.add(String(row.dateKey));
  });
  const makeupLeftToday = Math.max(0, MAKEUP_MAX_PER_DAY - makeupUsedToday);
  const makeupLeftMonth = Math.max(0, MAKEUP_MAX_PER_MONTH - makeupUsedMonth);
  const nextMakeupDateKey = findEarliestMissedDay(
    currentCheckedSet,
    todayKey,
    currentMonthKey,
  );
  const canMakeupNow =
    !!nextMakeupDateKey && makeupLeftToday > 0 && makeupLeftMonth > 0;

  const weeksMarked = weeks.map((week) =>
    week.map((cell) => {
      const isNextMakeup = !!(
        canMakeupNow &&
        cell.dateKey &&
        cell.dateKey === nextMakeupDateKey
      );
      return {
        ...cell,
        canMakeup: isNextMakeup,
        isNextMakeup,
      };
    }),
  );

  return {
    monthKey,
    todayKey,
    checkinPoints: settings.checkinPoints,
    welcomeGiftPoints: settings.welcomeGiftPoints,
    checkedToday: currentCheckedSet.has(todayKey),
    checkedCount: checkedSet.size,
    daysInMonth,
    weeks: weeksMarked,
    points,
    makeupMaxPerDay: MAKEUP_MAX_PER_DAY,
    makeupMaxPerMonth: MAKEUP_MAX_PER_MONTH,
    makeupUsedToday,
    makeupUsedMonth,
    makeupLeftToday,
    makeupLeftMonth,
    canMakeupNow,
    nextMakeupDateKey: canMakeupNow ? nextMakeupDateKey : '',
    nextMakeupDateLabel: canMakeupNow
      ? formatDateLabel(nextMakeupDateKey)
      : '',
  };
}

async function loadPoints(openid) {
  try {
    const snap = await db.collection('users').doc(openid).get();
    return Math.max(0, Number((snap.data && snap.data.points) || 0));
  } catch (e) {
    return 0;
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  await ensureCheckinCollections();

  const action = event.action || 'status';
  const settings = await getPointsSettings(db);
  const now = dayjs().tz(TZ);
  const todayKey = dayKeyOf(now);
  const currentMonthKey = monthKeyOf(now);
  const monthKey = parseMonthKey(event.monthKey || currentMonthKey);

  try {
    if (action === 'status') {
      const rows = await loadMonthRows(OPENID, monthKey);
      const currentMonthRows =
        monthKey === currentMonthKey
          ? rows
          : await loadMonthRows(OPENID, currentMonthKey);
      const makeupUsedToday = await countMakeupOnDay(OPENID, todayKey);
      const makeupUsedMonth = await countMakeupInMonth(OPENID, currentMonthKey);
      const points = await loadPoints(OPENID);
      return {
        ok: true,
        data: buildStatusPayload({
          monthKey,
          todayKey,
          settings,
          rows,
          currentMonthRows,
          points,
          makeupUsedToday,
          makeupUsedMonth,
        }),
      };
    }

    if (action === 'checkin' || action === 'makeup') {
      if (settings.checkinPoints <= 0) {
        return { ok: false, code: 'DISABLED', message: '签到暂未开放' };
      }

      // makeup / autoMakeup：自动补最早漏签日；普通签到不传 dateKey 则签今天
      const wantMakeup =
        action === 'makeup' ||
        event.autoMakeup === true ||
        (!!event.dateKey && String(event.dateKey) !== todayKey);

      let requestDate = todayKey;
      if (wantMakeup) {
        const monthRows = await loadMonthRows(OPENID, currentMonthKey);
        const checkedSet = new Set(
          monthRows.map((r) => r && r.dateKey).filter(Boolean).map(String),
        );
        const autoDate = findEarliestMissedDay(
          checkedSet,
          todayKey,
          currentMonthKey,
        );
        if (!autoDate) {
          return { ok: false, code: 'NO_MISS', message: '本月没有可补签的日期' };
        }
        // 忽略客户端指定日期，统一由服务端选最早漏签日
        requestDate = autoDate;

        const makeupUsedToday = await countMakeupOnDay(OPENID, todayKey);
        if (makeupUsedToday >= MAKEUP_MAX_PER_DAY) {
          return {
            ok: false,
            code: 'MAKEUP_DAY_LIMIT',
            message: `今天已补签 ${MAKEUP_MAX_PER_DAY} 次，明天再来吧`,
          };
        }
        const makeupUsedMonth = await countMakeupInMonth(OPENID, currentMonthKey);
        if (makeupUsedMonth >= MAKEUP_MAX_PER_MONTH) {
          return {
            ok: false,
            code: 'MAKEUP_MONTH_LIMIT',
            message: `本月补签已达上限（${MAKEUP_MAX_PER_MONTH} 次）`,
          };
        }
      } else if (event.dateKey) {
        requestDate = String(event.dateKey).trim();
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(requestDate)) {
        return { ok: false, code: 'BAD_PARAM', message: '日期无效' };
      }
      if (requestDate > todayKey) {
        return { ok: false, code: 'BAD_PARAM', message: '不能签未来的日期' };
      }

      const isMakeup = requestDate !== todayKey;
      const targetMonthKey = requestDate.slice(0, 7);

      if (isMakeup && targetMonthKey !== currentMonthKey) {
        return { ok: false, code: 'BAD_PARAM', message: '只能补签本月漏掉的日期' };
      }

      const docId = `${OPENID}_${requestDate}`;
      const { ref: userRef, user: ensuredUser } = await ensureUser(OPENID);
      const add = settings.checkinPoints;

      // 补签限额用 users 上的计数器在事务内增减；首次/跨日先按库表实际次数播种，避免与历史记录脱节
      if (isMakeup) {
        const needSeed =
          ensuredUser.makeupMonthKey !== currentMonthKey ||
          ensuredUser.makeupDayKey !== todayKey ||
          typeof ensuredUser.makeupMonthCount !== 'number' ||
          typeof ensuredUser.makeupDayCount !== 'number';
        if (needSeed) {
          const monthUsed = await countMakeupInMonth(OPENID, currentMonthKey);
          const dayUsed = await countMakeupOnDay(OPENID, todayKey);
          try {
            await userRef.update({
              data: {
                makeupDayKey: todayKey,
                makeupDayCount: dayUsed,
                makeupMonthKey: currentMonthKey,
                makeupMonthCount: monthUsed,
                updatedAt: db.serverDate(),
              },
            });
          } catch (e) {
            /* ignore */
          }
        }
      }

      const payload = {
        openid: OPENID,
        dateKey: requestDate,
        monthKey: targetMonthKey,
        points: add,
        isMakeup,
        makeupOnDateKey: isMakeup ? todayKey : '',
        createdAt: db.serverDate(),
      };

      // 事务：签到文档 create + 积分 inc（及补签计数）同提交，防并发双发 / 写签到后积分失败
      // 微信云库事务用 transaction.collection().doc()，不是 Firestore 的 transaction.get(ref)
      let txResult;
      try {
        txResult = await dbTx.runTransaction(async (transaction) => {
          const checkSnap = await transaction
            .collection('user_checkins')
            .doc(docId)
            .get();
          if (checkSnap && checkSnap.data && checkSnap.data.openid) {
            return { already: true };
          }

          const userSnap = await transaction.collection('users').doc(OPENID).get();
          const user = (userSnap && userSnap.data) || null;
          if (!user) {
            const err = new Error('请先登录后再签到');
            err.code = 'NO_USER';
            throw err;
          }

          const userPatch = {
            points: _.inc(add),
            lastCheckinAt: db.serverDate(),
            updatedAt: db.serverDate(),
          };

          if (isMakeup) {
            const dayCount =
              user.makeupDayKey === todayKey
                ? Math.max(0, Number(user.makeupDayCount) || 0)
                : 0;
            const monthCount =
              user.makeupMonthKey === currentMonthKey
                ? Math.max(0, Number(user.makeupMonthCount) || 0)
                : 0;
            if (dayCount >= MAKEUP_MAX_PER_DAY) {
              const err = new Error(
                `今天已补签 ${MAKEUP_MAX_PER_DAY} 次，明天再来吧`,
              );
              err.code = 'MAKEUP_DAY_LIMIT';
              throw err;
            }
            if (monthCount >= MAKEUP_MAX_PER_MONTH) {
              const err = new Error(
                `本月补签已达上限（${MAKEUP_MAX_PER_MONTH} 次）`,
              );
              err.code = 'MAKEUP_MONTH_LIMIT';
              throw err;
            }
            userPatch.makeupDayKey = todayKey;
            userPatch.makeupDayCount = dayCount + 1;
            userPatch.makeupMonthKey = currentMonthKey;
            userPatch.makeupMonthCount = monthCount + 1;
          }

          await transaction.collection('user_checkins').doc(docId).set({
            data: payload,
          });
          await transaction.collection('users').doc(OPENID).update({
            data: userPatch,
          });
          return {
            already: false,
            pointsAfter: Math.max(0, Number(user.points) || 0) + add,
          };
        });
      } catch (err) {
        if (isCollectionMissing(err)) {
          await ensureCollection('user_checkins');
          return {
            ok: false,
            code: 'DB_FAIL',
            message:
              '签到表未就绪：请在云开发控制台「数据库」新建集合 user_checkins 后重试',
          };
        }
        const code = err && err.code;
        if (
          code === 'MAKEUP_DAY_LIMIT' ||
          code === 'MAKEUP_MONTH_LIMIT' ||
          code === 'NO_USER'
        ) {
          return {
            ok: false,
            code,
            message: (err && err.message) || '签到失败',
          };
        }
        throw err;
      }

      if (txResult && txResult.already) {
        return {
          ok: false,
          code: 'ALREADY',
          message: isMakeup ? '这一天已经签过啦' : '今天已经签过到啦',
        };
      }

      let fresh = { _id: OPENID, points: (txResult && txResult.pointsAfter) || 0 };
      try {
        const snap = await userRef.get();
        fresh = { _id: OPENID, ...(snap.data || {}) };
      } catch (err) {
        /* keep tx pointsAfter */
      }

      if (add > 0) {
        await recordPointsLog(db, {
          openid: OPENID,
          delta: add,
          balance: Math.max(0, Number(fresh.points) || 0),
          reason: isMakeup ? 'makeup' : 'checkin',
          title: isMakeup ? '补签' : '每日签到',
          meta: { dateKey: requestDate, isMakeup: !!isMakeup },
        });
      }

      const statusMonthKey = parseMonthKey(event.monthKey || targetMonthKey);
      const rows = await loadMonthRows(OPENID, statusMonthKey);
      const currentMonthRows =
        statusMonthKey === currentMonthKey
          ? rows
          : await loadMonthRows(OPENID, currentMonthKey);
      const makeupUsedToday = await countMakeupOnDay(OPENID, todayKey);
      const makeupUsedMonth = await countMakeupInMonth(OPENID, currentMonthKey);
      const status = buildStatusPayload({
        monthKey: statusMonthKey,
        todayKey,
        settings,
        rows,
        currentMonthRows,
        points: Math.max(0, Number(fresh.points) || 0),
        makeupUsedToday,
        makeupUsedMonth,
      });

      return {
        ok: true,
        message: isMakeup
          ? `补签成功，+${add} 积分`
          : `签到成功，+${add} 积分`,
        data: {
          ...status,
          added: add,
          dateKey: requestDate,
          isMakeup,
          entitlement: buildEntitlement(fresh),
        },
      };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'FAIL',
      message: (e && e.message) || '签到失败',
    };
  }
};
