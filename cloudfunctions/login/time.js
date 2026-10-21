const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Shanghai';

/** 云数据库 Date / Timestamp / 字符串 → 毫秒 */
function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  const t = dayjs(v).valueOf();
  return Number.isNaN(t) ? 0 : t;
}

/** VIP / 列表展示：YYYY-MM-DD HH:mm（上海时区；云函数默认 UTC） */
function formatDate(ms) {
  if (!ms) return '';
  const d = dayjs(ms);
  if (!d.isValid()) return '';
  return d.tz(TZ).format('YYYY-MM-DD HH:mm');
}

/** 订阅消息等：上海时区 YYYY-MM-DD HH:mm */
function formatDateTime(date) {
  return dayjs(date).tz(TZ).format('YYYY-MM-DD HH:mm');
}

/** 订阅消息中文时间：YYYY年MM月DD日 HH:mm */
function formatDateTimeCn(date) {
  return dayjs(date).tz(TZ).format('YYYY年MM月DD日 HH:mm');
}

module.exports = {
  dayjs,
  TZ,
  toMs,
  formatDate,
  formatDateTime,
  formatDateTimeCn,
};
