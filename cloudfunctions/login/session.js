const https = require('https');

const APPID = process.env.WX_APPID || 'wxc53da678dce0b8d1';
/** session_key 本地缓存时长（毫秒），到期后购买前会重新 wx.login */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`解析失败: ${raw.slice(0, 200)}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * jsCode → session_key
 * 优先云调用 openapi，失败再用 WX_APP_SECRET
 */
async function code2Session(jsCode, cloud) {
  if (!jsCode) throw new Error('缺少登录 code');

  try {
    if (cloud && cloud.openapi && cloud.openapi.auth && cloud.openapi.auth.code2Session) {
      const r = await cloud.openapi.auth.code2Session({ jsCode });
      const sessionKey = r.sessionKey || r.session_key;
      if (sessionKey) {
        return { sessionKey, openid: r.openid || r.openId || '' };
      }
    }
  } catch (e) {
    console.warn('openapi code2Session', e.message || e);
  }

  const secret = process.env.WX_APP_SECRET || '';
  if (!secret) {
    throw new Error(
      '无法获取 session_key：请在云开发控制台为云函数配置环境变量 WX_APP_SECRET（小程序 AppSecret）'
    );
  }
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(APPID)}` +
    `&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(jsCode)}&grant_type=authorization_code`;
  const data = await httpsGet(url);
  if (data.errcode) {
    throw new Error(data.errmsg || `code2Session 失败 ${data.errcode}`);
  }
  if (!data.session_key) throw new Error('code2Session 未返回 session_key');
  return { sessionKey: data.session_key, openid: data.openid || '' };
}

async function saveSessionKey(db, openid, sessionKey) {
  if (!openid || !sessionKey) return;
  const ref = db.collection('users').doc(openid);
  const patch = {
    sessionKey,
    sessionKeyAt: Date.now(),
    updatedAt: db.serverDate(),
  };
  try {
    await ref.update({ data: patch });
  } catch (e) {
    // 不 set 建档：避免 points:0 覆盖/抢走 login 见面礼
    console.warn('saveSessionKey update skip', e.message || e);
  }
}

async function loadSessionKey(db, openid) {
  if (!openid) return '';
  try {
    const snap = await db.collection('users').doc(openid).get();
    const u = snap.data || {};
    const at = Number(u.sessionKeyAt) || 0;
    if (u.sessionKey && at && Date.now() - at < SESSION_TTL_MS) {
      return String(u.sessionKey);
    }
  } catch (e) {
    /* ignore */
  }
  return '';
}

/**
 * 购买签名用：优先用本次 code，否则用缓存的 session_key
 */
async function resolveSessionKey(db, cloud, openid, jsCode) {
  if (jsCode) {
    const { sessionKey } = await code2Session(jsCode, cloud);
    await saveSessionKey(db, openid, sessionKey);
    return sessionKey;
  }
  const cached = await loadSessionKey(db, openid);
  if (cached) return cached;
  throw new Error('登录态已失效，请重试购买');
}

module.exports = {
  SESSION_TTL_MS,
  code2Session,
  saveSessionKey,
  loadSessionKey,
  resolveSessionKey,
};
