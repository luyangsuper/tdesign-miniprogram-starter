import config from '~/config';

function friendlyCloudError(err, name) {
  const msg = (err && (err.errMsg || err.message)) || '';
  const code = err && (err.errCode || err.code);
  if (code === -501000 || /FUNCTION_NOT_FOUND|FunctionName parameter could not be found/i.test(msg)) {
    const e = new Error(`云函数「${name}」未部署，请在开发者工具右键 cloudfunctions/${name} → 上传并部署`);
    e.code = 'FUNCTION_NOT_FOUND';
    return e;
  }
  if (/INVALID_ENV|Environment not found/i.test(msg)) {
    const e = new Error('云环境无效，请检查 config.js 的 cloudEnv');
    e.code = 'INVALID_ENV';
    return e;
  }
  if (
    code === -504003 ||
    /FUNCTIONS_TIME_LIMIT_EXCEEDED|timed out after/i.test(msg)
  ) {
    const e = new Error(
      name === 'generatePackCopy'
        ? 'AI 生成超时：请把云函数 generatePackCopy 超时改为 60 秒后重试'
        : `云函数「${name}」执行超时，请在云开发控制台调高超时时间`,
    );
    e.code = 'FUNCTIONS_TIME_LIMIT_EXCEEDED';
    return e;
  }
  const e = new Error((err && err.message) || msg || '请求失败');
  e.code = code;
  return e;
}

/** 调用云函数，统一解包 result */
export function callFunction(name, data = {}) {
  return wx.cloud
    .callFunction({ name, data })
    .then((res) => {
      const result = res.result || {};
      if (result.ok === false) {
        const err = new Error(result.message || '请求失败');
        err.code = result.code;
        throw err;
      }
      return result;
    })
    .catch((err) => {
      throw friendlyCloudError(err, name);
    });
}

/** 把云存储 fileID 转成临时 https 链接（批量） */
export function getTempFileURLs(fileList = []) {
  const list = (fileList || []).filter(Boolean);
  if (!list.length) return Promise.resolve([]);

  return wx.cloud.getTempFileURL({ fileList: list }).then((res) =>
    (res.fileList || []).map((item) => item.tempFileURL || ''),
  );
}

/** 上传本地文件到云存储，返回 fileID */
export function uploadFile(cloudPath, filePath) {
  return wx.cloud.uploadFile({ cloudPath, filePath }).then((res) => res.fileID);
}

export function ensureCloudReady() {
  if (!wx.cloud) {
    throw new Error('请使用支持云开发的基础库');
  }
  if (!config.cloudEnv) {
    console.warn('[cloud] 未配置 cloudEnv，请在 config.js 填写环境 ID');
  }
}
