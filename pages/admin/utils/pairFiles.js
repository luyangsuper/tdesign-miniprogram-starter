/**
 * 按列表下标对齐预览 / 静态 / 动态（用户拖排序后的顺序即配对顺序）。
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

function padKey(i) {
  return String(i + 1).padStart(3, '0');
}

/**
 * 预览 + 静态按下标对齐；动态同下标可选。
 * 多出来的预览/静态进入 unmatched；多出来的动态忽略（不挂槽）。
 */
export function pairByIndex(previewFiles = [], staticFiles = [], animFiles = []) {
  const previews = previewFiles || [];
  const statics = staticFiles || [];
  const anims = animFiles || [];
  const n = Math.min(previews.length, statics.length);

  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    const anim = anims[i] || null;
    pairs.push({
      key: String(i + 1),
      preview: previews[i],
      emoji: statics[i],
      static: statics[i],
      anim,
    });
  }

  return {
    pairs,
    unmatchedPreview: previews.slice(n),
    unmatchedStatic: statics.slice(n),
    unmatchedAnim: anims.slice(n),
    orderedPreviews: pairs.map((p) => p.preview),
    orderedStatics: pairs.map((p) => p.static),
    orderedAnims: pairs.map((p) => p.anim || null),
    pairKeys: pairs.map((_, i) => padKey(i)),
  };
}
