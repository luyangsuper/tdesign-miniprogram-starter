/**
 * 小程序全局配置
 * - cloudEnv：微信开发者工具 → 云开发 → 环境 ID
 * - rewardedAdUnitId：激励广告（约 30s）· 全站统一（我的 / 签到再领 / 保存不够）
 * - saveRewardedAdUnitId：已废弃（原 15s 短广告），留空即可
 * - adRewardPoints / adRewardDailyMax：「我的」主动领取奖励与日上限
 * - saveAdRewardPoints / saveAdRewardDailyMax：签到再领 / 保存不够 的奖励与日上限（仍用 30s 广告）
 * - downloadCosts：保存单价默认值；线上以 app_config/points（管理端「积分规则」）为准
 * - membershipPricing：离线默认售价；线上以云库 app_config/pricing（管理端「定价方案」）为准
 * - virtualPay：OfferId 可公开；AppKey 只放云函数环境变量
 * - adminOpenids：管理员 openid 列表（真正鉴权在云函数；客户端可用「我的→预览普通用户」）
 * - 默认头像：Pixabots（https://pixabots.com/browse），按 openid 固定分配
 *   需在小程序后台将 pixabots.com 加入 downloadFile 合法域名
 */
export default {
  /** 关于页展示；与 package.json version 对齐即可 */
  appVersion: '3.1.0',
  cloudEnv: 'cloud1-d4g0731mc55f853ef',
  /** 约 30s，全站激励广告 */
  rewardedAdUnitId: 'adunit-b77d32dfa7a29761',
  /** @deprecated 原 15s 短广告，已不再使用 */
  saveRewardedAdUnitId: '',
  /**
   * 原生模板广告（横版优选 · 20:7 / 16:9）
   * 空=该位置不展示；VIP 客户端不展示被动原生广告
   */
  /** 首页瀑布流通栏 */
  nativeHomeFeedAdUnitId: 'adunit-2cd86e0e56e6d718',
  /** 合集详情 · 保存原图上方 */
  nativePackDetailAdUnitId: 'adunit-955ce8dea99a2a65',
  /** 「我的」积分区下方 */
  nativeMyPageAdUnitId: 'adunit-95a12cc17e9ca0d1',
  /** 收藏列表原生广告 */
  nativeFavoritesAdUnitId: 'adunit-494a61cf3ce09618',
  /**
   * 首页每多少个合集插入一条原生广告（离线默认）
   * 线上以云库 app_config/points.homeFeedAdEvery 为准；0=关闭信息流广告；建议 6～8。
   * 数值按约 2 列口径；客户端会随瀑布流列数缩放（1 列更密、3/4 列更疏）。
   */
  homeFeedAdEvery: 6,
  /**
   * 看广告领积分默认值（云库 app_config/points 可改；广告均为约 30s）
   * - 「我的」主动领取：+2
   * - 签到后再领 / 保存不够：+1（额度仍可分开配）
   */
  adRewardPoints: 2,
  adRewardDailyMax: 5,
  saveAdRewardPoints: 1,
  saveAdRewardDailyMax: 8,
  /**
   * 单张/单段原文件积分消耗（云函数 getEmojiDownload 须保持一致）
   * - static / anim：表情动静
   * - wallpaper / avatar / video：对应类型（无动静之分）
   */
  downloadCosts: {
    static: 1,
    anim: 2,
    wallpaper: 4,
    avatar: 4,
    video: 8,
  },
  /**
   * 包月每月额度（与云函数 membership.MONTHLY_QUOTA 保持一致）
   * 上海自然月重置，未用完不滚存；先扣月额度再扣购买积分
   */
  monthlyQuota: 48,
  /**
   * 积分活动默认值（真正生效以云库 app_config/points 为准，可在管理端修改）
   * - welcomeGiftPoints：新用户首次登录见面礼
   * - checkinPoints：每日签到
   * - oaBonusPoints：公众号动态入口（带 oaId），每用户每动态一次；0 关闭
   * - adReward* / saveAdReward*：激励视频（见上）
   */
  welcomeGiftPoints: 18,
  checkinPoints: 1,
  oaBonusPoints: 1,
  /**
   * 售价离线默认（单位元）。运行时优先云库 app_config/pricing；
   * 管理端改价会同步微信道具，发布成功后 live 价才用于下单。
   */
  membershipPricing: {
    monthYuan: 9,
    quarterYuan: 24,
    yearYuan: 70,
    pointPacks: [
      { points: 4, priceYuan: 1, bonus: 0 },
      { points: 8, priceYuan: 2, bonus: 0 },
      { points: 18, priceYuan: 5, bonus: 0 },
      { points: 66, priceYuan: 16, bonus: 0 },
      { points: 170, priceYuan: 32, bonus: 0 },
    ],
  },
  /**
   * 虚拟支付（客户端仅放 OfferId；密钥在云函数）
   * env: 0 现网 / 1 沙箱
   */
  virtualPay: {
    enabled: true,
    offerId: '1450673547',
    env: 0,
  },
  /** 展示在套餐下方 */
  shopHint: '支持小程序内购买；也可使用兑换码',
  adminOpenids: [
    'oOtg0xqcOEHgBAL7u3M7g9S8ln2c', // 本人；云函数环境变量 ADMIN_OPENIDS 请填同样值
  ],
  /** Pixabots 默认头像边长（像素） */
  avatarSize: 128,
  /** 饱和度 1=原色，略提高便于区分 */
  avatarSaturate: 1.35,
  /** 头像底色（避免透明底发灰） */
  avatarBg: '#f3f4f6',
  /** 订阅消息：新品上线提醒（thing1 作品名 / thing2 分类 / time3 时间 / thing4 简介） */
  subscribeNewPackTmplId: '-H790OjrQ4Ax5VxJvfahp-eY3D_2CJbpa-f0kKy5BPM',
  /**
   * 订阅消息：管理员收到用户反馈（留言通知）
   * name1 留言人 / thing2 留言内容 / time3 留言时间
   * 云函数可用环境变量 SUBSCRIBE_FEEDBACK_TMPL_ID 覆盖
   */
  subscribeFeedbackTmplId: 'jYzc2X5SfzI89vwnNVGU00v3x4poeZhl9KIkiOaBvm4',
  /**
   * 订阅消息：获得抽奖机会
   * number1 待抽奖次数 / thing3 温馨提示
   */
  subscribeLotteryInviteTmplId: 'qVZWH6E_XuOXoh7Zob5gc5yTPWX48KwPq1UaBlo_iyc',
  /**
   * 订阅消息：中奖结果通知
   * thing1 奖品名称 / number2 奖品数量 / time3 中奖时间 / thing4 温馨提示 / thing5 活动名称
   */
  subscribeLotteryWinTmplId: '4YaXF8Jp4lZGNUOmVyF5gvSO8EVMMv1IoYKUmiF9Gk8',
};
