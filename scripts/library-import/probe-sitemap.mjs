import fs from 'fs';

const p =
  process.argv[2] ||
  'C:/Users/超级阳/.cursor/projects/d-code-emojiShare/agent-tools/fecf8a14-772c-4ecb-8a10-21159eeb6741.txt';
const t = fs.readFileSync(p, 'utf8');
console.log('len', t.length);
console.log('head', t.slice(0, 400));
const urls = [...t.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) => m[0]);
console.log('urls', urls.length);
console.log(urls.slice(0, 12));
const emojiUrls = urls.filter((u) => /\/emoji\//.test(u));
console.log('emojiUrls', emojiUrls.length);
const slugs = emojiUrls
  .map((u) => {
    const m = u.match(/\/emoji\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  })
  .filter(Boolean);
console.log('slugs', slugs.length, 'uniq', new Set(slugs).size);
console.log(slugs.slice(0, 20));
