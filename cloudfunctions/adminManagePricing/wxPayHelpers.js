/**
 * 虚拟支付 xpay 签名与 HTTPS（upload/publish 不支持云调用）
 */
const crypto = require('crypto');
const https = require('https');

const APPID = process.env.WX_APPID || 'wxc53da678dce0b8d1';
const PAY_ENV = Number(process.env.VIRTUAL_PAY_ENV != null ? process.env.VIRTUAL_PAY_ENV : 0);

function getAppKey() {
  const key =
    PAY_ENV === 1
      ? String(process.env.VIRTUAL_PAY_APPKEY_SANDBOX || '').trim()
      : String(process.env.VIRTUAL_PAY_APPKEY || '').trim();
  if (!key) {
    throw new Error(
      PAY_ENV === 1
        ? '未配置环境变量 VIRTUAL_PAY_APPKEY_SANDBOX'
        : '未配置环境变量 VIRTUAL_PAY_APPKEY',
    );
  }
  return key;
}

function hmacSha256Hex(key, message) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

function stableStringify(obj) {
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function calcPaySig(uri, postBody, appKey) {
  return hmacSha256Hex(appKey, `${uri}&${postBody}`);
}

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

function httpsPostJson(url, bodyObj) {
  const body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw), raw });
          } catch (e) {
            reject(new Error(`解析失败: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken(cloud) {
  try {
    if (cloud && cloud.openapi && typeof cloud.openapi.getAccessToken === 'function') {
      const r = await cloud.openapi.getAccessToken({});
      const token = r.accessToken || r.access_token;
      if (token) return token;
    }
  } catch (e) {
    console.warn('openapi getAccessToken', e.message || e);
  }

  const ctx = cloud.getWXContext ? cloud.getWXContext() : {};
  if (ctx.ACCESS_TOKEN) return ctx.ACCESS_TOKEN;

  const secret = process.env.WX_APP_SECRET || '';
  if (!secret) throw new Error('缺少 access_token：请配置 WX_APP_SECRET');
  const url =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(APPID)}&secret=${encodeURIComponent(secret)}`;
  const data = await httpsGet(url);
  if (data.errcode) throw new Error(data.errmsg || `token 失败 ${data.errcode}`);
  return data.access_token;
}

async function xpayPost(cloud, path, bodyObj) {
  const appKey = getAppKey();
  if (!appKey) throw new Error('未配置 VIRTUAL_PAY_APPKEY');
  const token = await getAccessToken(cloud);
  const postBody = stableStringify(bodyObj);
  const paySig = calcPaySig(path, postBody, appKey);
  const url =
    `https://api.weixin.qq.com${path}?access_token=${encodeURIComponent(token)}` +
    `&pay_sig=${encodeURIComponent(paySig)}`;
  const res = await httpsPostJson(url, postBody);
  const data = res.data || {};
  if (data.errcode && data.errcode !== 0) {
    const err = new Error(data.errmsg || `xpay ${path} 失败 ${data.errcode}`);
    err.errcode = data.errcode;
    err.data = data;
    throw err;
  }
  return data;
}

async function resolveItemUrl(cloud, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('缺少道具图，请先上传');
  const r = await cloud.getTempFileURL({ fileList: [id] });
  const list = (r && r.fileList) || [];
  const hit = list.find((f) => f.fileID === id) || list[0];
  const url = hit && (hit.tempFileURL || hit.tempFileUrl);
  if (!url) {
    const msg = (hit && hit.errMsg) || '无法获取道具图链接';
    throw new Error(msg);
  }
  return url;
}

async function uploadGoods(cloud, { id, name, price, remark, itemUrl }) {
  return xpayPost(cloud, '/xpay/start_upload_goods', {
    env: PAY_ENV,
    upload_item: [
      {
        id: String(id),
        name: String(name).slice(0, 20),
        price: Number(price),
        remark: String(remark || name || id).slice(0, 1024),
        item_url: String(itemUrl),
      },
    ],
  });
}

async function publishGoods(cloud, { id }) {
  return xpayPost(cloud, '/xpay/start_publish_goods', {
    env: PAY_ENV,
    publish_item: [{ id: String(id) }],
  });
}

async function queryUploadGoods(cloud) {
  return xpayPost(cloud, '/xpay/query_upload_goods', { env: PAY_ENV });
}

async function queryPublishGoods(cloud) {
  return xpayPost(cloud, '/xpay/query_publish_goods', { env: PAY_ENV });
}

module.exports = {
  APPID,
  PAY_ENV,
  getAppKey,
  getAccessToken,
  resolveItemUrl,
  uploadGoods,
  publishGoods,
  queryUploadGoods,
  queryPublishGoods,
};
