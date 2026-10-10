import dayjs from 'dayjs';

/** @param {unknown} v */
export function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  const t = dayjs(v).valueOf();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * @param {unknown} msOrDate
 * @param {string} [fmt]
 */
export function formatDate(msOrDate, fmt = 'YYYY-MM-DD HH:mm') {
  if (msOrDate == null || msOrDate === '') return '';
  const d = dayjs(msOrDate);
  if (!d.isValid()) return '';
  return d.format(fmt);
}

/** 兼容旧 util.formatTime：YYYY/MM/DD HH:mm:ss */
export function formatTime(date) {
  return formatDate(date || new Date(), 'YYYY/MM/DD HH:mm:ss');
}

export { dayjs };
