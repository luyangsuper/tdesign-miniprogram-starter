/**
 * 打开图片预览。优先用已展示过的缓存本地路径，避免 wx.previewImage 再下整张原图。
 */
export function previewImages(urls, current) {
  const list = [];
  (urls || []).forEach((u) => {
    if (u && list.indexOf(u) === -1) list.push(u);
  });
  if (!list.length) return;

  const cur = current && list.indexOf(current) >= 0 ? current : list[0];
  let loadingShown = false;
  const loadingTimer = setTimeout(() => {
    loadingShown = true;
    wx.showLoading({ title: '打开预览', mask: true });
  }, 160);

  const open = (mapped, currentPath) => {
    clearTimeout(loadingTimer);
    if (loadingShown) wx.hideLoading();
    wx.previewImage({
      urls: mapped,
      current: currentPath,
    });
  };

  wx.getImageInfo({
    src: cur,
    success: (info) => {
      const local = info.path || cur;
      const mapped = list.map((u) => (u === cur ? local : u));
      open(mapped, local);
    },
    fail: () => open(list, cur),
  });
}
