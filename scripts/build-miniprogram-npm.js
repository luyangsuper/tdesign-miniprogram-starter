/**
 * 本地重建 miniprogram_npm（尽量对齐微信开发者工具「工具 → 构建 npm」）
 * 运行：npm run build:npm
 *
 * 不要整包拷贝 node_modules/dayjs（缺 index.js）。
 * TDesign miniprogram_dist 已带裁剪版 miniprogram_npm/{dayjs,tinycolor2,tslib,marked}。
 * 另补 lodash 模块文件：部分 IDE 版本上传/编译仍会去读
 *   miniprogram_npm/tdesign-miniprogram/miniprogram_npm/lodash/*.js
 * （即使业务代码未引用，缺文件会直接 ENOENT 失败）。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const npmDir = path.join(root, 'miniprogram_npm');
const tdesignDist = path.join(
  root,
  'node_modules',
  'tdesign-miniprogram',
  'miniprogram_dist',
);
const tdesignDest = path.join(npmDir, 'tdesign-miniprogram');
const nestedNpm = path.join(tdesignDist, 'miniprogram_npm');

/** IDE 上传时报 ENOENT 的 lodash 模块清单 */
const LODASH_FILES = [
  'isArray.js',
  'isFunction.js',
  'isNull.js',
  'isObject.js',
  'isObjectLike.js',
  'isString.js',
  '_baseGetTag.js',
  '_freeGlobal.js',
  '_getRawTag.js',
  '_objectToString.js',
  '_root.js',
  '_Symbol.js',
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`源目录不存在: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function mustExist(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`构建失败：缺少 ${label}\n  ${p}`);
    process.exit(1);
  }
}

/** 写入与 lodash 模块导出兼容的最小实现（无则从 node_modules/lodash 拷） */
function ensureLodash(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const lodashRoot = path.join(root, 'node_modules', 'lodash');
  const stubs = {
    'isArray.js': 'module.exports = Array.isArray;',
    'isFunction.js':
      "module.exports = function isFunction(v) { return typeof v === 'function'; };",
    'isNull.js': 'module.exports = function isNull(v) { return v === null; };',
    'isObject.js':
      "module.exports = function isObject(v) { var t = typeof v; return v != null && (t === 'object' || t === 'function'); };",
    'isObjectLike.js':
      "module.exports = function isObjectLike(v) { return v != null && typeof v === 'object'; };",
    'isString.js':
      "module.exports = function isString(v) { return typeof v === 'string' || (v != null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object String]'); };",
    '_freeGlobal.js':
      "module.exports = typeof global === 'object' && global && global.Object === Object ? global : {};",
    '_Symbol.js':
      "var freeGlobal = require('./_freeGlobal');\nmodule.exports = freeGlobal.Symbol;",
    '_root.js':
      "var freeGlobal = require('./_freeGlobal');\nmodule.exports = freeGlobal;",
    '_objectToString.js':
      "module.exports = function objectToString(v) { return Object.prototype.toString.call(v); };",
    '_getRawTag.js':
      "var Symbol = require('./_Symbol'), objectToString = require('./_objectToString');\nvar nullTag = '[object Null]', undefinedTag = '[object Undefined]', symToStringTag = Symbol ? Symbol.toStringTag : undefined;\nmodule.exports = function getRawTag(value) { var isOwn, tag, object = Object(value); if (symToStringTag in object) { isOwn = Object.prototype.hasOwnProperty.call(object, symToStringTag); tag = object[symToStringTag]; try { object[symToStringTag] = undefined; var unmasked = true; } catch (e) {} var result = objectToString(object); if (unmasked) { if (isOwn) object[symToStringTag] = tag; else delete object[symToStringTag]; } return result; } return objectToString(object); };",
    '_baseGetTag.js':
      "var Symbol = require('./_Symbol'), getRawTag = require('./_getRawTag'), objectToString = require('./_objectToString');\nvar nullTag = '[object Null]', undefinedTag = '[object Undefined]', symToStringTag = Symbol ? Symbol.toStringTag : undefined;\nmodule.exports = function baseGetTag(value) { if (value == null) return value === undefined ? undefinedTag : nullTag; return (symToStringTag && symToStringTag in Object(value)) ? getRawTag(value) : objectToString(value); };",
  };

  for (const name of LODASH_FILES) {
    const dest = path.join(destDir, name);
    const fromPkg = path.join(lodashRoot, name);
    if (fs.existsSync(fromPkg)) {
      fs.copyFileSync(fromPkg, dest);
    } else if (stubs[name]) {
      fs.writeFileSync(dest, stubs[name], 'utf8');
    } else {
      fs.writeFileSync(dest, 'module.exports = {};\n', 'utf8');
    }
  }
  console.log('ensured lodash stubs at', path.relative(root, destDir));
}

if (!fs.existsSync(tdesignDist)) {
  console.error('缺少 tdesign-miniprogram，请先执行 npm install');
  process.exit(1);
}

rmrf(npmDir);
fs.mkdirSync(npmDir, { recursive: true });

copyDir(tdesignDist, tdesignDest);
console.log('copied tdesign-miniprogram');

const hoist = ['dayjs', 'tinycolor2', 'tslib', 'marked'];
for (const name of hoist) {
  const src = path.join(nestedNpm, name);
  if (!fs.existsSync(src)) {
    console.warn('skip missing nested dep', name);
    continue;
  }
  copyDir(src, path.join(npmDir, name));
  console.log('hoisted', name);
}

// 嵌套路径（IDE 报错路径）+ 顶层兜底
ensureLodash(path.join(tdesignDest, 'miniprogram_npm', 'lodash'));
ensureLodash(path.join(npmDir, 'lodash'));

// tinycolor2 顶层若被扫到完整包路径，补常见入口，避免 ENOENT
const tinyTop = path.join(npmDir, 'tinycolor2');
const tinySrc = path.join(nestedNpm, 'tinycolor2', 'esm', 'tinycolor.js');
if (fs.existsSync(tinySrc)) {
  const extras = [
    ['cjs/tinycolor.js', tinySrc],
    ['dist/tinycolor-min.js', tinySrc],
    ['tinycolor.js', tinySrc],
    ['esm/tinycolor.js', tinySrc],
  ];
  for (const [rel, src] of extras) {
    const dest = path.join(tinyTop, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  }
  // 空测试文件占位，避免 IDE 扫 package 清单时报 ENOENT
  for (const stub of ['cjs/test.js', 'cjs/test_template.js', 'esm/test.js', 'esm/test_template.js']) {
    const dest = path.join(tinyTop, stub);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, 'module.exports = {};\n', 'utf8');
  }
  console.log('patched tinycolor2 entry aliases');
}

mustExist(path.join(tdesignDest, 'navbar', 'navbar.js'), 'navbar');
mustExist(path.join(npmDir, 'dayjs', 'index.js'), 'dayjs/index.js');
mustExist(
  path.join(npmDir, 'tinycolor2', 'esm', 'tinycolor.js'),
  'tinycolor2/esm/tinycolor.js',
);
mustExist(
  path.join(tdesignDest, 'miniprogram_npm', 'lodash', 'isArray.js'),
  'nested lodash/isArray.js',
);

console.log('OK miniprogram_npm ready');
