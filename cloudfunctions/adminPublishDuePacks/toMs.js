/** 不依赖 dayjs，避免未装依赖时整个定时函数起不来 */

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? Math.floor(n) : 0;
  }
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (v && typeof v.toDate === 'function') {
    try {
      const t = v.toDate().getTime();
      return Number.isFinite(t) ? t : 0;
    } catch (e) {
      return 0;
    }
  }
  // 云开发偶发 { $date: ms } / { seconds }
  if (v && typeof v === 'object') {
    if (v.$date != null) return toMs(v.$date);
    if (v.seconds != null) {
      const sec = Number(v.seconds);
      if (Number.isFinite(sec)) return Math.floor(sec * 1000);
    }
  }
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

module.exports = { toMs };
