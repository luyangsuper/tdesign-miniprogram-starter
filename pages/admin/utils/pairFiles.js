/**
 * 按列表下标对齐预览 / 静态 / 动态（用户拖排序后的顺序即配对顺序）。
 * 预览图可选：槽位以静态原图为准；预览视频不参与配对。
 */

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|avi|mkv|3gp|webm)$/i;

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

export function isVideoFile(file = {}) {
  if (!file) return false;
  if (file.type === 'video' || file.fileType === 'video' || file.isVideo) return true;
  const blob = [
    file.name,
    file.path,
    file.tempFilePath,
    file.url,
    file.fileID,
  ]
    .filter(Boolean)
    .join(' ');
  return VIDEO_EXT_RE.test(String(blob).split('?')[0]);
}

export function splitPreviewMedia(files = []) {
  const images = [];
  const videos = [];
  (files || []).forEach((f) => {
    if (isVideoFile(f)) videos.push(f);
    else images.push(f);
  });
  return { images, videos };
}

function padKey(i) {
  return String(i + 1).padStart(3, '0');
}

/**
 * 以静态原图为槽位；同下标预览图 / 动态可选。
 * 多出来的预览图进入 unmatchedPreview（仍会整表上传）；多出来的动态忽略。
 */
export function pairByIndex(previewFiles = [], staticFiles = [], animFiles = []) {
  const { images: previews } = splitPreviewMedia(previewFiles);
  const statics = staticFiles || [];
  const anims = animFiles || [];
  const n = statics.length;

  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    pairs.push({
      key: String(i + 1),
      preview: previews[i] || null,
      emoji: statics[i],
      static: statics[i],
      anim: anims[i] || null,
    });
  }

  return {
    pairs,
    unmatchedPreview: previews.slice(n),
    unmatchedStatic: [],
    unmatchedAnim: anims.slice(n),
    orderedPreviews: previews,
    orderedStatics: statics,
    orderedAnims: statics.map((_, i) => anims[i] || null),
    pairKeys: statics.map((_, i) => padKey(i)),
  };
}
