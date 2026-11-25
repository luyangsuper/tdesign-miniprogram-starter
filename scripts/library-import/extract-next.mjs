import fs from 'fs';

const h = fs.readFileSync(
  'scripts/library-import/out/fluent-person-walking-page.html',
  'utf8',
);
const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
console.log('next', !!m, m ? m[1].length : 0);
if (!m) {
  // try RSC flight / embedded JSON
  const flight = [...h.matchAll(/"slug"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
  console.log('slug mentions', flight.length, flight.slice(0, 20));
  const fluent = [...h.matchAll(/fluent-[a-z0-9-]+/gi)].map((x) =>
    x[0].toLowerCase(),
  );
  console.log('fluent uniq', [...new Set(fluent)].length);
  process.exit(0);
}
fs.writeFileSync('scripts/library-import/out/fluent-next.json', m[1]);
const j = JSON.parse(m[1]);
console.log('keys', Object.keys(j));
const p = j.props && j.props.pageProps;
console.log('pageProps keys', p && Object.keys(p));
fs.writeFileSync(
  'scripts/library-import/out/fluent-pageProps.json',
  JSON.stringify(p, null, 2),
);
console.log(JSON.stringify(p, null, 2).slice(0, 4000));
