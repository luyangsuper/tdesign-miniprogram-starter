import https from 'https';
import fs from 'fs';
import { URL } from 'url';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/json,*/*',
        },
        timeout: 30000,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          get(next).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            type: res.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function head(url) {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: 'HEAD',
        timeout: 15000,
        headers: { 'User-Agent': 'emojiShare-probe/1.0' },
      },
      (res) => {
        resolve({
          url,
          status: res.statusCode,
          type: res.headers['content-type'],
          len: res.headers['content-length'],
        });
        res.resume();
      },
    );
    req.on('error', (e) => resolve({ url, status: 0, err: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ url, status: 0, err: 'timeout' });
    });
    req.end();
  });
}

const slug = process.argv[2] || 'fluent-person-walking';
const pageUrl = `https://animatemojis.com/emoji/${slug}`;
console.log('fetch', pageUrl);
const page = await get(pageUrl);
console.log({ status: page.status, type: page.type, len: page.body.length });

fs.mkdirSync('scripts/library-import/out', { recursive: true });
fs.writeFileSync(`scripts/library-import/out/${slug}-page.html`, page.body);

const mediaUrls = [
  ...page.body.matchAll(
    /https:\/\/animatemojis-media\.pages\.dev\/[a-z0-9/_.-]+\.(?:gif|webp|json)/gi,
  ),
].map((m) => m[0]);
const uniq = [...new Set(mediaUrls)];
console.log('media urls in html', uniq.length);
console.log(uniq.slice(0, 40));

const assetHints = [
  ...page.body.matchAll(/["']([^"']*(?:fluent|grid|display|anim|still)[^"']*\.(?:gif|webp|json))["']/gi),
].map((m) => m[1]);
console.log('asset hints', [...new Set(assetHints)].slice(0, 40));

// also try next data / __NEXT_DATA__
const next = page.body.match(
  /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
);
if (next) {
  fs.writeFileSync(
    `scripts/library-import/out/${slug}-next.json`,
    next[1],
  );
  console.log('found __NEXT_DATA__', next[1].length);
  try {
    const data = JSON.parse(next[1]);
    const dump = JSON.stringify(data).slice(0, 2000);
    console.log('next snippet', dump);
  } catch (e) {
    console.log('next parse fail', e.message);
  }
}

// try API variants
const apiUrls = [
  `https://animatemojis.com/api/emojis?q=${slug}&limit=5`,
  `https://animatemojis.com/api/emojis?slug=${slug}`,
  `https://animatemojis.com/api/emoji/${slug}`,
  `https://animatemojis.com/api/emojis/${slug}`,
  `https://animatemojis.com/api/emojis?author=Microsoft&limit=5`,
  `https://animatemojis.com/api/emojis?source=fluent&limit=5`,
  `https://animatemojis.com/api/emojis?family=fluent&limit=5`,
];
for (const u of apiUrls) {
  try {
    // eslint-disable-next-line no-await-in-loop
    const r = await get(u);
    console.log('API', u, r.status, r.body.slice(0, 180).replace(/\s+/g, ' '));
  } catch (e) {
    console.log('API fail', u, e.message);
  }
}

// try known grid without hash + with hash from page
const hashes = [
  ...page.body.matchAll(/\.([a-f0-9]{8})\.(?:gif|webp)/gi),
].map((m) => m[1]);
console.log('hashes in page', [...new Set(hashes)]);

const hash = hashes[0] || '0deb83b2';
for (const u of [
  `https://animatemojis-media.pages.dev/grid/v2/anim/${slug}.${hash}.gif`,
  `https://animatemojis-media.pages.dev/grid/v2/anim/${slug}.${hash}.webp`,
  `https://animatemojis-media.pages.dev/grid/v2/still/${slug}.${hash}.webp`,
  `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.${hash}.gif`,
  `https://animatemojis-media.pages.dev/lottie/v2/${slug}.${hash}.json`,
  `https://animatemojis-media.pages.dev/lottie/${slug}.json`,
]) {
  // eslint-disable-next-line no-await-in-loop
  console.log(await head(u));
}
