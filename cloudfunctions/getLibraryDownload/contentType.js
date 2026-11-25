/** 素材库扣费：与客户端 utils/pricing、app_config/points 对齐 */

const DOWNLOAD_COSTS = {
  static: 1,
  anim: 2,
  wallpaper: 4,
  avatar: 4,
  video: 8,
  /** 素材库默认：高质量动图 / 静图 */
  libraryAnim: 4,
  libraryStatic: 2,
};

/** gif / lottie 视为动图；webp / png / jpg 等为静图 */
function isLibraryAnimFormat(format) {
  const f = String(format || '')
    .trim()
    .toLowerCase();
  return f === 'gif' || f === 'lottie' || f === 'json';
}

function resolveLibraryCostKey(format) {
  return isLibraryAnimFormat(format) ? 'libraryAnim' : 'libraryStatic';
}

function libraryKindLabel(format) {
  return isLibraryAnimFormat(format) ? '素材动图' : '素材静图';
}

module.exports = {
  DOWNLOAD_COSTS,
  isLibraryAnimFormat,
  resolveLibraryCostKey,
  libraryKindLabel,
};
