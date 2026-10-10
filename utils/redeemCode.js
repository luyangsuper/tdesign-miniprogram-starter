import { callFunction } from '~/utils/cloud';

/**
 * 按定价档位生成兑换码并复制到剪贴板。
 * @param {{ type: string, value: number, note?: string, title?: string }} plan
 * @param {{ count?: number }} [opts]
 */
export async function createAndCopyCode(plan, opts = {}) {
  const type = plan.type;
  const value = Number(plan.value);
  const count = Math.max(1, Math.min(50, Number(opts.count) || 1));
  if (!type || !value) {
    throw new Error('档位无效');
  }

  const res = await callFunction('adminCreateCodes', {
    type,
    value,
    count,
    note: plan.note || plan.title || '',
  });
  const data = res.data || {};
  const codes = data.codes || [];
  if (!codes.length) {
    throw new Error('未生成兑换码');
  }

  const text = codes.join('\n');
  await new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: text,
      success: resolve,
      fail: reject,
    });
  });

  return {
    codes,
    label: data.label || plan.title || '',
    count: codes.length,
  };
}
