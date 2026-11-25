/**
 * 素材库导入（本机）
 *
 * 用法：
 *   node scripts/library-import/import.mjs --source animatemojis --in ./raw/animatemojis --dry
 *   node scripts/library-import/import.mjs --source animatemojis --in ./raw/animatemojis --prepare
 *
 * --dry      只解析，打印统计
 * --prepare  生成 out/animatemojis-batches.json（含本地路径），便于核对
 *
 * 完整上传到云存储 + 写库：
 *   需配置环境变量 TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY
 *   并 npm i @cloudbase/node-sdk（在 scripts/library-import 或项目根）
 *   node scripts/library-import/import.mjs --source animatemojis --in ./raw/animatemojis --upload
 *
 * 目录约定见 adapters/animatemojis.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseAnimateMojis } from './adapters/animatemojis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const out = {
    source: 'animatemojis',
    input: '',
    dry: false,
    prepare: false,
    upload: false,
    batchSize: 40,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') out.source = String(argv[++i] || 'animatemojis');
    else if (a === '--in') out.input = String(argv[++i] || '');
    else if (a === '--dry') out.dry = true;
    else if (a === '--prepare') out.prepare = true;
    else if (a === '--upload') out.upload = true;
    else if (a === '--batch-size') out.batchSize = Math.max(1, Number(argv[++i]) || 40);
  }
  return out;
}

function ensureParsed(source, inputDir) {
  if (source === 'animatemojis') return parseAnimateMojis(inputDir);
  throw new Error(`暂不支持的 source: ${source}`);
}

async function createCloudApp() {
  const env = process.env.TCB_ENV || process.env.CLOUDBASE_ENV || '';
  const secretId = process.env.TCB_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || '';
  const secretKey = process.env.TCB_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || '';
  if (!env || !secretId || !secretKey) {
    throw new Error(
      '缺少 TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY，无法 --upload。可先 --prepare 生成批次文件。',
    );
  }
  let tcb;
  try {
    tcb = await import('@cloudbase/node-sdk');
  } catch (e) {
    throw new Error('请先安装依赖：npm i @cloudbase/node-sdk');
  }
  const app = tcb.default.init({
    env,
    secretId,
    secretKey,
  });
  return app;
}

async function uploadLocalFile(app, localPath, cloudPath) {
  const result = await app.uploadFile({
    cloudPath,
    fileContent: fs.createReadStream(localPath),
  });
  return result.fileID || result.fileId || '';
}

async function callUpsert(app, data) {
  const res = await app.callFunction({
    name: 'adminUpsertLibrary',
    data,
  });
  const result = (res && res.result) || {};
  if (result.ok === false) {
    throw new Error(result.message || 'adminUpsertLibrary 失败');
  }
  return result.data;
}

async function runUpload(parsed, batchSize) {
  const app = await createCloudApp();
  console.log('[import] upsert source…');
  await callUpsert(app, {
    action: 'upsertSource',
    source: parsed.source,
  });
  console.log('[import] upsert groups…');
  await callUpsert(app, {
    action: 'upsertGroups',
    sourceId: parsed.source.id,
    groups: parsed.groups,
  });

  const items = parsed.items;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const prepared = [];
    for (const it of chunk) {
      const files = {};
      for (const [fmt, localPath] of Object.entries(it.localFiles || {})) {
        const cloudPath = `library/${parsed.source.id}/${it.externalKey}/${it.externalKey}.${fmt === 'lottie' ? 'json' : fmt}`;
        // eslint-disable-next-line no-await-in-loop
        const fileID = await uploadLocalFile(app, localPath, cloudPath);
        if (fileID) files[fmt] = fileID;
        console.log(`  uploaded ${it.externalKey}.${fmt}`);
      }
      prepared.push({
        externalKey: it.externalKey,
        name: it.name,
        groupKey: it.groupKey,
        tags: it.tags,
        meta: it.meta,
        files,
        previewFileID: files.webp || files.gif || files.png || '',
        sort: i + prepared.length,
      });
    }
    // eslint-disable-next-line no-await-in-loop
    const data = await callUpsert(app, {
      action: 'upsertItems',
      sourceId: parsed.source.id,
      items: prepared,
      refreshCounts: i + batchSize >= items.length,
    });
    console.log(
      `[import] items ${Math.min(i + batchSize, items.length)}/${items.length}`,
      data,
    );
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('请指定 --in <本地目录>');
    process.exit(1);
  }
  const inputDir = path.isAbsolute(args.input)
    ? args.input
    : path.resolve(process.cwd(), args.input);
  if (!fs.existsSync(inputDir)) {
    console.error('目录不存在:', inputDir);
    process.exit(1);
  }

  const parsed = ensureParsed(args.source, inputDir);
  console.log('[import] source =', parsed.source.id);
  console.log('[import] groups =', parsed.groups.length);
  console.log('[import] items  =', parsed.items.length);
  const withGif = parsed.items.filter((x) => x.localFiles.gif).length;
  const withWebp = parsed.items.filter((x) => x.localFiles.webp).length;
  const withLottie = parsed.items.filter((x) => x.localFiles.lottie).length;
  console.log(`[import] formats gif=${withGif} webp=${withWebp} lottie=${withLottie}`);

  if (args.dry) return;

  if (args.prepare || !args.upload) {
    const outDir = path.join(ROOT, 'scripts/library-import/out');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${parsed.source.id}-batches.json`);
    const serializable = {
      source: parsed.source,
      groups: parsed.groups,
      items: parsed.items.map((it) => ({
        externalKey: it.externalKey,
        name: it.name,
        groupKey: it.groupKey,
        tags: it.tags,
        meta: it.meta,
        localFiles: it.localFiles,
      })),
    };
    fs.writeFileSync(outFile, JSON.stringify(serializable, null, 2), 'utf8');
    console.log('[import] wrote', outFile);
    if (!args.upload) {
      console.log('[import] 下一步：配置云开发密钥后加 --upload 真正上传');
      return;
    }
  }

  runUpload(parsed, args.batchSize).catch((e) => {
    console.error('[import] fail', e.message || e);
    process.exit(1);
  });
}

main();
