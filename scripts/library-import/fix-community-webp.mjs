/**
 * 社区 ae-* 的 hashed webp 大量 404；GIF 仍可用。
 * 清空 otherCatalog 里 community 的 webp，避免导入刷 404。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const p = path.join(
  root,
  'cloudfunctions/adminUpsertLibrary/otherCatalog.json',
);
const catalog = JSON.parse(fs.readFileSync(p, 'utf8'));
let cleared = 0;
for (const row of catalog) {
  if (row && row.k === 'community' && row.webp) {
    delete row.webp;
    cleared += 1;
  }
}
fs.writeFileSync(p, `${JSON.stringify(catalog)}\n`);
console.log('cleared community webp', cleared, 'total', catalog.length);
