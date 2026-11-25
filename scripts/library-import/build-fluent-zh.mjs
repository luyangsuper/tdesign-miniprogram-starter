/**
 * fluent-{english-kebab} → 简体中文名（CLDR tts）
 */
import fs from 'fs';
import https from 'https';

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 60000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const zhPath = 'cloudfunctions/adminUpsertLibrary/zhEmojiNames.json';
const zhByCp = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

// Unicode emoji-test: codepoints + English name
let emojiTest = '';
try {
  emojiTest = await get(
    'https://unicode.org/Public/emoji/latest/emoji-test.txt',
  );
  fs.writeFileSync('scripts/library-import/out/emoji-test.txt', emojiTest);
} catch (e) {
  console.warn('fetch emoji-test fail', e.message);
  if (fs.existsSync('scripts/library-import/out/emoji-test.txt')) {
    emojiTest = fs.readFileSync(
      'scripts/library-import/out/emoji-test.txt',
      'utf8',
    );
  }
}

const enToCp = new Map();
const enToZh = new Map();
for (const line of emojiTest.split(/\n/)) {
  // 1F600 ; fully-qualified # 😀 E1.0 grinning face
  const m = line.match(
    /^([0-9A-F ]+)\s*;\s*fully-qualified\s*#\s*\S+\s+E[\d.]+\s+(.+)$/i,
  );
  if (!m) continue;
  const cp = m[1]
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join('_');
  const en = m[2].trim();
  const key = kebab(en);
  if (!enToCp.has(key)) enToCp.set(key, cp);
  const zh = zhByCp[cp];
  if (zh && !enToZh.has(key)) enToZh.set(key, zh);
}

const catalog = JSON.parse(
  fs.readFileSync('scripts/library-import/out/other-catalog.json', 'utf8'),
);

const fluentZh = {};
let hit = 0;
let miss = 0;
for (const it of catalog.fluent || []) {
  const base = it.slug.replace(/^fluent-/, '');
  let zh = enToZh.get(base) || '';
  // soft aliases（clock: eight-oclock ↔ eight-o-clock）
  if (!zh) {
    const alts = [
      base.replace(/-face$/, ''),
      `${base}-face`,
      base.replace(/^person-/, ''),
      base.replace(/-man$/, ''),
      base.replace(/-woman$/, ''),
      base.replace(/-oclock$/, '-o-clock'),
      base.replace(/-o-clock$/, '-oclock'),
      base.replace(/cloud-with-lightning-and-rain/, 'cloud-with-lightning-and-rain'),
      base.replace(/-blond-hair$/, '-blond-haired'),
      base.replace(/-bald$/, '-bald'),
      base.replace(/health-worker/, 'health-worker'),
      base.replace(/^man-/, 'man-'),
      base.replace(/^woman-/, 'woman-'),
    ];
    for (const a of alts) {
      if (a && enToZh.has(a)) {
        zh = enToZh.get(a);
        break;
      }
    }
  }
  // 再扫一遍：去掉性别前缀后匹配
  if (!zh) {
    const stripped = base
      .replace(/^(man|woman|person)-/, '')
      .replace(/-(man|woman)$/, '');
    if (enToZh.has(stripped)) zh = enToZh.get(stripped);
  }
  if (zh) {
    fluentZh[it.slug] = zh;
    hit += 1;
  } else {
    miss += 1;
  }
}

fs.writeFileSync(
  'cloudfunctions/adminUpsertLibrary/fluentZhNames.json',
  JSON.stringify(fluentZh, null, 0),
);
fs.writeFileSync(
  'scripts/library-import/out/fluent-zh-names.json',
  JSON.stringify(fluentZh, null, 2),
);

console.log({
  fluent: (catalog.fluent || []).length,
  hit,
  miss,
  sample: Object.entries(fluentZh).slice(0, 12),
  missSample: (catalog.fluent || [])
    .filter((it) => !fluentZh[it.slug])
    .slice(0, 15)
    .map((it) => it.slug),
});
