import https from 'https';

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

const slug = 'ae-ok-hand';
const hash = 'd28b9517';
for (const u of [
  `https://animatemojis.com/emojis/ae/${slug}.gif`,
  `https://animatemojis.com/emojis/community/${slug}.gif`,
  `https://animatemojis.com/emojis/slack/${slug}.gif`,
  `https://animatemojis.com/emojis/display/${slug}.gif`,
  `https://animatemojis.com/emojis/${slug}.gif`,
  `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.${hash}.gif`,
  `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.${hash}.webp`,
]) {
  // eslint-disable-next-line no-await-in-loop
  console.log(await head(u));
}
