/**
 * 中文可读随机昵称。
 * 思路对齐开源 unique-names-generator：多词典组合 + seed，同一 openid 稳定同名，方便管理端识别。
 * 不引 npm，云函数可直接拷贝本文件。
 */

const ADJECTIVES = [
  '青柠', '软萌', '蹦蹦', '咕噜', '闪闪', '呆萌', '圆滚', '跳跳', '暖暖', '清清',
  '脆脆', '糯糯', '胖墩', '毛茸', '活泼', '安静', '机灵', '悠悠', '亮晶', '乐乐',
  '甜甜', '酸酸', '懒懒', '勤勤', '悄悄', '热闹', '轻轻', '慢慢', '快快', '乖乖',
  '幸运', '开心', '冒泡', '星星', '月光', '云朵', '果冻', '布丁', '薄荷', '蜜桃',
];

const NOUNS = [
  '猫', '狗', '兔', '熊', '鸭', '鹅', '狐', '鹿', '鸟', '鱼',
  '豆', '瓜', '桃', '梨', '杏', '橙', '柠', '莓', '薯', '团',
  '饼', '包', '糖', '球', '星', '月', '云', '风', '叶', '芽',
  '狐狸', '企鹅', '考拉', '仓鼠', '水獭', '海豚', '熊猫', '柴犬', '柯基', '喵喵',
];

function hashSeed(input) {
  let h = 2166136261;
  const s = String(input || 'guest');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {string} seed 通常用 openid
 * @returns {string} 如「青柠猫42」
 */
function randomNickFromSeed(seed) {
  const h = hashSeed(seed);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / 97) % NOUNS.length];
  const num = (h % 90) + 10;
  const nick = `${adj}${noun}${num}`;
  return nick.slice(0, 16);
}

/** 有自定义昵称用自定义；空则按 openid 生成可读名 */
function resolveNickName(userOrNick, openid) {
  if (typeof userOrNick === 'string') {
    const nick = userOrNick.trim();
    if (nick) return nick;
    return randomNickFromSeed(openid || '');
  }
  const data = userOrNick || {};
  const nick = String(data.nickName || '').trim();
  if (nick) return nick;
  return randomNickFromSeed(openid || data.openid || data._id || '');
}

module.exports = {
  randomNickFromSeed,
  resolveNickName,
};
