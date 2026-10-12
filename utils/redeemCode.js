import { callFunction } from '~/utils/cloud';

/** 与云函数生成规则一致：XXXX-XXXX */
const CODE_RE = /[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/i;

/**
 * @param {'vip_days'|'points'|string} type
 * @param {number} value
 */
export function benefitLabel(type, value) {
  const n = Number(value);
  if (type === 'vip_days') return `包月会员 ${n} 天`;
  if (type === 'points') return `积分 ${n}`;
  return String(type || '权益');
}

/**
 * 生成可发给用户的兑换文案（含权益说明 + 码）
 * @param {{ type?: string, value?: number, label?: string, codes: string[] }} opts
 */
export function formatRedeemShareText(opts = {}) {
  const codes = (opts.codes || []).map((c) => String(c || '').trim()).filter(Boolean);
  if (!codes.length) return '';

  const benefit =
    (opts.label && String(opts.label).trim()) ||
    benefitLabel(opts.type, opts.value);

  const head = `【趣集】兑换码\n权益：${benefit}`;
  const tip = '打开「趣集」小程序 →「我的」页，可自动识别并兑换';

  if (codes.length === 1) {
    return `${head}\n兑换码：${codes[0]}\n\n${tip}`;
  }

  const body = codes.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `${head}（共 ${codes.length} 个）\n\n${body}\n\n${tip}`;
}

/**
 * 从一段文字里提取兑换码（取第一个匹配）
 * @param {string} text
 * @returns {string}
 */
export function extractRedeemCode(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.trim().match(CODE_RE);
  return m ? m[0].toUpperCase() : '';
}

/**
 * 读取剪贴板并尝试提取兑换码。失败或无码时返回空串（不抛错）。
 * @returns {Promise<string>}
 */
export function readClipboardRedeemCode() {
  return new Promise((resolve) => {
    if (!wx.getClipboardData) {
      resolve('');
      return;
    }
    wx.getClipboardData({
      success: (res) => {
        resolve(extractRedeemCode((res && res.data) || ''));
      },
      fail: () => resolve(''),
    });
  });
}

function setClipboard(text) {
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: text,
      success: resolve,
      fail: reject,
    });
  });
}

/**
 * 按定价档位生成兑换码，并复制「权益说明 + 兑换码」文案到剪贴板。
 * @param {{ type: string, value: number, title?: string }} plan
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
  });
  const data = res.data || {};
  const codes = data.codes || [];
  if (!codes.length) {
    throw new Error('未生成兑换码');
  }

  const label = data.label || benefitLabel(type, value) || plan.title || '';
  const text = formatRedeemShareText({ type, value, label, codes });
  await setClipboard(text);

  return {
    codes,
    label,
    shareText: text,
    count: codes.length,
  };
}
