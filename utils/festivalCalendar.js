/**
 * 节日日期规则（本地计算，无网络）
 * 农历 / 节气锚点来自预计算表 utils/festivalSolarTable.js（不再打包 lunar-javascript）。
 */
import {
  FESTIVAL_SOLAR_YEAR_END,
  FESTIVAL_SOLAR_YEAR_START,
  JIEQI_TO_SOLAR,
  LUNAR_TO_SOLAR,
} from '~/utils/festivalSolarTable';

/** 到期前几年开始提醒管理员续表 */
const SOLAR_TABLE_WARN_YEARS_BEFORE = 1;

let _solarTableWarnedYear = 0;

/**
 * 农历对照表覆盖情况（表外年份农历/节气节日会匹配失败）
 * @param {number|Date} [now]
 */
export function getFestivalSolarTableCoverage(now = Date.now()) {
  const y = (now instanceof Date ? now : new Date(now)).getFullYear();
  const start = FESTIVAL_SOLAR_YEAR_START;
  const end = FESTIVAL_SOLAR_YEAR_END;
  const expired = y > end;
  const warning = y >= end - SOLAR_TABLE_WARN_YEARS_BEFORE;
  return { year: y, start, end, expired, warning };
}

/** 管理端文案；未临近到期时返回空串 */
export function getFestivalSolarTableAdminHint(now = Date.now()) {
  const c = getFestivalSolarTableCoverage(now);
  if (c.expired) {
    return `农历节日对照表只覆盖到 ${c.end} 年，现在是 ${c.year} 年，腊八/春节等农历节日可能对不上。请在电脑执行 npm run festival:solar 续表后重新发版。`;
  }
  if (c.warning) {
    return `农历节日对照表将于 ${c.end} 年到期（当前 ${c.year}）。请执行 npm run festival:solar 续算并发版，以免农历节日失效。`;
  }
  return '';
}

/** 每年最多打一次 console，避免刷屏 */
export function maybeWarnFestivalSolarTable(now = Date.now()) {
  const c = getFestivalSolarTableCoverage(now);
  if (!c.warning && !c.expired) return;
  if (_solarTableWarnedYear === c.year) return;
  _solarTableWarnedYear = c.year;
  const hint = getFestivalSolarTableAdminHint(now);
  if (hint) console.warn('[festival]', hint);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDate(y, m, day) {
  return new Date(y, m - 1, day);
}

function dayDiff(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

function inPadWindow(date, anchorY, anchorM, anchorD, padBefore, padAfter) {
  const before = Math.max(0, Number(padBefore) || 0);
  const after = Math.max(0, Number(padAfter) || 0);
  const diff = dayDiff(toDate(anchorY, anchorM, anchorD), date);
  return diff >= -before && diff <= after;
}

/** 西方复活节（Anonymous Gregorian） */
export function easterSunday(year) {
  const y = year;
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year: y, month, day };
}

/** 美国感恩节：11 月第四个周四 */
export function thanksgivingUS(year) {
  const first = new Date(year, 10, 1);
  const dow = first.getDay();
  const firstThu = 1 + ((4 - dow + 7) % 7);
  return { year, month: 11, day: firstThu + 21 };
}

function pad2(n) {
  return `${Number(n)}`.padStart(2, '0');
}

function lunarSolar(lunarYear, lunarMonth, lunarDay) {
  const key = `${pad2(lunarMonth)}-${pad2(lunarDay)}`;
  const row = LUNAR_TO_SOLAR[key];
  const hit = row && row[lunarYear];
  if (!hit) return null;
  return { year: hit[0], month: hit[1], day: hit[2] };
}

function findJieQiInYear(year, name) {
  const row = JIEQI_TO_SOLAR[name];
  const hit = row && row[year];
  if (!hit) return null;
  return { year: hit[0], month: hit[1], day: hit[2] };
}

function yearsNear(date) {
  const y = date.getFullYear();
  return [y - 1, y, y + 1];
}

function addDays(y, m, d, delta) {
  const dt = toDate(y, m, d);
  dt.setDate(dt.getDate() + delta);
  return {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
  };
}

/** 某月第 n 个星期几；weekday: 0=日 … 6=六；n 从 1 起 */
export function nthWeekdayOfMonth(year, month, weekday, n) {
  const wd = ((Number(weekday) % 7) + 7) % 7;
  const nth = Math.max(1, Number(n) || 1);
  const first = new Date(year, month - 1, 1);
  const firstDow = first.getDay();
  const day = 1 + ((wd - firstDow + 7) % 7) + (nth - 1) * 7;
  const dim = new Date(year, month, 0).getDate();
  if (day > dim) return null;
  return { year, month, day };
}

/** 农历正月初一的前一天 = 除夕 */
export function chuxiBeforeCny(lunarYear) {
  const cny = lunarSolar(lunarYear, 1, 1);
  if (!cny) return null;
  return addDays(cny.year, cny.month, cny.day, -1);
}

/**
 * @param {Date} date
 * @param {object} rule
 * @returns {boolean}
 */
export function matchFestivalRule(date, rule) {
  if (!rule || !date) return false;
  const padBefore = rule.padBefore != null ? rule.padBefore : rule.pad && rule.pad[0];
  const padAfter = rule.padAfter != null ? rule.padAfter : rule.pad && rule.pad[1];
  const before = padBefore != null ? padBefore : 0;
  const after = padAfter != null ? padAfter : 0;
  const type = rule.type;

  try {
    if (type === 'lunar') {
      const lm = Number(rule.month);
      const ld = Number(rule.day);
      return yearsNear(date).some((ly) => {
        const a = lunarSolar(ly, lm, ld);
        if (!a) return false;
        return inPadWindow(date, a.year, a.month, a.day, before, after);
      });
    }

    if (type === 'chuxi') {
      return yearsNear(date).some((ly) => {
        const a = chuxiBeforeCny(ly);
        if (!a) return false;
        return inPadWindow(date, a.year, a.month, a.day, before, after);
      });
    }

    if (type === 'jieqi') {
      const name = String(rule.name || '').trim();
      if (!name) return false;
      return yearsNear(date).some((y) => {
        const a = findJieQiInYear(y, name);
        if (!a) return false;
        return inPadWindow(date, a.year, a.month, a.day, before, after);
      });
    }

    if (type === 'solar') {
      const m = Number(rule.month);
      const d = Number(rule.day);
      return yearsNear(date).some((y) => inPadWindow(date, y, m, d, before, after));
    }

    if (type === 'nthWeekday') {
      const m = Number(rule.month);
      const wd = rule.weekday != null ? Number(rule.weekday) : 0;
      const n = Number(rule.nth) || 1;
      return yearsNear(date).some((y) => {
        const a = nthWeekdayOfMonth(y, m, wd, n);
        if (!a) return false;
        return inPadWindow(date, a.year, a.month, a.day, before, after);
      });
    }

    if (type === 'solarRange') {
      const [sm, sd] = rule.start || [];
      const [em, ed] = rule.end || [];
      if (!sm || !sd || !em || !ed) return false;
      const y = date.getFullYear();
      const key = dayKey(date);
      const startKey = `${y}-${pad2(sm)}-${pad2(sd)}`;
      const endKey = `${y}-${pad2(em)}-${pad2(ed)}`;
      if (startKey <= endKey) return key >= startKey && key <= endKey;
      /* 跨年：如 12-20 .. 01-05 */
      const prevStart = `${y - 1}-${pad2(sm)}-${pad2(sd)}`;
      const nextEnd = `${y + 1}-${pad2(em)}-${pad2(ed)}`;
      return (
        (key >= startKey && key <= `${y}-12-31`) ||
        (key >= `${y}-01-01` && key <= endKey) ||
        (key >= prevStart && key <= `${y - 1}-12-31`) ||
        (key >= `${y + 1}-01-01` && key <= nextEnd)
      );
    }

    if (type === 'easter') {
      return yearsNear(date).some((y) => {
        const a = easterSunday(y);
        return inPadWindow(date, a.year, a.month, a.day, before, after);
      });
    }

    if (type === 'thanksgiving') {
      return yearsNear(date).some((y) => {
        const a = thanksgivingUS(y);
        return inPadWindow(date, a.year, a.month, a.day, before, after);
      });
    }
  } catch (e) {
    return false;
  }
  return false;
}

function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function readPad(rule) {
  const padBefore = rule.padBefore != null ? rule.padBefore : rule.pad && rule.pad[0];
  const padAfter = rule.padAfter != null ? rule.padAfter : rule.pad && rule.pad[1];
  return {
    before: Math.max(0, Number(padBefore) || 0),
    after: Math.max(0, Number(padAfter) || 0),
  };
}

/** 解析 MM-DD / M-D / YYYY-MM-DD[ HH:mm] → { month, day } 或 null */
export function parseMonthDay(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const full = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{1,2})?$/);
  if (full) {
    const month = Number(full[2]);
    const day = Number(full[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day };
  }
  const md = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!md) return null;
  const month = Number(md[1]);
  const day = Number(md[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

export function toMonthDayKey(month, day) {
  return `${pad2(month)}-${pad2(day)}`;
}

export function formatMonthDayLabel(md) {
  const p = typeof md === 'string' ? parseMonthDay(md) : md;
  if (!p) return '';
  return `${p.month}/${p.day}`;
}

/** 解析 HH:mm；缺省时 start→00:00、end→23:59 */
export function parseHourMinute(raw, fallback) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return { hour: h, minute: min };
    }
  }
  const fb = String(fallback || '00:00');
  const fm = fb.match(/^(\d{1,2}):(\d{1,2})$/);
  if (fm) {
    return { hour: Number(fm[1]) || 0, minute: Number(fm[2]) || 0 };
  }
  return { hour: 0, minute: 0 };
}

export function toHourMinuteKey(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function formatMonthDayTimeLabel(md, hm) {
  const d = formatMonthDayLabel(md);
  if (!d) return '';
  const t = parseHourMinute(hm, '00:00');
  return `${d} ${toHourMinuteKey(t.hour, t.minute)}`;
}

function atLocalMs(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

/**
 * 公历月日 + 时分区间（可跨年），每年循环。
 * 默认开始 00:00、结束 23:59；同一天也可只开几个小时。
 */
export function matchMonthDayRange(date, startMd, endMd, startHm, endHm) {
  const a = parseMonthDay(startMd);
  const b = parseMonthDay(endMd);
  if (!a || !b || !date) return false;
  const st = parseHourMinute(startHm, '00:00');
  const et = parseHourMinute(endHm, '23:59');
  const now = date.getTime();
  const y = date.getFullYear();

  const startMdKey = toMonthDayKey(a.month, a.day);
  const endMdKey = toMonthDayKey(b.month, b.day);
  const sameDay = startMdKey === endMdKey;
  const crossYear = startMdKey > endMdKey;

  const inSpan = (sy, ey) => {
    const startMs = atLocalMs(sy, a.month, a.day, st.hour, st.minute);
    let endMs = atLocalMs(ey, b.month, b.day, et.hour, et.minute);
    /* 结束时分：包含该分钟整分 → 收到 :59 秒 */
    endMs += 59 * 1000 + 999;
    if (sameDay && endMs < startMs) {
      /* 同日结束时分早于开始：视为跨到次日 */
      endMs = atLocalMs(ey, b.month, b.day, et.hour, et.minute) + 86400000 + 59999;
    }
    return now >= startMs && now <= endMs;
  };

  if (!crossYear) {
    return inSpan(y, y) || inSpan(y - 1, y - 1) || inSpan(y + 1, y + 1);
  }
  /* 跨年：如 12-20 18:00 .. 01-05 09:00 */
  return (
    inSpan(y, y + 1) ||
    inSpan(y - 1, y) ||
    inSpan(y + 1, y + 2)
  );
}

/**
 * 根据内置 rule 算出某公历年的默认窗口（供管理端展示 / 恢复）
 * @returns {{ startMd: string, endMd: string, startYmd: string, endYmd: string } | null}
 */
export function getRuleWindowForYear(rule, year) {
  if (!rule) return null;
  const y = Number(year) || new Date().getFullYear();
  const { before, after } = readPad(rule);
  try {
    if (rule.type === 'solarRange') {
      const [sm, sd] = rule.start || [];
      const [em, ed] = rule.end || [];
      if (!sm || !sd || !em || !ed) return null;
      const startMd = toMonthDayKey(sm, sd);
      const endMd = toMonthDayKey(em, ed);
      const cross = startMd > endMd;
      return {
        startMd,
        endMd,
        startYmd: `${y}-${startMd}`,
        endYmd: `${cross ? y + 1 : y}-${endMd}`,
      };
    }

    let anchor = null;
    if (rule.type === 'lunar') {
      anchor = lunarSolar(y, Number(rule.month), Number(rule.day));
    } else if (rule.type === 'chuxi') {
      anchor = chuxiBeforeCny(y);
    } else if (rule.type === 'jieqi') {
      anchor = findJieQiInYear(y, String(rule.name || '').trim());
    } else if (rule.type === 'solar') {
      anchor = { year: y, month: Number(rule.month), day: Number(rule.day) };
    } else if (rule.type === 'nthWeekday') {
      anchor = nthWeekdayOfMonth(
        y,
        Number(rule.month),
        rule.weekday != null ? Number(rule.weekday) : 0,
        Number(rule.nth) || 1,
      );
    } else if (rule.type === 'easter') {
      anchor = easterSunday(y);
    } else if (rule.type === 'thanksgiving') {
      anchor = thanksgivingUS(y);
    }
    if (!anchor) return null;
    const start = addDays(anchor.year, anchor.month, anchor.day, -before);
    const end = addDays(anchor.year, anchor.month, anchor.day, after);
    return {
      startMd: toMonthDayKey(start.month, start.day),
      endMd: toMonthDayKey(end.month, end.day),
      startYmd: `${start.year}-${toMonthDayKey(start.month, start.day)}`,
      endYmd: `${end.year}-${toMonthDayKey(end.month, end.day)}`,
    };
  } catch (e) {
    return null;
  }
}
