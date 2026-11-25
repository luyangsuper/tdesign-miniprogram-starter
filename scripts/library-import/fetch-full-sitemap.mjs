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
            'Mozilla/5.0 (compatible; emojiShare-library-import/1.0)',
          Accept: 'application/xml,text/xml,*/*',
        },
        timeout: 60000,
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

const outDir = 'scripts/library-import/out';
fs.mkdirSync(outDir, { recursive: true });

const indexUrl = 'https://animatemojis.com/sitemap.xml';
console.log('fetch', indexUrl);
const index = await get(indexUrl);
fs.writeFileSync(`${outDir}/sitemap-index.xml`, index.body);
console.log('index status', index.status, 'len', index.body.length);

const childUrls = [
  ...index.body.matchAll(/<loc>([^<]+)<\/loc>/gi),
].map((m) => m[1]);
console.log('child sitemaps', childUrls);

const allXml = [];
if (!childUrls.length || /<urlset/i.test(index.body)) {
  allXml.push(index.body);
} else {
  for (const u of childUrls) {
    console.log('fetch child', u);
    // eslint-disable-next-line no-await-in-loop
    const r = await get(u);
    const name = u.split('/').pop() || 'child.xml';
    fs.writeFileSync(`${outDir}/${name}`, r.body);
    allXml.push(r.body);
    console.log(name, r.status, r.body.length);
  }
}

const big = allXml.join('\n');
const pageRe =
  /<loc>https:\/\/animatemojis\.com\/emoji\/([a-z0-9-]+)<\/loc>/gi;
const mediaRe =
  /https:\/\/animatemojis-media\.pages\.dev\/(display|grid)\/v2\/(?:anim|still|poster)\/([a-z0-9-]+)(?:\.([a-f0-9]+))?\.(gif|webp)/gi;

const pages = [...big.matchAll(pageRe)].map((m) => m[1].toLowerCase());
const medias = [...big.matchAll(mediaRe)].map((m) => ({
  pathKind: m[1],
  slug: m[2].toLowerCase(),
  hash: m[3] || '',
  ext: m[4],
  url: m[0],
}));

const uniqPages = [...new Set(pages)];
const mediaBySlug = new Map();
for (const m of medias) {
  if (!mediaBySlug.has(m.slug) || m.hash) mediaBySlug.set(m.slug, m);
}

function classify(slug) {
  if (slug.startsWith('fluent-')) return 'fluent';
  if (slug.startsWith('ae-') || slug.startsWith('blob') || slug.includes('parrot'))
    return 'community';
  if (mediaBySlug.has(slug) && mediaBySlug.get(slug).pathKind === 'grid')
    return 'grid_other';
  return 'google_or_other';
}

const items = uniqPages.map((slug) => {
  const m = mediaBySlug.get(slug);
  const kind = classify(slug);
  const pathKind = m?.pathKind || (kind === 'fluent' ? 'grid' : 'display');
  const hash = m?.hash || '';
  const base = `https://animatemojis-media.pages.dev/${pathKind}/v2`;
  return {
    slug,
    kind,
    pathKind,
    hash,
    gif: hash
      ? `${base}/anim/${slug}.${hash}.gif`
      : `${base}/anim/${slug}.gif`,
    webp: hash ? `${base}/anim/${slug}.${hash}.webp` : '',
    still: hash ? `${base}/still/${slug}.${hash}.webp` : '',
    poster: hash ? `${base}/poster/${slug}.${hash}.webp` : '',
    page: `https://animatemojis.com/emoji/${slug}`,
  };
});

const counts = items.reduce((acc, it) => {
  acc[it.kind] = (acc[it.kind] || 0) + 1;
  return acc;
}, {});

fs.writeFileSync(
  `${outDir}/sitemap-catalog.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      total: items.length,
      counts,
      mediaMatched: medias.length,
      items,
    },
    null,
    2,
  ),
);

console.log({
  pages: uniqPages.length,
  media: medias.length,
  counts,
  fluentWithHash: items.filter((i) => i.kind === 'fluent' && i.hash).length,
  sampleFluent: items.filter((i) => i.kind === 'fluent').slice(0, 5),
  sampleCommunity: items.filter((i) => i.kind === 'community').slice(0, 8),
});

// probe stable no-hash /emojis/fluent/ path seen in page HTML
for (const u of [
  'https://animatemojis.com/emojis/fluent/fluent-person-walking.gif',
  'https://animatemojis.com/emojis/fluent/fluent-person-walking.webp',
  'https://animatemojis-media.pages.dev/emojis/fluent/fluent-person-walking.gif',
]) {
  // eslint-disable-next-line no-await-in-loop
  console.log(await head(u));
}
