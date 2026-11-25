/**
 * 从完整 emojis sitemap 文本生成「非 Google」目录：
 * - fluent-* → 稳定地址 /emojis/fluent/{slug}.gif|webp
 * - ae-* 等社区 → sitemap 里的 display/v2 hashed 地址
 */
import fs from 'fs';

const candidates = [
  'C:/Users/超级阳/.cursor/projects/d-code-emojiShare/agent-tools/dc2386a9-87f7-43af-9395-a0edfa469b28.txt',
  'scripts/library-import/out/emojis-0.xml',
];
const src = candidates.find((p) => fs.existsSync(p));
console.log('using', src);
const t = fs.readFileSync(src, 'utf8');

const pageRe = /animatemojis\.com\/emoji\/([a-z0-9-]+)/gi;
const mediaRe =
  /animatemojis-media\.pages\.dev\/(display|grid)\/v2\/(?:anim|still|poster)\/([a-z0-9-]+)(?:\.([a-f0-9]+))?\.(gif|webp)/gi;

const pages = [...t.matchAll(pageRe)].map((m) => m[1].toLowerCase());
const medias = [...t.matchAll(mediaRe)].map((m) => ({
  pathKind: m[1].toLowerCase(),
  slug: m[2].toLowerCase(),
  hash: m[3] || '',
  ext: m[4].toLowerCase(),
  url: `https://${m[0]}`,
}));

const uniqPages = [...new Set(pages)];
const mediaBySlug = new Map();
for (const m of medias) {
  const prev = mediaBySlug.get(m.slug);
  if (!prev || (!prev.hash && m.hash) || (m.ext === 'gif' && prev.ext !== 'gif')) {
    mediaBySlug.set(m.slug, m);
  }
}

function titleFromSlug(slug) {
  const base = slug.replace(/^fluent-/, '').replace(/^ae-/, '');
  return base
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function guessGroup(slug) {
  const s = slug.replace(/^fluent-/, '').replace(/^ae-/, '');
  if (
    /face|grin|smile|cry|angry|sad|joy|wink|kiss|blush|think|sleep|vomit|fear|anxious|sweat|rage|nerd|clown|ghost|skull|poop|alien|ogre|imp|zombie|vampire|mage|elf|cool|woozy|pensive|plead|grimac|expressionless|neutral|zipper|salute|shush|yawn|hug|peek|scream|unamused|rolling|exhale|triumph|concern|frown|mouth|melting|partying|star-struck|heart-eyes|heart-face|drool|yum|tongue|zany|mask|sick|hot-face|cold-face|disguise|liar|shaking|dotted|clouds|bandage|money-face|dizzy|exploding|cowboy|party|blob|pepe|retsuko|bonk/.test(
      s,
    )
  )
    return 'smileys';
  if (
    /person|man|woman|boy|girl|baby|people|hand|finger|fist|clap|wave|muscle|leg|foot|ear|nose|brain|bone|selfie|dancer|walking|running|kneeling|standing|bowing|climbing|biking|rowing|surfing|swimming|golf|juggle|cartwheel|wrestle|fencing|ski|snowboard|lift|bath|artist|astronaut|mechanic|office|health|scientist|singer|student|teacher|farmer|cook|factory|technologist|detective|guard|ninja|construction|prince|princess|superhero|supervillain|mage|fairy|vampire|merperson|elf|genie|zombie|troll|pregnant|breast|couple|family|kiss-man|kiss-woman|people-holding|people-hugging|speaking-head/.test(
      s,
    )
  )
    return 'people';
  if (
    /cat|dog|mouse|hamster|rabbit|fox|bear|panda|koala|tiger|lion|cow|pig|frog|monkey|chicken|penguin|bird|eagle|duck|owl|bat|wolf|boar|horse|unicorn|zebra|deer|bison|ox|buffalo|camel|llama|giraffe|elephant|mammoth|rhino|hippo|rat|chipmunk|beaver|hedgehog|badger|otter|skunk|kangaroo|sloth|paw|dragon|sauropod|t-rex|whale|dolphin|seal|fish|blowfish|shark|octopus|shell|snail|butterfly|bug|ant|bee|beetle|lady|cricket|cockroach|spider|scorpion|mosquito|fly|worm|microbe|bouquet|blossom|rose|tulip|seedling|tree|palm|cactus|herb|leaf|mushroom|nest|flower|black-cat|badger|beaver|bison|beetle/.test(
      s,
    )
  )
    return 'animals';
  if (
    /grape|melon|watermelon|tangerine|lemon|banana|pineapple|mango|apple|pear|peach|cherries|strawberry|blueberry|kiwi|tomato|olive|coconut|avocado|eggplant|potato|carrot|corn|pepper|cucumber|broccoli|garlic|onion|peanut|beans|chestnut|bread|croissant|bagel|pancake|waffle|cheese|meat|bacon|hamburger|fries|pizza|hot-dog|sandwich|taco|burrito|egg|cooking|salad|popcorn|butter|salt|bento|rice|curry|ramen|spaghetti|sushi|dumpling|doughnut|cookie|cake|cupcake|pie|chocolate|candy|lollipop|custard|honey|bottle|milk|beverage|teapot|teacup|sake|wine|cocktail|beer|clinking|bubble-tea|mate|chopsticks|fork|spoon|kitchen|mug|drink/.test(
      s,
    )
  )
    return 'food';
  if (
    /globe|map|compass|mountain|volcano|camping|beach|desert|island|park|stadium|building|house|office|hospital|bank|hotel|school|factory|castle|church|mosque|synagogue|fountain|tent|cityscape|sunrise|sunset|bridge|hot-springs|carousel|ferris|roller|barber|circus|locomotive|railway|train|metro|tram|bus|ambulance|fire-engine|police-car|taxi|automobile|truck|tractor|motorcycle|scooter|bicycle|skateboard|fuel|stop-sign|construction|anchor|sailboat|canoe|speedboat|ferry|ship|airplane|helicopter|rocket|flying-saucer|luggage|hourglass|watch|alarm|stopwatch|timer|clock|moon|sun|cloud|umbrella|snowman|comet|fire|droplet|ocean|tramway|rickshaw|lorry/.test(
      s,
    )
  )
    return 'travel';
  if (
    /jack-o|christmas|fireworks|sparkler|balloon|party|confetti|tanabata|ribbon|gift|ticket|trophy|medal|soccer|baseball|basketball|volleyball|football|rugby|tennis|bowling|hockey|lacrosse|badminton|boxing|martial|skate|fishing|diving|skis|sled|curling|bullseye|yo-yo|kite|crystal|magic|joystick|slot|dice|puzzle|teddy|pinata|mirror-ball|spade|heart-suit|diamond|club|chess|joker|mahjong|performing|palette|yarn|knot|dance|rave|parrot/.test(
      s,
    )
  )
    return 'activities';
  if (
    /glasses|goggles|necktie|shirt|jeans|scarf|gloves|coat|socks|dress|kimono|sari|bikini|purse|handbag|backpack|shoe|sandal|boot|crown|hat|lipstick|ring|gem|speaker|bell|bookmark|money|yen|dollar|euro|pound|coin|credit|receipt|envelope|mail|package|mailbox|memo|briefcase|folder|calendar|chart|pushpin|paperclip|ruler|scissors|cabinet|wastebasket|locked|key|hammer|axe|dagger|sword|pistol|boomerang|bow|shield|wrench|screwdriver|gear|magnet|ladder|alembic|test-tube|dna|microscope|telescope|syringe|stethoscope|x-ray|door|elevator|mirror|window|bed|couch|chair|toilet|shower|bathtub|razor|broom|basket|bucket|soap|bubbles|toothbrush|sponge|cart|cigarette|coffin|moai|placard|pole/.test(
      s,
    )
  )
    return 'objects';
  if (/flag|banner/.test(s)) return 'flags';
  if (
    /party|parrot|blob|pepe|giphy|meme|rave|discord|slack|alert|ban-hammer|blinking|dumpster|explode|bonk|hype|bongo|dude|wall|im-out|yeah|airquotes|sparkles|bolt|scream/.test(
      s,
    )
  )
    return 'social';
  return 'objects';
}

const fluent = [];
const community = [];

for (const slug of uniqPages) {
  if (slug.startsWith('fluent-')) {
    fluent.push({
      slug,
      kind: 'fluent',
      name: titleFromSlug(slug),
      groupKey: guessGroup(slug),
      gif: `https://animatemojis.com/emojis/fluent/${slug}.gif`,
      webp: `https://animatemojis.com/emojis/fluent/${slug}.webp`,
      page: `https://animatemojis.com/emoji/${slug}`,
    });
    continue;
  }
  if (!slug.startsWith('ae-')) continue;
  const meta = mediaBySlug.get(slug);
  const pathKind = meta?.pathKind || 'display';
  const hash = meta?.hash || '';
  const base = `https://animatemojis-media.pages.dev/${pathKind}/v2`;
  // sitemap 里可能是 .gif 或 .webp；两种都尝试，导入时失败会跳过
  const gif = hash
    ? `${base}/anim/${slug}.${hash}.gif`
    : meta?.url || `${base}/anim/${slug}.gif`;
  const webp = hash ? `${base}/anim/${slug}.${hash}.webp` : '';
  community.push({
    slug,
    kind: 'community',
    name: titleFromSlug(slug),
    groupKey: guessGroup(slug),
    gif: meta?.ext === 'webp' && meta?.url ? meta.url : gif,
    webp: meta?.ext === 'webp' ? meta.url : webp,
    still: hash ? `${base}/still/${slug}.${hash}.webp` : '',
    page: `https://animatemojis.com/emoji/${slug}`,
    hash,
    pathKind,
  });
}

const outDir = 'scripts/library-import/out';
fs.mkdirSync(outDir, { recursive: true });

const catalog = {
  generatedAt: new Date().toISOString(),
  sourceFile: src,
  counts: { fluent: fluent.length, community: community.length, totalPages: uniqPages.length },
  fluent,
  community,
  items: [...fluent, ...community],
};

fs.writeFileSync(`${outDir}/other-catalog.json`, JSON.stringify(catalog, null, 2));

const slim = catalog.items.map((it, i) => ({
  i,
  s: it.slug,
  k: it.kind,
  n: it.name,
  g: it.groupKey,
  gif: it.gif,
  webp: it.webp || '',
}));
fs.writeFileSync(`${outDir}/other-catalog-slim.json`, JSON.stringify(slim));

// 复制到云函数目录供导入使用
const cloudDir = 'cloudfunctions/adminUpsertLibrary';
fs.mkdirSync(cloudDir, { recursive: true });
fs.writeFileSync(`${cloudDir}/otherCatalog.json`, JSON.stringify(slim));

console.log({
  fluent: fluent.length,
  community: community.length,
  communityWithHash: community.filter((c) => c.hash).length,
  slimBytes: Buffer.byteLength(JSON.stringify(slim)),
  sampleFluent: fluent.slice(0, 2),
  sampleCommunity: community.slice(0, 2),
});
