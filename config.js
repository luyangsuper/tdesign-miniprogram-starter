/**
 * 小程序全局配置
 * - cloudEnv：微信开发者工具 → 云开发 → 环境 ID
 * - rewardedAdUnitId：激励广告位（空=关闭免费通道；需包月 / 积分才能保存）
 * - downloadCosts：单张扣分（与整包静 2 元 / 动 4 元对齐为 1:2）
 * - membershipPricing：建议售价（兑换码面值参考；非微信支付）
 * - adminOpenids：管理员 openid 列表（真正鉴权在云函数；客户端可用「我的→预览普通用户」）
 * - avatarStyle：未选微信头像时的 DiceBear 风格（fun-emoji / lorelei / adventurer…）
 *   需在小程序后台将 api.dicebear.com 加入 downloadFile 合法域名
 */
export default {
  cloudEnv: 'cloud1-d4g0731mc55f853ef',
  rewardedAdUnitId: '', // 暂不开放广告；接好后填 adunit-xxxxxx
  /** 单张原图积分消耗（云函数 getEmojiDownload 须保持一致） */
  downloadCosts: {
    static: 1,
    anim: 2,
  },
  /**
   * 包月每月额度（与云函数 membership.MONTHLY_QUOTA 保持一致）
   * 上海自然月重置，未用完不滚存；先扣月额度再扣购买积分
   */
  monthlyQuota: 36,
  /**
   * 建议售价（按整包静≈2元、动≈4元，单张通道略贵以保护整包）
   */
  membershipPricing: {
    monthYuan: 9.9,
    quarterYuan: 25,
    yearYuan: 68,
    pointPacks: [
      { points: 20, priceYuan: 6, bonus: 0 },
      { points: 60, priceYuan: 15, bonus: 6 },
      { points: 150, priceYuan: 30, bonus: 20 },
    ],
  },
  /** 联系客服微信号（展示与复制，勿在小程序内挂收款码） */
  serviceWechat: 'Shine_Luyang',
  /** 展示在套餐下方；开通微信支付前用兑换码 */
  shopHint: '购买后把兑换码填到上方即可到账，暂未开通小程序支付',
  adminOpenids: [
    'oOtg0xqcOEHgBAL7u3M7g9S8ln2c', // 本人；云函数环境变量 ADMIN_OPENIDS 请填同样值
  ],
  avatarStyle: 'fun-emoji',
  avatarSize: 128,
  /** 订阅消息：新品上线提醒（thing1 作品名 / thing2 分类 / time3 时间 / thing4 简介） */
  subscribeNewPackTmplId: '-H790OjrQ4Ax5VxJvfahp-eY3D_2CJbpa-f0kKy5BPM',
  /**
   * 订阅消息：管理员收到用户反馈（留言通知）
   * name1 留言人 / thing2 留言内容 / time3 留言时间
   * 云函数可用环境变量 SUBSCRIBE_FEEDBACK_TMPL_ID 覆盖
   */
  subscribeFeedbackTmplId: 'jYzc2X5SfzI89vwnNVGU00v3x4poeZhl9KIkiOaBvm4',
};
