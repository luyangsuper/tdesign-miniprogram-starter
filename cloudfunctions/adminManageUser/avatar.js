/** 与小程序 utils/avatar.js 保持同一套 Pixabot 池（管理员列表默认头像） */
const PIXABOT_POOL = [
  '2767',
  '516a',
  'b50a',
  '2300',
  '9160',
  'b72b',
  'e620',
  '4534',
  'd327',
  '2352',
  '1125',
  'b169',
  '1467',
  'b228',
  '7409',
  '7550',
  '6518',
  '505b',
  'd764',
  '9306',
  '1036',
  'c238',
  '6702',
  '8515',
  'd63b',
  '5213',
  '7629',
  '0351',
  'e751',
  'b75b',
  '2633',
  '5613',
  '3361',
  '5403',
  '3354',
  '3208',
  '9264',
  '9640',
  'c244',
  'a509',
  'c254',
  '6749',
  'd136',
  '7428',
  '0630',
  '0211',
  'b139',
  '5350',
];

const HUE_BUCKETS = [0, 35, 70, 110, 150, 190, 230, 275, 315];

function hashString(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function defaultAvatarUrl(openid) {
  const s = String(openid || 'guest').trim() || 'guest';
  const h = hashString(s);
  const id = PIXABOT_POOL[h % PIXABOT_POOL.length];
  const hue = HUE_BUCKETS[Math.floor(h / PIXABOT_POOL.length) % HUE_BUCKETS.length];
  return `https://pixabots.com/api/pixabot/${id}?size=128&hue=${hue}&saturate=1.35&bg=${encodeURIComponent(
    '#f3f4f6'
  )}`;
}

module.exports = { defaultAvatarUrl };
