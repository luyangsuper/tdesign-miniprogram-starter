import https from 'https';

function head(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 15000 }, (res) => {
      resolve({ url, status: res.statusCode, type: res.headers['content-type'] });
      res.resume();
    });
    req.on('error', (e) => resolve({ url, status: 0, err: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ url, status: 0, err: 'timeout' });
    });
    req.end();
  });
}

const slug = 'fluent-person-walking';
const hash = '0deb83b2';
const candidates = [
  `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.${hash}.gif`,
  `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.${hash}.webp`,
  `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.gif`,
  `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.webp`,
  `https://animatemojis-media.pages.dev/grid/v2/anim/${slug}.${hash}.gif`,
  `https://animatemojis-media.pages.dev/grid/v2/still/${slug}.${hash}.webp`,
  `https://animatemojis-media.pages.dev/display/v2/still/${slug}.${hash}.webp`,
  `https://animatemojis.com/api/emojis?q=${slug}&limit=1`,
];

for (const u of candidates) {
  // eslint-disable-next-line no-await-in-loop
  console.log(await head(u));
}
