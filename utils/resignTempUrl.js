import { getTempFileURLs } from '~/utils/cloud';
import { forgetTempUrl, rememberTempUrl } from '~/utils/tempUrlCache';

/**
 * 临时链裂图后换签：清本地缓存 → 重新 getTempFileURL → 写回。
 * @param {string} fileId cloud:// fileID
 * @param {string[]} [extraKeys] 一并失效的业务 cache key（如 packCover:xxx）
 * @returns {Promise<string>} 新 https 链；失败返回空串
 */
export async function resignTempUrl(fileId, extraKeys = []) {
  const id = String(fileId || '').trim();
  if (!id) return '';
  forgetTempUrl(id);
  (Array.isArray(extraKeys) ? extraKeys : []).forEach((k) => {
    const key = String(k || '').trim();
    if (key) forgetTempUrl(key);
  });
  try {
    const urls = await getTempFileURLs([id]);
    const next = String((urls && urls[0]) || '').trim();
    if (next) {
      rememberTempUrl(id, next);
      (Array.isArray(extraKeys) ? extraKeys : []).forEach((k) => {
        const key = String(k || '').trim();
        if (key) rememberTempUrl(key, next);
      });
    }
    return next;
  } catch (e) {
    return '';
  }
}
