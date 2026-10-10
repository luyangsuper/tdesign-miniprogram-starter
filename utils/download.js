/** 下载网络图片并保存到系统相册（一次一张） */
export function saveRemoteImageToAlbum(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('没有可保存的图片'));
      return;
    }

    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          reject(new Error('下载失败'));
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: resolve,
          fail: reject,
        });
      },
      fail: reject,
    });
  });
}

/** 确保有「保存到相册」权限 */
export function ensureAlbumAuth() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: (setting) => {
        if (setting.authSetting['scope.writePhotosAlbum']) {
          resolve(true);
          return;
        }
        wx.authorize({
          scope: 'scope.writePhotosAlbum',
          success: () => resolve(true),
          fail: () => {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中开启「保存到相册」权限',
              confirmText: '去设置',
              success: (modal) => {
                if (modal.confirm) {
                  wx.openSetting({
                    success: (s) => {
                      if (s.authSetting['scope.writePhotosAlbum']) resolve(true);
                      else reject(new Error('未授权相册'));
                    },
                    fail: reject,
                  });
                } else {
                  reject(new Error('未授权相册'));
                }
              },
            });
          },
        });
      },
      fail: reject,
    });
  });
}
