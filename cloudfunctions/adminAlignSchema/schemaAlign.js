/**
 * 云库结构对齐（可扩展）
 *
 * 代码里的 create/update 会写新字段，但线上旧文档可能缺字段或取值不合规。
 * 管理端「对齐云库结构」会跑这里登记的全部 aligner，把线上数据/索引拉齐到当前 schema。
 *
 * ——— 以后扩展字段时 ———
 * 1. 业务写入（adminCreatePack / login / …）加上新字段
 * 2. 在本文件 ALIGNERS 里追加或改对应 aligner（defaults / alignDoc / align）
 * 3. SCHEMA_VERSION + 1（方便结果里对照「当前代码版本」）
 * 4. 部署本云函数，点管理端按钮即可；可重复执行，已对齐的不会改坏
 *
 * aligner 形态：
 * - kind: 'collection' → 扫集合，alignDoc(doc, ctx) => { patch, fields } | null
 * - kind: 'config'     → 单次配置对齐，align(db, ctx) => { patched, detail }
 * - kind: 'indexes'    → 幂等补复合索引（dbIndexes.js），align(db, ctx) => { patched, detail }
 */

const {
  CONTENT_TYPES,
  normalizeContentType,
  isEmojiType,
} = require('./contentType');
const { repairPointsConfig } = require('./pointsSettings');
const {
  PACK_INDEXES,
  ensurePackIndexes,
  summarizeIndexResults,
} = require('./dbIndexes');

/** 当前代码期望的云库结构版本；加字段/规则时 +1 */
const SCHEMA_VERSION = 2;

function asString(v) {
  return v == null ? '' : String(v);
}

function asNonNegInt(v) {
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.floor(n);
}

function sameStringArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (String(a[i] || '') !== String(b[i] || '')) return false;
  }
  return true;
}

/**
 * 缺字段则写入默认值；可选校验非法值。
 * @param {(v:any)=>boolean} [isValid] 返回 false 时用 defaultValue 覆盖
 */
function ensureField(doc, patch, fields, key, defaultValue, isValid) {
  const missing = doc[key] === undefined || doc[key] === null;
  if (missing) {
    patch[key] = typeof defaultValue === 'function' ? defaultValue(doc, patch) : defaultValue;
    fields.push(key);
    return;
  }
  if (typeof isValid === 'function' && !isValid(doc[key], doc, patch)) {
    patch[key] = typeof defaultValue === 'function' ? defaultValue(doc, patch) : defaultValue;
    fields.push(key);
  }
}

function ensureStringArray(doc, patch, fields, key) {
  if (!Array.isArray(doc[key])) {
    patch[key] = [];
    fields.push(key);
  }
}

/**
 * 合集文档：与 adminCreatePack / adminUpdatePack 当前写入字段对齐。
 * 后续新字段：在此补 ensureField / 派生字段同步即可。
 */
function alignPackDoc(doc, ctx) {
  if (!doc || !doc._id) return null;
  const patch = {};
  const fields = [];
  const { serverDate } = ctx;

  const contentType = normalizeContentType(doc.contentType);
  ensureField(
    doc,
    patch,
    fields,
    'contentType',
    'emoji',
    (v) => CONTENT_TYPES.includes(String(v || '').trim()),
  );

  ensureStringArray(doc, patch, fields, 'emojiFileIDs');
  ensureStringArray(doc, patch, fields, 'previewFileIDs');
  ensureStringArray(doc, patch, fields, 'pairKeys');

  const emojiFileIDs = Array.isArray(patch.emojiFileIDs)
    ? patch.emojiFileIDs
    : (Array.isArray(doc.emojiFileIDs) ? doc.emojiFileIDs : [])
        .filter(Boolean)
        .map(String);

  const type = patch.contentType || contentType;
  let emojiAnimFileIDs;
  if (isEmojiType(type)) {
    const rawAnim = Array.isArray(doc.emojiAnimFileIDs) ? doc.emojiAnimFileIDs : [];
    emojiAnimFileIDs = emojiFileIDs.map((_, i) =>
      rawAnim[i] ? String(rawAnim[i]) : '',
    );
  } else {
    emojiAnimFileIDs = emojiFileIDs.map(() => '');
  }
  if (
    !Array.isArray(doc.emojiAnimFileIDs) ||
    doc.emojiAnimFileIDs.length !== emojiFileIDs.length ||
    (isEmojiType(type) && !sameStringArray(doc.emojiAnimFileIDs, emojiAnimFileIDs))
  ) {
    if (
      isEmojiType(type) ||
      !Array.isArray(doc.emojiAnimFileIDs) ||
      doc.emojiAnimFileIDs.length !== emojiFileIDs.length
    ) {
      patch.emojiAnimFileIDs = emojiAnimFileIDs;
      fields.push('emojiAnimFileIDs');
    }
  }

  ensureField(doc, patch, fields, 'previewVideoFileID', '');
  ensureField(doc, patch, fields, 'description', '');
  ensureField(doc, patch, fields, 'categoryId', '');
  ensureField(doc, patch, fields, 'categoryName', '');
  ensureField(doc, patch, fields, 'staticDriveUrl', '');
  ensureField(doc, patch, fields, 'animDriveUrl', '');
  if (
    !isEmojiType(type) &&
    asString(patch.animDriveUrl != null ? patch.animDriveUrl : doc.animDriveUrl)
  ) {
    patch.animDriveUrl = '';
    if (!fields.includes('animDriveUrl')) fields.push('animDriveUrl');
  }

  ensureField(
    doc,
    patch,
    fields,
    'coverWidth',
    0,
    (v) => !Number.isNaN(Number(v)) && Number(v) >= 0,
  );
  ensureField(
    doc,
    patch,
    fields,
    'coverHeight',
    0,
    (v) => !Number.isNaN(Number(v)) && Number(v) >= 0,
  );
  ensureField(
    doc,
    patch,
    fields,
    'downloadCount',
    0,
    (v) => !Number.isNaN(Number(v)) && Number(v) >= 0,
  );
  ensureField(
    doc,
    patch,
    fields,
    'status',
    'published',
    (v) => {
      const s = asString(v).trim();
      return s === 'draft' || s === 'published';
    },
  );

  const previewFileIDs = Array.isArray(patch.previewFileIDs)
    ? patch.previewFileIDs
    : (Array.isArray(doc.previewFileIDs) ? doc.previewFileIDs : [])
        .filter(Boolean)
        .map(String);
  const previewVideoFileID =
    patch.previewVideoFileID != null
      ? patch.previewVideoFileID
      : asString(doc.previewVideoFileID).trim();
  const expectPreviewCount =
    previewFileIDs.length + (previewVideoFileID ? 1 : 0);
  if (asNonNegInt(doc.previewCount) !== expectPreviewCount) {
    patch.previewCount = expectPreviewCount;
    fields.push('previewCount');
  }
  if (asNonNegInt(doc.emojiCount) !== emojiFileIDs.length) {
    patch.emojiCount = emojiFileIDs.length;
    fields.push('emojiCount');
  }

  if (!fields.length) return null;
  patch.updatedAt = serverDate();
  patch.schemaAlignedAt = serverDate();
  patch.schemaVersion = SCHEMA_VERSION;
  return { patch, fields };
}

/**
 * 在此登记所有需要对齐的目标。
 * 新增集合 / 配置时往数组 push 一项即可。
 */
const ALIGNERS = [
  {
    id: 'packs',
    kind: 'collection',
    collection: 'packs',
    label: '合集 packs',
    description:
      'contentType、文件数组、计数、网盘、封面尺寸、status 等与当前上传 schema 对齐',
    alignDoc: alignPackDoc,
  },
  {
    id: 'app_config.points',
    kind: 'config',
    label: '积分配置 app_config/points',
    description: '见面礼/签到/广告/保存单价等缺项写入默认值',
    async align(db, ctx) {
      return repairPointsConfig(db, {
        dryRun: ctx.dryRun,
        openid: ctx.openid,
      });
    },
  },
  {
    id: 'packs.indexes',
    kind: 'indexes',
    collection: 'packs',
    label: '合集索引 packs',
    description:
      '热门/最新列表复合索引（status + downloadCount / categoryId / contentType 等），幂等创建',
    async align(_db, ctx) {
      const planned = PACK_INDEXES.map((x) => x.name);
      if (ctx.dryRun) {
        // 扫描阶段不调开放接口；真正写入时再幂等 ensure
        return {
          patched: false,
          missingKeys: [],
          detail: {
            mode: 'ensure_on_apply',
            planned,
            count: planned.length,
          },
        };
      }
      const list = await ensurePackIndexes(ctx.cloud);
      const sum = summarizeIndexResults(list);
      const failed = list.filter((x) => x.status === 'failed');
      return {
        // 有新建或失败都算「触及」，方便摘要展示
        patched: sum.created > 0 || sum.failed > 0,
        missingKeys: failed.map((x) => x.name),
        detail: {
          mode: 'ensure',
          planned,
          results: list,
          ...sum,
        },
      };
    },
  },
  // —— 以后在这里追加，例如：
  // {
  //   id: 'users.xxx',
  //   kind: 'collection',
  //   collection: 'users',
  //   label: '用户',
  //   description: '…',
  //   alignDoc(doc, ctx) { … },
  // },
];

function listAligners() {
  return ALIGNERS.map((a) => ({
    id: a.id,
    kind: a.kind,
    collection: a.collection || '',
    label: a.label,
    description: a.description,
  }));
}

module.exports = {
  SCHEMA_VERSION,
  ALIGNERS,
  listAligners,
  ensureField,
  ensureStringArray,
  asString,
  asNonNegInt,
};
