import fs from 'fs';

const xmlPath = 'scripts/library-import/out/emojis-0.xml';
const xml = fs.readFileSync(xmlPath, 'utf8');
console.log('xml len', xml.length);
console.log('head', xml.slice(0, 600));

const loc = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
console.log('locs', loc.length);
console.log('sample locs', loc.slice(0, 20));
console.log(
  'fluent locs',
  loc.filter((u) => /fluent-/i.test(u)).slice(0, 10),
);

const media = [
  ...xml.matchAll(
    /https:\/\/animatemojis-media\.pages\.dev\/[^\s<"']+/gi,
  ),
].map((m) => m[0]);
console.log('media urls', media.length);
console.log('sample media', media.slice(0, 20));

const grid = media.filter((u) => /\/grid\//i.test(u));
const display = media.filter((u) => /\/display\//i.test(u));
const fluentMedia = media.filter((u) => /fluent-/i.test(u));
console.log({
  grid: grid.length,
  display: display.length,
  fluentMedia: fluentMedia.length,
});
console.log('fluent media sample', fluentMedia.slice(0, 10));
