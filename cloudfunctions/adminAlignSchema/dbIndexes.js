/**
 * 云库复合索引：管理端对齐时幂等补齐（走 tcb/updateindex）。
 * 已存在的索引会记为 skipped，避免去控制台手工点。
 */
const https = require('https');

const APPID = process.env.WX_APPID || 'wxc53da678dce0b8d1';

/** packs：热门/最新列表常用 where + orderBy */
const PACK_INDEXES = [
  {
    name: 'status_downloadCount',
    unique: false,
    keys: [
      { name: 'status', direction: '1' },
      { name: 'downloadCount', direction: '-1' },
    ],
  },
  {
    name: 'status_categoryId_downloadCount',
    unique: false,
    keys: [
      { name: 'status', direction: '1' },
      { name: 'categoryId', direction: '1' },
      { name: 'downloadCount', direction: '-1' },
    ],
  },
  {
    name: 'status_contentType_downloadCount',
    unique: false,
    keys: [
      { name: 'status', direction: '1' },
      { name: 'contentType', direction: '1' },
      { name: 'downloadCount', direction: '-1' },
    ],
  },
  {
    name: 'status_categoryId_contentType_downloadCount',
    unique: false,
    keys: [
      { name: 'status', direction: '1' },
      { name: 'categoryId', direction: '1' },
      { name: 'contentType', direction: '1' },
      { name: 'downloadCount', direction: '-1' },
    ],
  },
  // 最新列表（若控制台已有同名会跳过）
  {
    name: 'status_createdAt',
    unique: false,
    keys: [
      { name: 'status', direction: '1' },
      { name: 'createdAt', direction: '-1' },
    ],
  },
  {
    name: 'status_categoryId_createdAt',
    unique: false,
    keys: [
      { name: 'status', direction: '1' },
      { name: 'categoryId', direction: '1' },
      { name: 'createdAt', direction: '-1' },
    ],
  },
  {
    name: 'status_contentType_createdAt',
    unique: false,
    keys: [
      { name: 'status', direction: '1' },
      { name: 'contentType', direction: '1' },
      { name: 'createdAt', direction: '-1' },
    ],
  },
];

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
  const body = JSON.stringify(bodyObj);
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
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function resolveEnvId(cloud) {
  try {
    const ctx = cloud.getWXContext ? cloud.getWXContext() : {};
    if (ctx.ENV) return ctx.ENV;
  } catch (e) {
    /* ignore */
  }
  return (
    process.env.TCB_ENV ||
    process.env.SCF_NAMESPACE ||
    process.env.WX_CLOUD_ENV ||
    ''
  );
}

async function getAccessToken(cloud) {
  try {
    if (cloud && cloud.openapi && typeof cloud.openapi.getAccessToken === 'function') {
      const r = await cloud.openapi.getAccessToken({});
      const token = r.accessToken || r.access_token;
      if (token) return token;
    }
  } catch (e) {
    console.warn('[dbIndexes] openapi getAccessToken', e.message || e);
  }
  try {
    const ctx = cloud.getWXContext ? cloud.getWXContext() : {};
    if (ctx.ACCESS_TOKEN) return ctx.ACCESS_TOKEN;
  } catch (e) {
    /* ignore */
  }
  const secret = String(process.env.WX_APP_SECRET || '').trim();
  if (!secret) {
    throw new Error(
      '无法获取 access_token：请在云函数开通 openapi，或配置环境变量 WX_APP_SECRET',
    );
  }
  const url =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(APPID)}&secret=${encodeURIComponent(secret)}`;
  const data = await httpsGet(url);
  if (data.errcode) {
    throw new Error(data.errmsg || `token 失败 ${data.errcode}`);
  }
  return data.access_token;
}

function isAlreadyExistsError(data) {
  const code = Number(data && data.errcode);
  const msg = String((data && data.errmsg) || '').toLowerCase();
  if (code === 0) return false;
  // 常见：索引名冲突 / 已存在
  if (
    /exist|already|重复|已存在|冲突/.test(msg) ||
    code === -501001 ||
    code === 101001 ||
    code === -501002
  ) {
    return true;
  }
  return false;
}

async function createCollectionIndexes(cloud, { env, collectionName, indexes }) {
  const token = await getAccessToken(cloud);
  const url = `https://api.weixin.qq.com/tcb/updateindex?access_token=${encodeURIComponent(token)}`;
  const res = await httpsPostJson(url, {
    env,
    collection_name: collectionName,
    create_indexes: indexes,
    drop_indexes: [],
  });
  return res.data || {};
}

/**
 * 逐个创建，便于部分已存在时继续补剩余的。
 * @returns {{ name: string, status: 'created'|'skipped'|'failed', message?: string }[]}
 */
async function ensurePackIndexes(cloud) {
  const env = resolveEnvId(cloud);
  if (!env) {
    throw new Error('无法解析云环境 ID（ENV）');
  }
  const out = [];
  for (let i = 0; i < PACK_INDEXES.length; i += 1) {
    const index = PACK_INDEXES[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = await createCollectionIndexes(cloud, {
        env,
        collectionName: 'packs',
        indexes: [index],
      });
      const code = Number(data.errcode);
      if (!code) {
        out.push({ name: index.name, status: 'created' });
      } else if (isAlreadyExistsError(data)) {
        out.push({ name: index.name, status: 'skipped', message: data.errmsg || '已存在' });
      } else {
        out.push({
          name: index.name,
          status: 'failed',
          message: data.errmsg || `errcode ${data.errcode}`,
        });
      }
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (isAlreadyExistsError({ errmsg: msg })) {
        out.push({ name: index.name, status: 'skipped', message: msg });
      } else {
        out.push({ name: index.name, status: 'failed', message: msg });
      }
    }
  }
  return out;
}

function summarizeIndexResults(list) {
  const created = list.filter((x) => x.status === 'created').length;
  const skipped = list.filter((x) => x.status === 'skipped').length;
  const failed = list.filter((x) => x.status === 'failed').length;
  return { created, skipped, failed, total: list.length };
}

module.exports = {
  PACK_INDEXES,
  ensurePackIndexes,
  summarizeIndexResults,
};
