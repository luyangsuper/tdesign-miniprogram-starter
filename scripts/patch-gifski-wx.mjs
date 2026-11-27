/**
 * 把 gifski-wasm 的 wasm-bindgen 胶水改成微信小程序可用（WXWebAssembly + 代码包路径）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const outDir = path.join(ROOT, 'wasm', 'gifski');
const srcJs = path.join(ROOT, 'node_modules', 'gifski-wasm', 'pkg', 'gifski_wasm.js');
const srcWasm = path.join(
  ROOT,
  'node_modules',
  'gifski-wasm',
  'pkg',
  'gifski_wasm_bg.wasm',
);

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(srcWasm, path.join(outDir, 'gifski_wasm_bg.wasm'));

let s = fs.readFileSync(srcJs, 'utf8');
s = s.replace(/WebAssembly/g, 'WXWebAssembly');

s = s.replace(
  /if \(typeof input === 'undefined'\) \{\s*input = new URL\('gifski_wasm_bg\.wasm', import\.meta\.url\);\s*\}/,
  '',
);

s = s.replace(
  /if \(typeof input === 'string' \|\| \(typeof Request === 'function' && input instanceof Request\) \|\| \(typeof URL === 'function' && input instanceof URL\)\) \{\s*input = fetch\(input\);\s*\}/,
  '',
);

const newLoad = `async function __wbg_load(module, imports) {
    // 微信：字符串 = 代码包内路径
    if (typeof module === 'string') {
        const result = await WXWebAssembly.instantiate(module, imports);
        if (result instanceof WXWebAssembly.Instance) {
            return { instance: result, module: undefined };
        }
        return result;
    }
    if (typeof Response === 'function' && module instanceof Response) {
        const bytes = await module.arrayBuffer();
        return await WXWebAssembly.instantiate(bytes, imports);
    }
    const instance = await WXWebAssembly.instantiate(module, imports);
    if (instance instanceof WXWebAssembly.Instance) {
        return { instance, module };
    }
    return instance;
}`;

if (!/async function __wbg_load\(/.test(s)) {
  throw new Error('__wbg_load not found');
}
s = s.replace(/async function __wbg_load\([\s\S]*?\n\}/, newLoad);

const newInit = `async function __wbg_init(input) {
    if (wasm !== undefined) return wasm;

    if (input === undefined || input === null || input === '') {
        input = '/wasm/gifski/gifski_wasm_bg.wasm';
    }
    const imports = __wbg_get_imports();
    __wbg_init_memory(imports);
    const { instance, module } = await __wbg_load(input, imports);
    return __wbg_finalize_init(instance, module);
}`;

if (!/async function __wbg_init\(/.test(s)) {
  throw new Error('__wbg_init not found');
}
s = s.replace(/async function __wbg_init\([\s\S]*?\n\}/, newInit);

fs.writeFileSync(path.join(outDir, 'gifski_wasm.js'), s);
console.log('ok', {
  wasm: fs.statSync(path.join(outDir, 'gifski_wasm_bg.wasm')).size,
  hasWX: s.includes('WXWebAssembly'),
  hasPath: s.includes('/wasm/gifski/gifski_wasm_bg.wasm'),
  noMeta: !s.includes('import.meta'),
  noFetch: !s.includes('fetch(input)'),
});
