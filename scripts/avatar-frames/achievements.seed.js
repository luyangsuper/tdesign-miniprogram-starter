/**
 * 默认成就表（与云函数 userAchievement/achievements.js 保持一致）。
 * 导入脚本会写入 app_config/achievements；若云端已有 defs 则不覆盖绑定。
 */

const ACHIEVEMENT_DEFS = [
  {
    id: 'checkin_streak_3',
    type: 'checkin_streak',
    threshold: 3,
    title: '初来报到',
    desc: '连续签到 3 天',
  },
  {
    id: 'checkin_streak_7',
    type: 'checkin_streak',
    threshold: 7,
    title: '一周打卡',
    desc: '连续签到 7 天',
  },
  {
    id: 'checkin_streak_14',
    type: 'checkin_streak',
    threshold: 14,
    title: '两周坚持',
    desc: '连续签到 14 天',
  },
  {
    id: 'checkin_streak_30',
    type: 'checkin_streak',
    threshold: 30,
    title: '月度达人',
    desc: '连续签到 30 天',
  },
  {
    id: 'checkin_streak_60',
    type: 'checkin_streak',
    threshold: 60,
    title: '长久粉',
    desc: '连续签到 60 天',
  },
  {
    id: 'checkin_streak_100',
    type: 'checkin_streak',
    threshold: 100,
    title: '百日成就',
    desc: '连续签到 100 天',
  },
  {
    id: 'download_total_1',
    type: 'download_total',
    threshold: 1,
    title: '初次保存',
    desc: '累计下载 1 次',
  },
  {
    id: 'download_total_10',
    type: 'download_total',
    threshold: 10,
    title: '小有收获',
    desc: '累计下载 10 次',
  },
  {
    id: 'download_total_50',
    type: 'download_total',
    threshold: 50,
    title: '收藏家',
    desc: '累计下载 50 次',
  },
  {
    id: 'download_total_100',
    type: 'download_total',
    threshold: 100,
    title: '百次下载',
    desc: '累计下载 100 次',
  },
  {
    id: 'download_total_300',
    type: 'download_total',
    threshold: 300,
    title: '资深玩家',
    desc: '累计下载 300 次',
  },
  {
    id: 'download_total_1000',
    type: 'download_total',
    threshold: 1000,
    title: '下载大师',
    desc: '累计下载 1000 次',
  },
  {
    id: 'first_pay',
    type: 'first_pay',
    threshold: 1,
    title: '首次支持',
    desc: '完成第一笔付费',
  },
  {
    id: 'paid_total_100',
    type: 'paid_total',
    threshold: 100,
    title: '小额打赏',
    desc: '累计付费满 ¥1',
  },
  {
    id: 'paid_total_500',
    type: 'paid_total',
    threshold: 500,
    title: '热情支持',
    desc: '累计付费满 ¥5',
  },
  {
    id: 'paid_total_900',
    type: 'paid_total',
    threshold: 900,
    title: '包月同行',
    desc: '累计付费满 ¥9',
  },
  {
    id: 'paid_total_2200',
    type: 'paid_total',
    threshold: 2200,
    title: '资深赞助',
    desc: '累计付费满 ¥22',
  },
  {
    id: 'paid_total_5000',
    type: 'paid_total',
    threshold: 5000,
    title: '金牌赞助',
    desc: '累计付费满 ¥50',
  },
  {
    id: 'paid_total_10000',
    type: 'paid_total',
    threshold: 10000,
    title: '殿堂支持者',
    desc: '累计付费满 ¥100',
  },
];

module.exports = { ACHIEVEMENT_DEFS };
