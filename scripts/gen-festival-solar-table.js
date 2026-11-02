/**
 * 预计算农历 / 节气 → 公历锚点，写入 utils/festivalSolarTable.js
 * 客户端不再打包 lunar-javascript（约 420KB）。
 *
 * 用法：node scripts/gen-festival-solar-table.js
 */
const fs = require('fs');
const path = require('path');
const { Solar, Lunar } = require('lunar-javascript');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'utils', 'festivalSolarTable.js');

/* 到期前一年起管理端会提示续表；续算时把 YEAR_END 往后推再跑本脚本 */
const YEAR_START = 2024;
const YEAR_END = 2036;

/** 与 FESTIVAL_PRESETS 中 lunar / jieqi 规则对齐 */
const LUNAR_DAYS = [
  [12, 8],
  [12, 23],
  [1, 1],
  [1, 15],
  [2, 2],
  [5, 5],
  [7, 7],
  [8, 15],
  [9, 9],
];
const JIEQI_NAMES = ['清明', '冬至'];

function pad2(n) {
  return `${Number(n)}`.padStart(2, '0');
}

function lunarKey(month, day) {
  return `${pad2(month)}-${pad2(day)}`;
}

function lunarSolar(lunarYear, lunarMonth, lunarDay) {
  const solar = Lunar.fromYmd(lunarYear, lunarMonth, lunarDay).getSolar();
  return [solar.getYear(), solar.getMonth(), solar.getDay()];
}

function findJieQi(year, name) {
  for (let month = 1; month <= 12; month += 1) {
    const dim = new Date(year, month, 0).getDate();
    for (let day = 1; day <= dim; day += 1) {
      const jq = Solar.fromYmd(year, month, day).getLunar().getJieQi();
      if (jq === name) return [year, month, day];
    }
  }
  return null;
}

const lunar = {};
LUNAR_DAYS.forEach(([m, d]) => {
  const key = lunarKey(m, d);
  lunar[key] = {};
  for (let y = YEAR_START; y <= YEAR_END; y += 1) {
    /* 农历年与公历年大致对齐：用公历 y 作为农历年查询，跨年由调用方 yearsNear 覆盖 */
    try {
      const [sy, sm, sd] = lunarSolar(y, m, d);
      lunar[key][y] = [sy, sm, sd];
    } catch (e) {
      /* 闰月等极端情况跳过 */
    }
  }
});

const jieqi = {};
JIEQI_NAMES.forEach((name) => {
  jieqi[name] = {};
  for (let y = YEAR_START; y <= YEAR_END; y += 1) {
    const hit = findJieQi(y, name);
    if (hit) jieqi[name][y] = hit;
  }
});

const body = `/**
 * 农历 / 节气 → 公历锚点（由 scripts/gen-festival-solar-table.js 生成）
 * 覆盖公历年 ${YEAR_START}–${YEAR_END}；勿手改。
 * @generated
 */
export const FESTIVAL_SOLAR_YEAR_START = ${YEAR_START};
export const FESTIVAL_SOLAR_YEAR_END = ${YEAR_END};

/** 农历月日 → { 农历年: [公历年, 月, 日] } */
export const LUNAR_TO_SOLAR = ${JSON.stringify(lunar, null, 2)};

/** 节气名 → { 公历年: [公历年, 月, 日] } */
export const JIEQI_TO_SOLAR = ${JSON.stringify(jieqi, null, 2)};
`;

fs.writeFileSync(OUT, body, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)}`);
console.log(
  `lunar keys=${Object.keys(lunar).length}, jieqi=${Object.keys(jieqi).length}, years=${YEAR_START}-${YEAR_END}`,
);
