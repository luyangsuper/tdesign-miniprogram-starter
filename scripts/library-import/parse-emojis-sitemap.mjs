import fs from 'fs';

const candidates = [
  'C:/Users/超级阳/.cursor/projects/d-code-emojiShare/agent-tools/dc2386a9-87f7-43af-9395-a0edfa469b28.txt',
  'scripts/library-import/out/emojis-0.xml',
];

const path = candidates.find((p) => fs.existsSync(p));
console.log('using', path);
const t = fs.readFileSync(path, 'utf8');
const pages = [
  ...t.matchAll(/animatemojis\.com\/emoji\/([a-z0-9-]+)/gi),
].map((m) => m[1].toLowerCase());
const uniq = [...new Set(pages)];
const fluent = uniq.filter((s) => s.startsWith('fluent-'));
const ae = uniq.filter((s) => s.startsWith('ae-'));
const other = uniq.filter(
  (s) => !s.startsWith('fluent-') && !s.startsWith('ae-'),
);
console.log({
  total: uniq.length,
  fluent: fluent.length,
  ae: ae.length,
  other: other.length,
  sampleFluent: fluent.slice(0, 15),
  sampleAe: ae.slice(0, 15),
  sampleOther: other.filter((s) => /parrot|blob|party|pepe/i.test(s)).slice(0, 20),
});

fs.mkdirSync('scripts/library-import/out', { recursive: true });
fs.writeFileSync(
  'scripts/library-import/out/sitemap-slugs.json',
  JSON.stringify({ total: uniq.length, slugs: uniq }, null, 2),
);
