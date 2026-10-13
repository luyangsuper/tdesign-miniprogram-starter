const cloud = require('wx-server-sdk');
const { formatDateTimeCn } = require('./time');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TEMPLATE_ID =
  process.env.SUBSCRIBE_NEW_PACK_TMPL_ID ||
  '-H790OjrQ4Ax5VxJvfahp-eY3D_2CJbpa-f0kKy5BPM';

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function assertAdmin(openid) {
  return getAdminList().includes(openid);
}

/** thing 类字段最多 20 字 */
function clipThing(s, fallback = '新合集') {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return fallback;
  return t.length > 20 ? `${t.slice(0, 19)}…` : t;
}

/** developer | trial | formal；与用户授权时所在版本一致，否则 43101 */
function resolveMpState(event) {
  const fromEvent = String((event && event.miniprogramState) || '').trim();
  if (
    fromEvent === 'developer' ||
    fromEvent === 'trial' ||
    fromEvent === 'formal'
  ) {
    return fromEvent;
  }
  const fromEnv = String(process.env.SUBSCRIBE_MP_STATE || '').trim();
  if (fromEnv === 'developer' || fromEnv === 'trial' || fromEnv === 'formal') {
    return fromEnv;
  }
  return 'formal';
}

/**
 * 新合集发布后推送订阅消息
 * event: { packId } 或 { title, categoryName, description, packId }
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  let title = String(event.title || '').trim();
  let categoryName = String(event.categoryName || '').trim();
  let description = String(event.description || '').trim();
  const packId = event.packId || event.id || '';
  const mpState = resolveMpState(event);

  try {
    if (packId && (!title || !categoryName)) {
      const doc = await db.collection('packs').doc(packId).get();
      const pack = doc.data;
      if (!pack) {
        return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };
      }
      title = title || pack.title || '';
      categoryName = categoryName || pack.categoryName || '';
      description = description || pack.description || '';
    }

    if (!title) {
      return { ok: false, code: 'BAD_PARAM', message: '缺少标题' };
    }

    const page = packId
      ? `pages/pack/detail/index?id=${packId}`
      : 'pages/home/index';
    const intro =
      description ||
      (event.emojiCount ? `共 ${event.emojiCount} 张` : '新合集已上线，快来看看');

    // time 类型须用「2019年10月1日 15:01」，YYYY-MM-DD 会被微信拒收（47003）
    const data = {
      thing1: { value: clipThing(title, '新合集') },
      thing2: { value: clipThing(categoryName, '合集') },
      time3: { value: formatDateTimeCn() },
      thing4: { value: clipThing(intro, '新合集已上线') },
    };

    // 有发送额度的用户（单次最多 100，够用先；后续可分页）
    const listRes = await db
      .collection('users')
      .where({ newPackNotifyCredits: _.gt(0) })
      .limit(100)
      .get();
    const users = listRes.data || [];
    if (!users.length) {
      return { ok: true, data: { sent: 0, skipped: 0, total: 0 } };
    }

    let sent = 0;
    let skipped = 0;
    let lastError = '';

    for (let i = 0; i < users.length; i += 1) {
      const user = users[i];
      const openid = user._id || user.openid;
      if (!openid) {
        skipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await cloud.openapi.subscribeMessage.send({
          touser: openid,
          templateId: TEMPLATE_ID,
          page,
          lang: 'zh_CN',
          miniprogramState: mpState,
          data,
        });
        const credits = Math.max(0, Number(user.newPackNotifyCredits) || 0);
        // eslint-disable-next-line no-await-in-loop
        await db
          .collection('users')
          .doc(openid)
          .update({
            data: {
              newPackNotifyCredits: Math.max(0, credits - 1),
              updatedAt: db.serverDate(),
            },
          });
        sent += 1;
      } catch (err) {
        skipped += 1;
        const code = err.errCode || err.code || '';
        lastError = String(code || err.message || 'send fail');
        console.warn('[notifyNewPack] send fail', openid, lastError, 'mpState=', mpState);
        // 43101：微信侧已无订阅，清掉本地虚额度，避免反复误报
        if (String(code) === '43101') {
          try {
            // eslint-disable-next-line no-await-in-loop
            await db.collection('users').doc(openid).update({
              data: {
                newPackNotifyCredits: 0,
                updatedAt: db.serverDate(),
              },
            });
          } catch (clearErr) {
            /* ignore */
          }
        }
      }
    }

    // 至少送达一人再记 notifiedAt，避免全失败却提示「已通知过」
    if (packId && sent > 0) {
      try {
        await db.collection('packs').doc(packId).update({
          data: {
            notifiedAt: Date.now(),
            updatedAt: db.serverDate(),
          },
        });
      } catch (markErr) {
        console.warn('[notifyNewPack] mark notifiedAt', markErr.message || markErr);
      }
    }

    return {
      ok: true,
      data: { sent, skipped, total: users.length, lastError },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'NOTIFY_FAIL', message: e.message || '通知失败' };
  }
};
