/**
 * 节日 Theme Assets 系统
 * - 配置驱动；顶栏图由管理员上传到云（app_config/festival）
 * - 全局开启（云）：管理员打开后，普通用户才可开关
 * - 用户开关（本地）：是否展示节日效果
 * - 预览模式（本地）：仅管理员
 */

import { callFunction, getTempFileURLs } from '~/utils/cloud';
import {
  formatMonthDayLabel,
  getRuleWindowForYear,
  matchFestivalRule,
  matchMonthDayRange,
  parseMonthDay,
  toMonthDayKey,
} from '~/utils/festivalCalendar';

const MODE_KEY = 'festival_mode';
const USER_ON_KEY = 'festival_user_on';
/** 飘落范围：header（默认仅顶栏）| full（全屏） */
const FALL_SCOPE_KEY = 'festival_fall_scope';
const CLOUD_CACHE_KEY = 'festival_cloud_cache';

/**
 * 首页顶栏背景图规格（管理员按此尺寸/比例上传）
 * 仅覆盖导航栏（含状态栏），不含分类条。
 * 设计稿 750×200；真机按导航实际高度裁切（aspectFill）。
 */
export const FESTIVAL_BANNER_SPEC = {
  width: 750,
  height: 200,
  ratio: '75:20',
  fileName: 'banner.png',
};

/** 底栏背景图：宽屏短图，建议透明 PNG 异形装饰 */
export const FESTIVAL_BANK_SPEC = {
  width: 750,
  height: 160,
  ratio: '75:16',
  fileName: 'bank.png',
};

/**
 * @typedef {object} FestivalAssets
 * @property {string} [banner]
 * @property {string} [header]
 * @property {string} [bank]
 */

/**
 * @typedef {object} FestivalRule
 * @property {'lunar'|'chuxi'|'jieqi'|'solar'|'nthWeekday'|'solarRange'|'easter'|'thanksgiving'} type
 * @property {number} [month]
 * @property {number} [day]
 * @property {string} [name] 节气名，如「清明」
 * @property {number} [weekday] nthWeekday：0=日…6=六
 * @property {number} [nth] 第几个星期几
 * @property {number[]} [start] solarRange [月,日]
 * @property {number[]} [end]
 * @property {number} [padBefore] 锚点前几天
 * @property {number} [padAfter] 锚点后几天
 * @property {number[]} [pad] [before, after] 简写
 */

/**
 * @typedef {object} FestivalPreset
 * @property {string} id
 * @property {string} name
 * @property {string} tip
 * @property {FestivalRule} [rule] 日期规则（优先）
 * @property {string[]} [ranges] 兼容旧写死区间
 * @property {FestivalAssets} assets
 * @property {'none'|string} motion
 * @property {string[]} [motionIcons] IconPark 生成的粒子图路径
 * @property {string[]} [motionChars] 兼容旧字段，优先用 motionIcons
 * @property {string[]} [motionKinds]
 * @property {number} [motionCount]
 * @property {boolean} [lights]
 * @property {string} accent
 * @property {string} barBg
 * @property {string} navColor
 * @property {string[]} confettiColors
 * @property {string} [topicLabel]
 */

const P = {
  red: ['/static/festival/particles/red-packet.png', '/static/festival/particles/lantern.png', '/static/festival/particles/gift-box.png', '/static/festival/particles/star.png', '/static/festival/particles/magic.png'],
  lantern: ['/static/festival/particles/lantern.png', '/static/festival/particles/magic.png', '/static/festival/particles/star.png', '/static/festival/particles/gift-box.png'],
  heart: ['/static/festival/particles/heart.png', '/static/festival/particles/heart-soft.png', '/static/festival/particles/cherry.png', '/static/festival/particles/peach.png', '/static/festival/particles/flower.png'],
  flower: ['/static/festival/particles/flower.png', '/static/festival/particles/peach.png', '/static/festival/particles/cherry.png', '/static/festival/particles/heart-soft.png'],
  leaf: ['/static/festival/particles/leaf.png', '/static/festival/particles/tree.png', '/static/festival/particles/star.png', '/static/festival/particles/magic.png'],
  easter: ['/static/festival/particles/egg.png', '/static/festival/particles/rabbit.png', '/static/festival/particles/flower.png', '/static/festival/particles/magic.png'],
  labor: ['/static/festival/particles/flag.png', '/static/festival/particles/star.png', '/static/festival/particles/magic.png', '/static/festival/particles/gift.png'],
  youth: ['/static/festival/particles/flag.png', '/static/festival/particles/star.png', '/static/festival/particles/balloon.png', '/static/festival/particles/magic.png'],
  dragon: ['/static/festival/particles/bowl.png', '/static/festival/particles/rice.png', '/static/festival/particles/leaf.png', '/static/festival/particles/boat.png', '/static/festival/particles/star.png'],
  kids: ['/static/festival/particles/balloon.png', '/static/festival/particles/candy.png', '/static/festival/particles/star.png', '/static/festival/particles/gift.png', '/static/festival/particles/magic.png'],
  qixi: ['/static/festival/particles/heart-soft.png', '/static/festival/particles/bird.png', '/static/festival/particles/magic.png', '/static/festival/particles/peach.png', '/static/festival/particles/star.png'],
  moon: ['/static/festival/particles/cake.png', '/static/festival/particles/moon.png', '/static/festival/particles/rabbit.png', '/static/festival/particles/star.png', '/static/festival/particles/magic.png'],
  school: ['/static/festival/particles/book.png', '/static/festival/particles/ruler.png', '/static/festival/particles/pencil.png', '/static/festival/particles/apple.png', '/static/festival/particles/star.png'],
  national: ['/static/festival/particles/flag.png', '/static/festival/particles/star.png', '/static/festival/particles/magic.png', '/static/festival/particles/gift.png'],
  halloween: ['/static/festival/particles/pumpkin.png', '/static/festival/particles/bat.png', '/static/festival/particles/ghost.png', '/static/festival/particles/owl.png', '/static/festival/particles/candy.png'],
  thanks: ['/static/festival/particles/leaf.png', '/static/festival/particles/turkey.png', '/static/festival/particles/apple.png', '/static/festival/particles/magic.png'],
  snow: ['/static/festival/particles/snowflake.png', '/static/festival/particles/tree.png', '/static/festival/particles/gift.png', '/static/festival/particles/star.png', '/static/festival/particles/magic.png'],
  porridge: ['/static/festival/particles/bowl.png', '/static/festival/particles/rice.png', '/static/festival/particles/star.png', '/static/festival/particles/magic.png'],
};

/**
 * 跟随日期匹配：数组靠前优先（同日只生效一个）。
 * 窗口刻意收紧，避免除夕/春节、中秋/国庆等互相盖住；管理员仍可用「持续日期」覆盖。
 * @type {FestivalPreset[]}
 */
export const FESTIVAL_PRESETS = [
  /* —— 元旦 → 春节档 —— */
  {
    id: 'newyear',
    name: '元旦',
    tip: '元旦快乐',
    rule: { type: 'solar', month: 1, day: 1, padBefore: 0, padAfter: 1 },
    assets: {},
    motion: 'newyear',
    motionIcons: P.national,
    motionCount: 14,
    lights: false,
    accent: '#dc2626',
    barBg: 'rgba(254,242,242,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#dc2626', '#fbbf24', '#ffffff'],
    topicLabel: '元旦合集',
  },
  {
    id: 'laba',
    name: '腊八节',
    tip: '腊八暖胃',
    rule: { type: 'lunar', month: 12, day: 8, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'laba',
    motionIcons: P.porridge,
    motionCount: 12,
    lights: false,
    accent: '#b45309',
    barBg: 'rgba(255,251,235,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#b45309', '#d97706', '#fde68a'],
    topicLabel: '腊八合集',
  },
  {
    id: 'xiaonian',
    name: '小年',
    tip: '北方小年',
    rule: { type: 'lunar', month: 12, day: 23, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'xiaonian',
    motionIcons: P.red,
    motionCount: 12,
    lights: false,
    accent: '#e34d59',
    barBg: 'rgba(255,252,248,0.48)',
    navColor: '#ffffff',
    confettiColors: ['#e34d59', '#f59e0b', '#ffffff'],
    topicLabel: '小年合集',
  },
  {
    id: 'chuxi',
    name: '除夕',
    tip: '除夕夜',
    /* 仅除夕当天；春节从初一起，互不重叠 */
    rule: { type: 'chuxi', padBefore: 0, padAfter: 0 },
    assets: {
      header: '/static/festival/cny/header.png',
      bank: '/static/festival/cny/gold-bank.png',
    },
    motion: 'chuxi',
    motionIcons: P.red,
    motionCount: 16,
    lights: true,
    accent: '#e34d59',
    barBg: 'rgba(255,252,248,0.48)',
    navColor: '#ffffff',
    confettiColors: ['#e34d59', '#f59e0b', '#fde68a', '#ffffff'],
    topicLabel: '除夕合集',
  },
  {
    id: 'cny',
    name: '春节',
    tip: '新春氛围已开启',
    /* 初一～初六，不含除夕 */
    rule: { type: 'lunar', month: 1, day: 1, padBefore: 0, padAfter: 5 },
    assets: {
      header: '/static/festival/cny/header.png',
      bank: '/static/festival/cny/gold-bank.png',
    },
    motion: 'gold',
    motionIcons: P.red,
    motionCount: 16,
    lights: true,
    accent: '#e34d59',
    barBg: 'rgba(255,252,248,0.48)',
    navColor: '#ffffff',
    confettiColors: ['#e34d59', '#f59e0b', '#fde68a', '#ffffff', '#b45309'],
    topicLabel: '新春祝福合集',
  },
  {
    id: 'lantern',
    name: '元宵节',
    tip: '元宵灯火已点亮',
    rule: { type: 'lunar', month: 1, day: 15, padBefore: 0, padAfter: 1 },
    assets: {},
    motion: 'lantern',
    motionIcons: P.lantern,
    motionCount: 14,
    lights: false,
    accent: '#f59e0b',
    barBg: 'rgba(255,248,235,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#f59e0b', '#ef4444', '#fde68a', '#ffffff'],
    topicLabel: '元宵灯会合集',
  },
  {
    id: 'dragonhead',
    name: '龙抬头',
    tip: '二月二龙抬头',
    rule: { type: 'lunar', month: 2, day: 2, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'dragonhead',
    motionIcons: P.dragon,
    motionCount: 12,
    lights: false,
    accent: '#ca8a04',
    barBg: 'rgba(254,252,232,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#ca8a04', '#fbbf24', '#ffffff'],
    topicLabel: '龙抬头合集',
  },
  {
    id: 'valentine',
    name: '情人节',
    tip: '浪漫氛围已开启',
    rule: { type: 'solar', month: 2, day: 14, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'hearts-valentine',
    motionIcons: P.heart,
    motionCount: 16,
    lights: false,
    accent: '#e11d48',
    barBg: 'rgba(255,241,242,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#e11d48', '#fb7185', '#fda4af', '#ffffff'],
    topicLabel: '情人节合集',
  },
  {
    id: 'women',
    name: '妇女节',
    tip: '女神节氛围已开启',
    rule: { type: 'solar', month: 3, day: 8, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'flowers',
    motionIcons: P.flower,
    motionCount: 14,
    lights: false,
    accent: '#db2777',
    barBg: 'rgba(253,242,248,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#db2777', '#f9a8d4', '#fbcfe8', '#ffffff'],
    topicLabel: '女神节合集',
  },
  {
    id: 'tree',
    name: '植树节',
    tip: '植树造林',
    rule: { type: 'solar', month: 3, day: 12, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'tree',
    motionIcons: P.leaf,
    motionCount: 12,
    lights: false,
    accent: '#16a34a',
    barBg: 'rgba(240,253,244,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#16a34a', '#86efac', '#ffffff'],
    topicLabel: '植树节合集',
  },
  {
    id: 'qingming',
    name: '清明节',
    tip: '清明氛围已开启',
    rule: { type: 'jieqi', name: '清明', padBefore: 0, padAfter: 1 },
    assets: {},
    motion: 'none',
    motionIcons: [],
    motionCount: 0,
    lights: false,
    accent: '#64748b',
    barBg: 'rgba(248,250,252,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#94a3b8', '#cbd5e1', '#e2e8f0'],
    topicLabel: '清明合集',
  },
  {
    id: 'easter',
    name: '复活节',
    tip: '复活节氛围已开启',
    rule: { type: 'easter', padBefore: 0, padAfter: 1 },
    assets: {},
    motion: 'easter',
    motionIcons: P.easter,
    motionCount: 14,
    lights: false,
    accent: '#a78bfa',
    barBg: 'rgba(245,243,255,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#a78bfa', '#86efac', '#fde68a', '#ffffff'],
    topicLabel: '复活节合集',
  },
  {
    id: 'labor',
    name: '劳动节',
    tip: '劳动最光荣',
    rule: { type: 'solar', month: 5, day: 1, padBefore: 0, padAfter: 2 },
    assets: {},
    motion: 'labor',
    motionIcons: P.labor,
    motionCount: 14,
    lights: false,
    accent: '#dc2626',
    barBg: 'rgba(254,242,242,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#dc2626', '#fbbf24', '#ffffff'],
    topicLabel: '劳动节合集',
  },
  {
    id: 'youth',
    name: '青年节',
    tip: '五四青年节',
    rule: { type: 'solar', month: 5, day: 4, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'youth',
    motionIcons: P.youth,
    motionCount: 12,
    lights: false,
    accent: '#ea580c',
    barBg: 'rgba(255,247,237,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#ea580c', '#fbbf24', '#ffffff'],
    topicLabel: '青年节合集',
  },
  {
    id: 'mothers',
    name: '母亲节',
    tip: '感恩母亲',
    rule: { type: 'nthWeekday', month: 5, weekday: 0, nth: 2, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'mothers',
    motionIcons: P.flower,
    motionCount: 14,
    lights: false,
    accent: '#db2777',
    barBg: 'rgba(253,242,248,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#db2777', '#f9a8d4', '#ffffff'],
    topicLabel: '母亲节合集',
  },
  {
    id: 'day520',
    name: '520',
    tip: '我爱你',
    rule: { type: 'solar', month: 5, day: 20, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'day520',
    motionIcons: P.heart,
    motionCount: 16,
    lights: false,
    accent: '#e11d48',
    barBg: 'rgba(255,241,242,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#e11d48', '#fb7185', '#ffffff'],
    topicLabel: '520 合集',
  },
  {
    id: 'dragonboat',
    name: '端午节',
    tip: '端午氛围已开启',
    rule: { type: 'lunar', month: 5, day: 5, padBefore: 0, padAfter: 1 },
    assets: {},
    motion: 'dragonboat',
    motionIcons: P.dragon,
    motionCount: 14,
    lights: false,
    accent: '#16a34a',
    barBg: 'rgba(240,253,244,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#16a34a', '#86efac', '#fbbf24', '#ffffff'],
    topicLabel: '端午合集',
  },
  {
    id: 'children',
    name: '儿童节',
    tip: '儿童节氛围已开启',
    rule: { type: 'solar', month: 6, day: 1, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'stars',
    motionIcons: P.kids,
    motionCount: 14,
    lights: false,
    accent: '#3b82f6',
    barBg: 'rgba(239,246,255,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#3b82f6', '#f472b6', '#fbbf24', '#ffffff'],
    topicLabel: '儿童节合集',
  },
  {
    id: 'fathers',
    name: '父亲节',
    tip: '感恩父亲',
    rule: { type: 'nthWeekday', month: 6, weekday: 0, nth: 3, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'fathers',
    motionIcons: P.school,
    motionCount: 12,
    lights: false,
    accent: '#0369a1',
    barBg: 'rgba(240,249,255,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#0369a1', '#38bdf8', '#ffffff'],
    topicLabel: '父亲节合集',
  },
  {
    id: 'party',
    name: '建党节',
    tip: '七一建党节',
    rule: { type: 'solar', month: 7, day: 1, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'party',
    motionIcons: P.national,
    motionCount: 14,
    lights: false,
    accent: '#dc2626',
    barBg: 'rgba(254,242,242,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#dc2626', '#fbbf24', '#ffffff'],
    topicLabel: '建党节合集',
  },
  {
    id: 'qixi',
    name: '七夕节',
    tip: '七夕氛围已开启',
    rule: { type: 'lunar', month: 7, day: 7, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'hearts-qixi',
    motionIcons: P.qixi,
    motionCount: 14,
    lights: false,
    accent: '#be185d',
    barBg: 'rgba(255,241,242,0.48)',
    navColor: '#ffffff',
    confettiColors: ['#be185d', '#f9a8d4', '#fbbf24', '#ffffff'],
    topicLabel: '七夕合集',
  },
  {
    id: 'army',
    name: '建军节',
    tip: '八一建军节',
    rule: { type: 'solar', month: 8, day: 1, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'army',
    motionIcons: P.national,
    motionCount: 14,
    lights: false,
    accent: '#166534',
    barBg: 'rgba(240,253,244,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#166534', '#fbbf24', '#ffffff'],
    topicLabel: '建军节合集',
  },
  {
    id: 'midautumn',
    name: '中秋节',
    tip: '中秋氛围已开启',
    /* 仅当天（+1）；排在国庆前，撞上国庆黄金周时中秋优先 */
    rule: { type: 'lunar', month: 8, day: 15, padBefore: 0, padAfter: 1 },
    assets: {},
    motion: 'moon',
    motionIcons: P.moon,
    motionCount: 14,
    lights: false,
    accent: '#d97706',
    barBg: 'rgba(255,251,235,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#d97706', '#fbbf24', '#fde68a', '#ffffff'],
    topicLabel: '中秋合集',
  },
  {
    id: 'teacher',
    name: '教师节',
    tip: '教师节氛围已开启',
    rule: { type: 'solar', month: 9, day: 10, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'school',
    motionIcons: P.school,
    motionCount: 12,
    lights: false,
    accent: '#0d9488',
    barBg: 'rgba(240,253,250,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#0d9488', '#5eead4', '#fbbf24', '#ffffff'],
    topicLabel: '教师节合集',
  },
  {
    id: 'chongyang',
    name: '重阳节',
    tip: '九九重阳',
    rule: { type: 'lunar', month: 9, day: 9, padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'chongyang',
    motionIcons: P.flower,
    motionCount: 12,
    lights: false,
    accent: '#c2410c',
    barBg: 'rgba(255,247,237,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#c2410c', '#fdba74', '#ffffff'],
    topicLabel: '重阳合集',
  },
  {
    id: 'national',
    name: '国庆节',
    tip: '国庆氛围已开启',
    rule: { type: 'solarRange', start: [10, 1], end: [10, 7] },
    assets: {},
    motion: 'national',
    motionIcons: P.national,
    motionCount: 16,
    lights: false,
    accent: '#dc2626',
    barBg: 'rgba(254,242,242,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#dc2626', '#fbbf24', '#ffffff', '#ef4444'],
    topicLabel: '国庆合集',
  },
  {
    id: 'halloween',
    name: '万圣节',
    tip: '万圣氛围已开启',
    rule: { type: 'solar', month: 10, day: 31, padBefore: 1, padAfter: 0 },
    assets: {},
    motion: 'halloween',
    motionIcons: P.halloween,
    motionCount: 14,
    lights: false,
    accent: '#ea580c',
    barBg: 'rgba(255,247,237,0.45)',
    navColor: '#ffffff',
    confettiColors: ['#ea580c', '#7c3aed', '#fbbf24', '#171717'],
    topicLabel: '万圣节合集',
  },
  {
    id: 'thanksgiving',
    name: '感恩节',
    tip: '感恩氛围已开启',
    rule: { type: 'thanksgiving', padBefore: 0, padAfter: 1 },
    assets: {},
    motion: 'leaves',
    motionIcons: P.thanks,
    motionCount: 12,
    lights: false,
    accent: '#b45309',
    barBg: 'rgba(255,251,235,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#b45309', '#d97706', '#fbbf24'],
    topicLabel: '感恩节合集',
  },
  {
    id: 'dongzhi',
    name: '冬至',
    tip: '冬至一阳生',
    rule: { type: 'jieqi', name: '冬至', padBefore: 0, padAfter: 0 },
    assets: {},
    motion: 'dongzhi',
    motionIcons: P.porridge,
    motionCount: 12,
    lights: false,
    accent: '#1d4ed8',
    barBg: 'rgba(239,246,255,0.5)',
    navColor: '#ffffff',
    confettiColors: ['#1d4ed8', '#93c5fd', '#ffffff'],
    topicLabel: '冬至合集',
  },
  {
    id: 'christmas',
    name: '圣诞节',
    tip: '圣诞氛围已开启',
    /* 收窄到圣诞周，避免占满整个 12 月 */
    rule: { type: 'solarRange', start: [12, 22], end: [12, 26] },
    assets: {
      header: '/static/festival/christmas/header.png',
      bank: '/static/festival/christmas/snow-bank.png',
    },
    motion: 'snowfall',
    motionIcons: P.snow,
    motionCount: 20,
    lights: true,
    accent: '#c41e3a',
    barBg: 'rgba(255,255,255,0.45)',
    navColor: '#ffffff',
    confettiColors: ['#c41e3a', '#165b33', '#f0e6d2', '#fbbf24', '#ffffff'],
    topicLabel: '圣诞聊天合集',
  },
];

const MODE_OPTIONS = [
  { id: 'auto', name: '跟随日期' },
  { id: 'off', name: '关闭' },
  ...FESTIVAL_PRESETS.map((p) => ({ id: p.id, name: p.name })),
];

function dayKey(d) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inRange(key, range) {
  const parts = String(range || '').split('..');
  if (parts.length !== 2) return false;
  return key >= parts[0] && key <= parts[1];
}

function matchPreset(preset, date) {
  if (typeof preset.match === 'function') {
    try {
      return !!preset.match(date);
    } catch (e) {
      return false;
    }
  }
  /* 云端自定义公历区间优先（每年循环） */
  const win = getFestivalWindowOverrides()[preset.id];
  if (win && win.start && win.end) {
    return matchMonthDayRange(date, win.start, win.end);
  }
  if (preset.rule) {
    return matchFestivalRule(date, preset.rule);
  }
  const key = dayKey(date);
  return (preset.ranges || []).some((r) => inRange(key, r));
}

function emitFestivalChange() {
  try {
    const app = getApp();
    if (app && app.eventBus) {
      app.eventBus.emit('festivalChange', getFestivalStatus());
    }
  } catch (e) {
    /* ignore */
  }
}

/** —— 云端缓存 —— */
function pickFileMap(src) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  Object.keys(src).forEach((k) => {
    const v = String(src[k] || '').trim();
    if (v) out[k] = v;
  });
  return out;
}

/** @returns {{ start: string, end: string } | null} start/end 为 MM-DD */
function pickWindowEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = parseMonthDay(raw.start);
  const end = parseMonthDay(raw.end);
  if (!start || !end) return null;
  return {
    start: toMonthDayKey(start.month, start.day),
    end: toMonthDayKey(end.month, end.day),
  };
}

function pickWindowMap(src) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  Object.keys(src).forEach((k) => {
    const w = pickWindowEntry(src[k]);
    if (w) out[k] = w;
  });
  return out;
}

export function getFestivalCloudCache() {
  try {
    const raw = wx.getStorageSync(CLOUD_CACHE_KEY);
    if (raw && typeof raw === 'object') {
      return {
        enabled: !!raw.enabled,
        banners: pickFileMap(raw.banners),
        banks: pickFileMap(raw.banks),
        windows: pickWindowMap(raw.windows),
      };
    }
  } catch (e) {
    /* ignore */
  }
  return { enabled: false, banners: {}, banks: {}, windows: {} };
}

function setFestivalCloudCache(doc) {
  const next = {
    enabled: !!(doc && doc.enabled),
    banners: pickFileMap(doc && doc.banners),
    banks: pickFileMap(doc && doc.banks),
    windows: pickWindowMap(doc && doc.windows),
  };
  try {
    wx.setStorageSync(CLOUD_CACHE_KEY, next);
  } catch (e) {
    /* ignore */
  }
  return next;
}

/** 拉取云端配置；失败时保留本地缓存 */
export async function loadFestivalConfig({ silent } = {}) {
  try {
    const res = await callFunction('festivalConfig', { action: 'get' });
    const data = (res && res.data) || {};
    setFestivalCloudCache(data);
    emitFestivalChange();
    return getFestivalCloudCache();
  } catch (e) {
    if (!silent) {
      console.warn('[festival] load config fail', e && e.message);
    }
    return getFestivalCloudCache();
  }
}

export function isFestivalFeatureEnabled() {
  return !!getFestivalCloudCache().enabled;
}

export async function setFestivalFeatureEnabled(on) {
  const res = await callFunction('festivalConfig', {
    action: 'setEnabled',
    enabled: !!on,
  });
  const cache = getFestivalCloudCache();
  setFestivalCloudCache(
    (res && res.data) || {
      enabled: !!on,
      banners: cache.banners,
      banks: cache.banks,
      windows: cache.windows,
    },
  );
  emitFestivalChange();
  return isFestivalFeatureEnabled();
}

/** 普通用户本地开关（默认开；仅当全局开启时生效） */
export function isFestivalUserOn() {
  try {
    const v = wx.getStorageSync(USER_ON_KEY);
    if (v === false || v === '0' || v === 0) return false;
  } catch (e) {
    /* ignore */
  }
  return true;
}

export function setFestivalUserOn(on) {
  try {
    wx.setStorageSync(USER_ON_KEY, !!on);
  } catch (e) {
    /* ignore */
  }
  emitFestivalChange();
  return !!on;
}

/** 飘落范围：默认仅顶栏导航区 */
export function getFestivalFallScope() {
  try {
    const v = String(wx.getStorageSync(FALL_SCOPE_KEY) || '').trim();
    if (v === 'full' || v === 'header') return v;
  } catch (e) {
    /* ignore */
  }
  return 'header';
}

export function isFestivalFallFull() {
  return getFestivalFallScope() === 'full';
}

export function setFestivalFallScope(scope) {
  const next = scope === 'full' ? 'full' : 'header';
  try {
    wx.setStorageSync(FALL_SCOPE_KEY, next);
  } catch (e) {
    /* ignore */
  }
  emitFestivalChange();
  return next;
}

export function setFestivalFallFull(on) {
  return setFestivalFallScope(on ? 'full' : 'header');
}

/** @deprecated 兼容旧调用：等同用户开关 */
export function isFestivalFxOn() {
  return isFestivalUserOn();
}

/** @deprecated */
export function setFestivalFxOn(on) {
  return setFestivalUserOn(on);
}

export function getFestivalModeOptions() {
  return MODE_OPTIONS.slice();
}

export function getFestivalMode() {
  try {
    const v = String(wx.getStorageSync(MODE_KEY) || 'auto').trim();
    if (v === 'off' || v === 'auto') return v;
    if (FESTIVAL_PRESETS.some((p) => p.id === v)) return v;
  } catch (e) {
    /* ignore */
  }
  return 'auto';
}

export function setFestivalMode(mode) {
  const next = String(mode || 'auto').trim() || 'auto';
  const ok =
    next === 'auto' ||
    next === 'off' ||
    FESTIVAL_PRESETS.some((p) => p.id === next);
  const value = ok ? next : 'auto';
  try {
    wx.setStorageSync(MODE_KEY, value);
  } catch (e) {
    /* ignore */
  }
  emitFestivalChange();
  return value;
}

/** 普通用户强制跟随日期，不可保留管理员预览态 */
export function ensureFestivalModeForRole(isAdmin) {
  if (isAdmin) return getFestivalMode();
  if (getFestivalMode() !== 'auto') return setFestivalMode('auto');
  return 'auto';
}

export function getFestivalPreset(id) {
  return FESTIVAL_PRESETS.find((p) => p.id === id) || null;
}

function isAdminPreviewClient() {
  try {
    /* 与 auth.resolveIsAdmin 对齐：预览普通用户时不绕过全员开关 */
    if (wx.getStorageSync('preview_as_user')) return false;
    const app = getApp();
    if (app && app.globalData && app.globalData.isAdmin) return true;
  } catch (e) {
    /* ignore */
  }
  return false;
}

/**
 * 当前生效节日
 * - 管理员预览（mode=具体节日）：无视全局开关
 * - 管理员 + 跟随日期：可本机预览匹配结果（仍受「开启节日效果」约束）
 * - mode=off：关闭
 * - 普通用户：需全局开启 + 用户开关 + 日期匹配
 */
export function getActiveFestival(now = Date.now()) {
  const mode = getFestivalMode();
  if (mode === 'off') return null;
  if (mode !== 'auto') return getFestivalPreset(mode);

  const adminPreview = isAdminPreviewClient();
  if (!adminPreview && !isFestivalFeatureEnabled()) return null;
  if (!isFestivalUserOn()) return null;

  const date = now instanceof Date ? now : new Date(now);
  for (let i = 0; i < FESTIVAL_PRESETS.length; i += 1) {
    if (matchPreset(FESTIVAL_PRESETS[i], date)) return FESTIVAL_PRESETS[i];
  }
  return null;
}

export function getFestivalStatus(now = Date.now()) {
  const mode = getFestivalMode();
  const active = getActiveFestival(now);
  const modeOpt = MODE_OPTIONS.find((o) => o.id === mode);
  const featureOn = isFestivalFeatureEnabled();
  const userOn = isFestivalUserOn();
  const adminPreview = isAdminPreviewClient();
  let note = '';
  if (!featureOn && mode === 'auto' && !adminPreview) {
    note = '近期暂无节日活动';
  } else if (!userOn && mode === 'auto') {
    note = '已关闭节日效果';
  } else if (active) {
    note = active.tip;
  } else if (mode === 'off') {
    note = '节日装饰已关闭';
  } else if (!featureOn && mode === 'auto' && adminPreview) {
    note = '本机可预览；用户需先开全员可见';
  } else {
    note = '当前不在节日窗口';
  }
  return {
    mode,
    modeLabel: (modeOpt && modeOpt.name) || '跟随日期',
    featureOn,
    userOn,
    fxOn: userOn,
    active,
    activeId: active ? active.id : '',
    activeName: active ? active.name : '无',
    note,
  };
}

export function getFestivalConfettiColors(now = Date.now()) {
  const f = getActiveFestival(now);
  return f && f.confettiColors ? f.confettiColors.slice() : null;
}

export function getFestivalConfig(now = Date.now()) {
  const f = getActiveFestival(now);
  if (!f) {
    return {
      id: '',
      motion: false,
      lights: false,
      barBg: '',
      navColor: '',
    };
  }
  return {
    id: f.id,
    name: f.name,
    motion: !!(f.motion && f.motion !== 'none'),
    lights: !!f.lights,
    barBg: f.barBg || '',
    navColor: f.navColor || '',
    accent: f.accent || '',
  };
}

export function getFestivalBannerOverrides() {
  return getFestivalCloudCache().banners || {};
}

export function getFestivalBankOverrides() {
  return getFestivalCloudCache().banks || {};
}

export function getFestivalWindowOverrides() {
  return getFestivalCloudCache().windows || {};
}

/**
 * 管理端：某节日当前生效窗口（自定义或规则默认）
 * @returns {{ custom: boolean, startMd: string, endMd: string, label: string, defaultLabel: string, pickerStart: string, pickerEnd: string }}
 */
export function getFestivalWindowInfo(festivalId, now = Date.now()) {
  const id = String(festivalId || '').trim();
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const preset = getFestivalPreset(id);
  const def = preset && preset.rule ? getRuleWindowForYear(preset.rule, year) : null;
  const custom = id ? getFestivalWindowOverrides()[id] : null;
  const startMd = (custom && custom.start) || (def && def.startMd) || '';
  const endMd = (custom && custom.end) || (def && def.endMd) || '';
  const startLabel = startMd ? formatMonthDayLabel(startMd) : '选择';
  const endLabel = endMd ? formatMonthDayLabel(endMd) : '选择';
  const label =
    startMd && endMd ? `${startLabel} – ${endLabel}` : '未设置';
  const defaultLabel =
    def && def.startMd && def.endMd
      ? `${formatMonthDayLabel(def.startMd)} – ${formatMonthDayLabel(def.endMd)}`
      : '';
  const pickerStart = startMd
    ? `${year}-${startMd}`
    : def && def.startYmd
      ? def.startYmd
      : `${year}-01-01`;
  let pickerEnd = endMd ? `${year}-${endMd}` : (def && def.endYmd) || `${year}-12-31`;
  /* 跨年：结束月日早于开始时，结束落在次年 */
  if (startMd && endMd && endMd < startMd) {
    pickerEnd = `${year + 1}-${endMd}`;
  } else if (def && def.endYmd && def.startYmd && def.endYmd < def.startYmd && !custom) {
    pickerEnd = def.endYmd;
  }
  return {
    custom: !!custom,
    startMd,
    endMd,
    startLabel,
    endLabel,
    label,
    defaultLabel,
    pickerStart,
    pickerEnd,
  };
}

export async function saveFestivalWindow(festivalId, startRaw, endRaw) {
  const start = parseMonthDay(startRaw);
  const end = parseMonthDay(endRaw);
  if (!festivalId || !start || !end) {
    throw new Error('请选择完整起止日期');
  }
  const res = await callFunction('festivalConfig', {
    action: 'setWindow',
    festivalId,
    start: toMonthDayKey(start.month, start.day),
    end: toMonthDayKey(end.month, end.day),
  });
  setFestivalCloudCache((res && res.data) || getFestivalCloudCache());
  emitFestivalChange();
  return getFestivalWindowOverrides();
}

export async function clearFestivalWindow(festivalId) {
  const res = await callFunction('festivalConfig', {
    action: 'clearWindow',
    festivalId,
  });
  setFestivalCloudCache((res && res.data) || getFestivalCloudCache());
  emitFestivalChange();
  return getFestivalWindowOverrides();
}

/** 上传/清除后丢掉临时链缓存，强制下次换新签 */
export function invalidateFestivalSrcCache(fileID) {
  const id = String(fileID || '').trim();
  if (id && _tempUrlCache[id]) delete _tempUrlCache[id];
}

export async function saveFestivalBanner(festivalId, fileID) {
  const prev = getFestivalBannerOverrides()[festivalId];
  if (prev) invalidateFestivalSrcCache(prev);
  const res = await callFunction('festivalConfig', {
    action: 'setBanner',
    festivalId,
    fileID,
  });
  setFestivalCloudCache((res && res.data) || getFestivalCloudCache());
  emitFestivalChange();
  return getFestivalBannerOverrides();
}

export async function clearFestivalBanner(festivalId) {
  const prev = getFestivalBannerOverrides()[festivalId];
  if (prev) invalidateFestivalSrcCache(prev);
  const res = await callFunction('festivalConfig', {
    action: 'clearBanner',
    festivalId,
  });
  setFestivalCloudCache((res && res.data) || getFestivalCloudCache());
  emitFestivalChange();
  return getFestivalBannerOverrides();
}

export async function saveFestivalBank(festivalId, fileID) {
  const prev = getFestivalBankOverrides()[festivalId];
  if (prev) invalidateFestivalSrcCache(prev);
  const res = await callFunction('festivalConfig', {
    action: 'setBank',
    festivalId,
    fileID,
  });
  setFestivalCloudCache((res && res.data) || getFestivalCloudCache());
  emitFestivalChange();
  return getFestivalBankOverrides();
}

export async function clearFestivalBank(festivalId) {
  const prev = getFestivalBankOverrides()[festivalId];
  if (prev) invalidateFestivalSrcCache(prev);
  const res = await callFunction('festivalConfig', {
    action: 'clearBank',
    festivalId,
  });
  setFestivalCloudCache((res && res.data) || getFestivalCloudCache());
  emitFestivalChange();
  return getFestivalBankOverrides();
}

export function getFestivalAssets(festivalId) {
  const f = getFestivalPreset(festivalId) || getActiveFestival();
  if (!f) return {};
  const id = f.id || festivalId;
  const bannerOverrides = getFestivalBannerOverrides();
  const bankOverrides = getFestivalBankOverrides();
  const banner = (id && bannerOverrides[id]) || '';
  const bank =
    (id && bankOverrides[id]) || (f.assets && f.assets.bank) || '';
  return {
    banner,
    header: (f.assets && f.assets.header) || '',
    bank,
  };
}

export function isCloudFileId(src) {
  return /^cloud:\/\//.test(String(src || '').trim());
}

/** 云文件临时链内存缓存，避免切 tab 反复换签导致图片闪白重载 */
const _tempUrlCache = Object.create(null);
const TEMP_URL_TTL_MS = 90 * 60 * 1000;

function readTempUrlCache(fileID) {
  const hit = _tempUrlCache[fileID];
  if (!hit || !hit.url) return '';
  if (hit.expireAt && hit.expireAt <= Date.now()) {
    delete _tempUrlCache[fileID];
    return '';
  }
  return hit.url;
}

function writeTempUrlCache(fileID, url) {
  const u = String(url || '').trim();
  if (!fileID || !u) return '';
  _tempUrlCache[fileID] = { url: u, expireAt: Date.now() + TEMP_URL_TTL_MS };
  return u;
}

/** 解析单个路径：本地/https 原样返回；cloud:// 走缓存或批量换签 */
export async function resolveFestivalSrc(src) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (!isCloudFileId(raw)) return raw;
  const cached = readTempUrlCache(raw);
  if (cached) return cached;
  try {
    const urls = await getTempFileURLs([raw]);
    return writeTempUrlCache(raw, urls[0] || '');
  } catch (e) {
    return '';
  }
}

/** 批量解析，优先命中缓存，未命中再一次换签 */
export async function resolveFestivalSrcs(srcs = []) {
  const list = (srcs || []).map((s) => String(s || '').trim());
  const out = list.map(() => '');
  const missIds = [];
  const missIdx = [];
  list.forEach((raw, i) => {
    if (!raw) return;
    if (!isCloudFileId(raw)) {
      out[i] = raw;
      return;
    }
    const cached = readTempUrlCache(raw);
    if (cached) {
      out[i] = cached;
      return;
    }
    missIds.push(raw);
    missIdx.push(i);
  });
  if (!missIds.length) return out;
  try {
    const urls = await getTempFileURLs(missIds);
    missIds.forEach((id, j) => {
      out[missIdx[j]] = writeTempUrlCache(id, urls[j] || '');
    });
  } catch (e) {
    /* leave empty */
  }
  return out;
}

export function getFestivalBannerAdminItems() {
  const overrides = getFestivalBannerOverrides();
  return FESTIVAL_PRESETS.map((p) => {
    const override = String((overrides && overrides[p.id]) || '').trim();
    return {
      id: p.id,
      name: p.name,
      override,
      hasCustom: !!override,
    };
  });
}

export function getFestivalBankAdminItems() {
  const overrides = getFestivalBankOverrides();
  return FESTIVAL_PRESETS.map((p) => {
    const override = String((overrides && overrides[p.id]) || '').trim();
    const fallback = String((p.assets && p.assets.bank) || '').trim();
    return {
      id: p.id,
      name: p.name,
      override,
      fallback,
      hasCustom: !!override,
    };
  });
}

export function getMotionChars(festivalId) {
  const f = getFestivalPreset(festivalId) || getActiveFestival();
  return f && Array.isArray(f.motionChars) ? f.motionChars.slice() : [];
}

export function getMotionKinds(festivalId) {
  const f = getFestivalPreset(festivalId) || getActiveFestival();
  return f && Array.isArray(f.motionKinds) ? f.motionKinds.slice() : [];
}

/** IconPark 粒子图列表 */
export function getMotionIcons(festivalId) {
  const f = getFestivalPreset(festivalId) || getActiveFestival();
  return f && Array.isArray(f.motionIcons) ? f.motionIcons.filter(Boolean) : [];
}
