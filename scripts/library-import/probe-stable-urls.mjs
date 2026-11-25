import https from 'https';
import fs from 'fs';

function head(url) {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: 'HEAD',
        timeout: 20000,
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

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'emojiShare-probe/1.0' },
        timeout: 60000,
      },
      (res) => {
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

const candidates = [
  'https://animatemojis.com/emojis/fluent/fluent-person-walking.gif',
  'https://animatemojis.com/emojis/fluent/fluent-person-walking.webp',
  'https://animatemojis.com/emojis/fluent/fluent-person-walking.json',
  'https://animatemojis.com/emojis/fluent/fluent-grinning-face.gif',
  'https://animatemojis.com/emojis/google/smile.gif',
  'https://animatemojis.com/emojis/noto/smile.gif',
  'https://animatemojis.com/emojis/community/ae-ok-hand.gif',
  'https://animatemojis.com/emojis/ae/ae-ok-hand.gif',
  'https://animatemojis.com/emojis/ae-ok-hand.gif',
  'https://animatemojis.com/emojis/display/ae-ok-hand.gif',
  'https://animatemojis.com/emojis/slack/ae-ok-hand.gif',
];

for (const u of candidates) {
  // eslint-disable-next-line no-await-in-loop
  console.log(await head(u));
}

// letter index / browse pages that may list fluent
const browse = [
  'https://animatemojis.com/browse',
  'https://animatemojis.com/emojis',
  'https://animatemojis.com/a',
  'https://animatemojis.com/fluent',
  'https://animatemojis.com/microsoft',
  'https://animatemojis.com/sources',
];
for (const u of browse) {
  try {
    // eslint-disable-next-line no-await-in-loop
    const r = await get(u);
    console.log('browse', u, r.status, r.body.length);
    const fluentLinks = [
      ...r.body.matchAll(/\/emoji\/(fluent-[a-z0-9-]+)/gi),
    ].map((m) => m[1].toLowerCase());
    const uniq = [...new Set(fluentLinks)];
    console.log('  fluent links', uniq.length, uniq.slice(0, 8));
    if (uniq.length > 20) {
      fs.writeFileSync(
        'scripts/library-import/out/browse-fluent-sample.html',
        r.body.slice(0, 50000),
      );
    }
  } catch (e) {
    console.log('browse fail', u, e.message);
  }
}

// use existing catalog fluent slugs if present
const catPath = 'scripts/library-import/out/sitemap-catalog.json';
if (fs.existsSync(catPath)) {
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  const fluent = (cat.items || []).filter((i) =>
    String(i.slug || '').startsWith('fluent-'),
  );
  console.log('catalog fluent', fluent.length);
  // probe 5 random stable gif
  for (const it of fluent.slice(0, 5)) {
    const u = `https://animatemojis.com/emojis/fluent/${it.slug}.gif`;
    // eslint-disable-next-line no-await-in-loop
    console.log(await head(u));
  }
  for (const it of fluent.slice(0, 3)) {
    const u = `https://animatemojis.com/emojis/fluent/${it.slug}.webp`;
    // eslint-disable-next-line no-await-in-loop
    console.log(await head(u));
  }
}
