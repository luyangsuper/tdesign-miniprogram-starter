/** 统一空状态：IconPark 插图 + 文案，水平垂直居中 */

Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  properties: {
    description: {
      type: String,
      value: '暂无数据',
    },
    /** medium 整页 / small 卡片、弹层内 */
    size: {
      type: String,
      value: 'medium',
    },
    /** 占满可用高度并垂直居中（整页列表空态） */
    fill: {
      type: Boolean,
      value: false,
    },
  },
});
