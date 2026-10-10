const cloud = require('wx-server-sdk');
const { formatDateTime } = require('./time');

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

    const data = {
      thing1: { value: clipThing(title, '新合集') },
      thing2: { value: clipThing(categoryName, '合集') },
      time3: { value: formatDateTime() },
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
          miniprogramState: 'formal',
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
        console.warn('[notifyNewPack] send fail', openid, err.errCode || err.message);
      }
    }

    return { ok: true, data: { sent, skipped, total: users.length } };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'NOTIFY_FAIL', message: e.message || '通知失败' };
  }
};
