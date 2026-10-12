/**
 * 按序号配对预览图 / 静态原图 / 动态原图。
 *
 * 优先级：
 * 1. 用户填写的 manualSeq（相册/小 GIF 无可靠文件名时）
 * 2. 文件名中的序号（preview_001 ↔ video_001）
 *
 * 规则：预览 + 静态同序号才算已配对；动态可挂到已有静态槽，缺动态不算错误。
 */

function basename(path = '') {
  const s = String(path).split('?')[0];
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

/** 从文件对象取可读文件名（尽量保留原始 name） */
export function getFileName(file = {}) {
  const raw =
    file.name ||
    file.fileName ||
    file.originalFileObj?.name ||
    '';
  if (raw) return basename(raw);
  return basename(file.path || file.tempFilePath || file.url || '');
}

function isTimestampLike(numStr) {
  const n = String(numStr || '');
  if (n.length >= 6) return true;
  if (n.length >= 5) return true;
  return false;
}

/** 规范化用户填写的序号 → "1" */
export function normalizeManualSeq(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (!/^\d{1,4}$/.test(s)) return '';
  if (isTimestampLike(s)) return '';
  return String(parseInt(s, 10));
}

/**
 * 提取配对序号，返回规范化键（去掉前导零后的数字串，如 "1"）
 */
export function extractPairKey(fileName = '') {
  const base = basename(fileName).replace(/\.[^.]+$/, '');
  if (!base) return '';

  const typeSeq = base.match(
    /(?:^|[_-])(?:preview|video|emoji|real|resource|origin|wallpaper|static|anim|dynamic)[_-](\d{1,4})(?=[_-]|$)/i,
  );
  if (typeSeq && !isTimestampLike(typeSeq[1])) {
    return String(parseInt(typeSeq[1], 10));
  }

  const parts = base.split(/[_-]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!/^\d{1,4}$/.test(part)) continue;
    if (isTimestampLike(part)) continue;
    const prev = (parts[i - 1] || '').toLowerCase();
    if (
      /^(preview|video|emoji|real|resource|origin|wallpaper|static|anim|dynamic)$/.test(
        prev,
      ) ||
      i === 0 ||
      i === 1
    ) {
      return String(parseInt(part, 10));
    }
  }

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\d{1,4}$/.test(part) && !isTimestampLike(part)) {
      return String(parseInt(part, 10));
    }
  }

  return '';
}

/** 展示用序号，如 001 */
export function formatPairLabel(key) {
  if (!key && key !== 0) return '';
  const n = parseInt(key, 10);
  if (Number.isNaN(n)) return String(key);
  return String(n).padStart(3, '0');
}

export function resolvePairKey(file = {}) {
  const manual = normalizeManualSeq(file.manualSeq);
  if (manual) return manual;
  return extractPairKey(getFileName(file));
}

export function annotateFiles(files = []) {
  return (files || []).map((file, index) => {
    const name = getFileName(file);
    const pairKey = resolvePairKey(file);
    return {
      ...file,
      name: file.name || name,
      pairKey,
      pairLabel: pairKey ? formatPairLabel(pairKey) : '',
      _originIndex: index,
    };
  });
}

function buildKeyMap(files) {
  const map = new Map();
  files.forEach((f) => {
    if (f.pairKey && !map.has(f.pairKey)) map.set(f.pairKey, f);
  });
  return map;
}

/**
 * 预览 + 静态必配；动态可选挂到已有静态槽。
 */
export function pairPreviewStaticAnim(
  previewFiles = [],
  staticFiles = [],
  animFiles = [],
) {
  const previews = annotateFiles(previewFiles);
  const statics = annotateFiles(staticFiles);
  const anims = annotateFiles(animFiles);

  const pMap = buildKeyMap(previews);
  const sMap = buildKeyMap(statics);
  const aMap = buildKeyMap(anims);

  const keys = Array.from(
    new Set([...pMap.keys(), ...sMap.keys(), ...aMap.keys()]),
  ).sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));

  const pairs = [];
  const unmatchedPreview = [];
  const unmatchedStatic = [];
  const unmatchedAnim = [];

  keys.forEach((key) => {
    const preview = pMap.get(key) || null;
    const staticFile = sMap.get(key) || null;
    const anim = aMap.get(key) || null;

    if (preview && staticFile) {
      pairs.push({
        key,
        preview,
        emoji: staticFile,
        static: staticFile,
        anim: anim || null,
        previewName: getFileName(preview),
        emojiName: getFileName(staticFile),
        staticName: getFileName(staticFile),
        animName: anim ? getFileName(anim) : '',
      });
    } else {
      if (preview) unmatchedPreview.push(preview);
      if (staticFile) unmatchedStatic.push(staticFile);
      if (anim && !(preview && staticFile)) unmatchedAnim.push(anim);
    }
  });

  previews.forEach((f) => {
    if (!f.pairKey) unmatchedPreview.push(f);
  });
  statics.forEach((f) => {
    if (!f.pairKey) unmatchedStatic.push(f);
  });
  // 无序号，或有序号但未挂到「预览+静态」槽上的动态
  anims.forEach((f) => {
    if (!f.pairKey) {
      unmatchedAnim.push(f);
      return;
    }
    const onPair = pairs.some((p) => p.key === f.pairKey && p.anim === f);
    if (!onPair && !unmatchedAnim.includes(f)) unmatchedAnim.push(f);
  });

  return {
    pairs,
    unmatchedPreview,
    unmatchedStatic,
    unmatchedAnim,
    orderedPreviews: pairs.map((p) => p.preview),
    orderedStatics: pairs.map((p) => p.static),
    orderedAnims: pairs.map((p) => p.anim || null),
    pairKeys: pairs.map((p) => formatPairLabel(p.key)),
  };
}
