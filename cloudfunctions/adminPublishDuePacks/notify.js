const { formatDateTimeCn } = require('./time');
const { normalizeContentType, contentTypeLabel } = require('./contentType');

const TEMPLATE_ID =
  process.env.SUBSCRIBE_NEW_PACK_TMPL_ID ||
  '-H790OjrQ4Ax5VxJvfahp-eY3D_2CJbpa-f0kKy5BPM';

function clipThing(s, fallback = '新合集') {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return fallback;
  return t.length > 20 ? `${t.slice(0, 19)}…` : t;
}

function resolveMpState() {
  const fromEnv = String(process.env.SUBSCRIBE_MP_STATE || '').trim();
  if (fromEnv === 'developer' || fromEnv === 'trial' || fromEnv === 'formal') {
    return fromEnv;
  }
  return 'formal';
}

/**
 * 定时上架后推送订阅消息（与 notifyNewPack 逻辑对齐）。
 */
async function sendNewPackNotify(cloud, db, pack) {
  const _ = db.command;
  const packId = pack && pack._id;
  if (!packId) return { sent: 0, skipped: 0, total: 0, lastError: 'NO_PACK' };

  const title = String(pack.title || '').trim();
  if (!title) return { sent: 0, skipped: 0, total: 0, lastError: 'NO_TITLE' };

  const contentType = normalizeContentType(pack.contentType);
  const categoryName = String(pack.categoryName || '').trim();
  const description = String(pack.description || '').trim();
  const emojiCount = Number(pack.emojiCount) || 0;
  const typeName = contentTypeLabel(contentType);
  const typeFallback = `${typeName}合集`;
  const page = `pages/pack/detail/index?id=${packId}`;
  const countHint = emojiCount
    ? contentType === 'video'
      ? `共 ${emojiCount} 个视频`
      : contentType === 'avatar'
        ? `共 ${emojiCount} 个头像`
        : `共 ${emojiCount} 张`
    : '';
  const intro = description || countHint || `${typeFallback}已上线，快来看看`;
  const mpState = resolveMpState();

  const data = {
    thing1: { value: clipThing(title, '新合集') },
    thing2: { value: clipThing(categoryName || typeFallback, typeFallback) },
    time3: { value: formatDateTimeCn() },
    thing4: { value: clipThing(intro, '新合集已上线') },
  };

  const listRes = await db
    .collection('users')
    .where({ newPackNotifyCredits: _.gt(0) })
    .limit(100)
    .get();
  const users = listRes.data || [];
  if (!users.length) {
    return { sent: 0, skipped: 0, total: 0, lastError: '' };
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
      await db.collection('users').doc(openid).update({
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
      console.warn('[adminPublishDuePacks] notify fail', openid, lastError);
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

  if (sent > 0) {
    try {
      await db.collection('packs').doc(packId).update({
        data: {
          notifiedAt: Date.now(),
          updatedAt: db.serverDate(),
        },
      });
    } catch (markErr) {
      console.warn('[adminPublishDuePacks] mark notifiedAt', markErr.message || markErr);
    }
  }

  return { sent, skipped, total: users.length, lastError };
}

module.exports = { sendNewPackNotify };
