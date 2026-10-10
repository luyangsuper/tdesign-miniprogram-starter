/**
 * 删除等危险操作二次确认（优先 TDesign Dialog，回退 wx.showModal）
 * 页面需引入 t-dialog，并在 data 里预留 confirmDialog 字段，或直接用本方法的 wx 回退。
 */
export function confirmDanger({ title = '确认删除', content = '删除后不可恢复，确定继续？' } = {}) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText: '删除',
      confirmColor: '#e34d59',
      cancelText: '取消',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    });
  });
}
