import fs from 'fs';

const p =
  process.argv[2] ||
  'C:/Users/超级阳/.cursor/projects/d-code-emojiShare/agent-tools/fecf8a14-772c-4ecb-8a10-21159eeb6741.txt';
const t = fs.readFileSync(p, 'utf8');

// sitemap pairs: page url then media gif url roughly nearby
const pageRe = /https:\/\/animatemojis\.com\/emoji\/([a-z0-9-]+)/gi;
const mediaRe =
  /https:\/\/animatemojis-media\.pages\.dev\/display\/v2\/anim\/([a-z0-9-]+)\.([a-f0-9]+)\.gif/gi;

const pages = [...t.matchAll(pageRe)].map((m) => m[1].toLowerCase());
const medias = [...t.matchAll(mediaRe)].map((m) => ({
  slug: m[1].toLowerCase(),
  hash: m[2],
  url: m[0],
}));

const uniqPages = [...new Set(pages)];
const mediaBySlug = new Map(medias.map((m) => [m.slug, m]));

const fluent = uniqPages.filter((s) => s.startsWith('fluent-'));
const googleish = uniqPages.filter((s) => !s.startsWith('fluent-'));
const community = googleish.filter((s) => !mediaBySlug.has(s));

console.log({
  pages: uniqPages.length,
  media: medias.length,
  fluent: fluent.length,
  nonFluent: googleish.length,
  sampleFluent: fluent.slice(0, 15),
  sampleOther: googleish.filter((s) => s.includes('party') || s.includes('blob') || s.includes('parrot')).slice(0, 20),
});

// dump catalogs
const outDir = 'scripts/library-import/out';
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  `${outDir}/sitemap-catalog.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      total: uniqPages.length,
      items: uniqPages.map((slug) => {
        const m = mediaBySlug.get(slug);
        const kind = slug.startsWith('fluent-') ? 'fluent' : 'google_or_other';
        return {
          slug,
          kind,
          gif: m
            ? m.url
            : `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.gif`,
          // guess webp/still paths used by site
          webp: m
            ? `https://animatemojis-media.pages.dev/display/v2/anim/${slug}.${m.hash}.webp`
            : '',
          still: m
            ? `https://animatemojis-media.pages.dev/display/v2/still/${slug}.${m.hash}.webp`
            : '',
          page: `https://animatemojis.com/emoji/${slug}`,
        };
      }),
    },
    null,
    2,
  ),
);
console.log('wrote sitemap-catalog.json');
