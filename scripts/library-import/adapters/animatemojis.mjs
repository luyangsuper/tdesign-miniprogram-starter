import fs from 'fs';
import path from 'path';

const GROUPS = [
  { key: 'smileys', title: '笑脸与情绪', emoji: '😊', sort: 10 },
  { key: 'people', title: '人物', emoji: '👋', sort: 20 },
  { key: 'animals', title: '动物与自然', emoji: '🐾', sort: 30 },
  { key: 'food', title: '饮食', emoji: '🍕', sort: 40 },
  { key: 'travel', title: '旅行与地点', emoji: '🚀', sort: 50 },
  { key: 'activities', title: '活动与事件', emoji: '🎉', sort: 60 },
  { key: 'objects', title: '物品', emoji: '💡', sort: 70 },
  { key: 'symbols', title: '符号', emoji: '✅', sort: 80 },
  { key: 'flags', title: '旗帜', emoji: '🏁', sort: 90 },
  { key: 'social', title: '社交', emoji: '💬', sort: 100 },
];

const EXT_TO_FORMAT = {
  '.gif': 'gif',
  '.webp': 'webp',
  '.json': 'lottie',
  '.png': 'png',
  '.svg': 'svg',
};

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function stemOf(filePath) {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

function loadManifest(inputDir) {
  const p = path.join(inputDir, 'manifest.json');
  if (!fs.existsSync(p)) return { items: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(raw)) return { items: raw };
    if (Array.isArray(raw.items)) return raw;
    return { items: [] };
  } catch (e) {
    console.warn('[animatemojis] manifest parse fail', e.message || e);
    return { items: [] };
  }
}

/**
 * 解析 AnimateMojis 本地目录。
 * 支持：
 * 1) by-slug/<slug>/<slug>.gif|webp|json
 * 2) 扁平同名多后缀：joy.gif / joy.webp / joy.json
 * 3) manifest.json 补充中文名与分类
 */
export function parseAnimateMojis(inputDir) {
  const abs = path.resolve(inputDir);
  const manifest = loadManifest(abs);
  const metaBySlug = new Map();
  (manifest.items || []).forEach((it) => {
    const slug = String(it.slug || it.externalKey || '')
      .trim()
      .toLowerCase();
    if (slug) metaBySlug.set(slug, it);
  });

  const bySlugDir = path.join(abs, 'by-slug');
  const fileList = fs.existsSync(bySlugDir) ? walkFiles(bySlugDir) : walkFiles(abs);
  const map = new Map();

  for (const file of fileList) {
    const base = path.basename(file).toLowerCase();
    if (base === 'manifest.json') continue;
    const ext = path.extname(file).toLowerCase();
    const format = EXT_TO_FORMAT[ext];
    if (!format) continue;

    let slug = stemOf(file);
    // by-slug/joy/joy.gif → slug=joy；若文件名与目录名不同，优先目录名
    const parent = path.basename(path.dirname(file)).toLowerCase();
    if (file.includes(`${path.sep}by-slug${path.sep}`) && parent && parent !== 'by-slug') {
      slug = parent;
    }

    if (!map.has(slug)) {
      const meta = metaBySlug.get(slug) || {};
      map.set(slug, {
        externalKey: slug,
        name: String(meta.zhName || meta.name || slug).trim(),
        groupKey: String(meta.category || meta.groupKey || 'smileys').trim(),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        meta: {
          slug,
          zhName: meta.zhName || meta.name || '',
          enName: meta.enName || slug,
        },
        localFiles: {},
      });
    }
    map.get(slug).localFiles[format] = file;
  }

  // manifest-only rows without files still skipped
  const items = Array.from(map.values()).filter(
    (it) => Object.keys(it.localFiles).length > 0,
  );
  items.sort((a, b) => a.externalKey.localeCompare(b.externalKey));

  return {
    source: {
      id: 'animatemojis',
      title: '动态表情',
      subtitle: 'AnimateMojis',
      desc: 'GIF · WebP · Lottie · 10 个分类',
      uiTemplate: 'animated_multiformat',
      formatsDefault: ['gif', 'webp', 'lottie'],
      sort: 10,
      enabled: true,
    },
    groups: GROUPS,
    items,
  };
}

export { GROUPS as ANIMATEMOJIS_GROUPS };
