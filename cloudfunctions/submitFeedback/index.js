const cloud = require('wx-server-sdk');
const { toMs, formatDateTimeCn } = require('./time');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'feedback';
const MAX_LEN = 500;
const MIN_LEN = 2;

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

const TEMPLATE_ID =
  process.env.SUBSCRIBE_FEEDBACK_TMPL_ID ||
  'jYzc2X5SfzI89vwnNVGU00v3x4poeZhl9KIkiOaBvm4';

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

/** thing 类字段最多 20 字 */
function clipThing(s, fallback = '-') {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return fallback;
  return t.length > 20 ? `${t.slice(0, 19)}…` : t;
}

/** name 类字段最多约 10 字（微信限制） */
function clipName(s, fallback = '用户') {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return fallback;
  return t.length > 10 ? `${t.slice(0, 9)}…` : t;
}

/**
 * 向有额度的管理员推送反馈订阅消息；失败不影响用户提交结果
 * 模板「留言通知」：name1 留言人 / thing2 留言内容 / time3 留言时间
 */
async function notifyAdmins({ content, contact, feedbackId, fromName }) {
  const tmplId = TEMPLATE_ID;
  if (!tmplId) {
    console.warn('[submitFeedback] 未配置 SUBSCRIBE_FEEDBACK_TMPL_ID / 模板 ID，跳过推送');
    return { sent: 0, skipped: 0, reason: 'NO_TMPL' };
  }

  const admins = getAdminList();
  if (!admins.length) {
    return { sent: 0, skipped: 0, reason: 'NO_ADMIN' };
  }

  let list = [];
  try {
    const listRes = await db
      .collection('users')
      .where({
        feedbackNotifyCredits: _.gt(0),
        _id: _.in(admins),
      })
      .limit(20)
      .get();
    list = listRes.data || [];
  } catch (e) {
    // 无复合查询条件时退化：按额度查再过滤管理员
    try {
      const listRes = await db
        .collection('users')
        .where({ feedbackNotifyCredits: _.gt(0) })
        .limit(50)
        .get();
      list = (listRes.data || []).filter((u) => {
        const id = u._id || u.openid;
        return admins.indexOf(id) >= 0;
      });
    } catch (e2) {
      console.warn('[submitFeedback] list admins fail', e2.message);
      return { sent: 0, skipped: 0, reason: 'LIST_FAIL' };
    }
  }

  if (!list.length) {
    return { sent: 0, skipped: 0, reason: 'NO_CREDITS' };
  }

  const data = {
    name1: { value: clipName(fromName || contact || '匿名用户', '匿名用户') },
    thing2: { value: clipThing(content, '新反馈') },
    time3: { value: formatDateTimeCn() },
  };
  const page = 'pages/my/index';

  let sent = 0;
  let skipped = 0;

  for (let i = 0; i < list.length; i += 1) {
    const user = list[i];
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
        templateId: tmplId,
        page,
        lang: 'zh_CN',
        miniprogramState: 'formal',
        data,
      });
      const credits = Math.max(0, Number(user.feedbackNotifyCredits) || 0);
      // eslint-disable-next-line no-await-in-loop
      await db
        .collection('users')
        .doc(openid)
        .update({
          data: {
            feedbackNotifyCredits: Math.max(0, credits - 1),
            updatedAt: db.serverDate(),
          },
        });
      sent += 1;
    } catch (err) {
      skipped += 1;
      console.warn(
        '[submitFeedback] send fail',
        openid,
        feedbackId,
        err.errCode || err.message,
      );
    }
  }

  return { sent, skipped, total: list.length };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  if (!openid) {
    return { ok: false, code: 'NO_OPENID', message: '未登录' };
  }

  const content = String((event && event.content) || '')
    .replace(/\s+/g, ' ')
    .trim();
  const contact = String((event && event.contact) || '').trim().slice(0, 64);

  if (content.length < MIN_LEN) {
    return { ok: false, code: 'TOO_SHORT', message: '请多写一点建议' };
  }
  if (content.length > MAX_LEN) {
    return { ok: false, code: 'TOO_LONG', message: `建议请控制在 ${MAX_LEN} 字以内` };
  }

  // 简单防刷：同一用户 30 秒内只能提交一次
  try {
    const recent = await db
      .collection(COLLECTION)
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const last = (recent.data && recent.data[0]) || null;
    if (last && last.createdAt) {
      const t = toMs(last.createdAt);
      if (t && Date.now() - t < 30 * 1000) {
        return { ok: false, code: 'TOO_FAST', message: '提交太频繁，稍后再试' };
      }
    }
  } catch (e) {
    // 集合不存在或无索引时忽略限流，继续写入
  }

  const now = db.serverDate();
  const doc = {
    openid,
    content,
    contact,
    status: 'new',
    createdAt: now,
    updatedAt: now,
  };

  try {
    const addRes = await db.collection(COLLECTION).add({ data: doc });
    const feedbackId = addRes._id;

    let notify = { sent: 0, skipped: 0 };
    try {
      let fromName = '';
      try {
        const u = await db.collection('users').doc(openid).get();
        fromName = (u.data && (u.data.nickName || u.data.nickname)) || '';
      } catch (e) {
        /* ignore */
      }
      notify = await notifyAdmins({
        content,
        contact,
        feedbackId,
        fromName: fromName || contact || '',
      });
    } catch (e) {
      console.warn('[submitFeedback] notify error', e.message);
    }

    return { ok: true, id: feedbackId, notify };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/COLLECTION_NOT_EXIST|not exist/i.test(msg)) {
      return {
        ok: false,
        code: 'NO_COLLECTION',
        message: '请先在云开发控制台创建 feedback 集合',
      };
    }
    return { ok: false, code: 'DB_FAIL', message: msg || '提交失败' };
  }
};
