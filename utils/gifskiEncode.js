/**
 * gifski-wasm（高质量 GIF）微信小程序封装
 * wasm 胶水见 /wasm/gifski（由 scripts/patch-gifski-wx.mjs 从 npm 包生成）
 *
 * 注意：gifski-wasm 为 AGPL-3.0；至少需要 2 帧才能编码。
 */
import initGifski, { encode as wasmEncode } from '../wasm/gifski/gifski_wasm.js';

let ready;

function framesToBuffer(frames) {
  const totalLength = frames.reduce((acc, frame) => {
    const _frame = 'data' in frame ? frame.data : frame;
    return acc + _frame.length;
  }, 0);
  const framesBuffer = new Uint8Array(totalLength);
  let offset = 0;
  frames.forEach((frame) => {
    const _frame = 'data' in frame ? frame.data : frame;
    framesBuffer.set(_frame, offset);
    offset += _frame.length;
  });
  return framesBuffer;
}

export async function ensureGifski() {
  if (!ready) {
    ready = initGifski('/wasm/gifski/gifski_wasm_bg.wasm');
  }
  return ready;
}

/**
 * @param {{
 *   frames: Array<Uint8Array|ImageData|{data:Uint8Array|Uint8ClampedArray}>,
 *   width: number,
 *   height: number,
 *   fps?: number,
 *   frameDurations?: number[],
 *   quality?: number,
 *   repeat?: number,
 *   resizeWidth?: number,
 *   resizeHeight?: number,
 * }} options
 * @returns {Promise<Uint8Array>}
 */
export async function encodeGifski(options) {
  await ensureGifski();
  let {
    frames,
    width,
    height,
    fps,
    frameDurations,
    quality = 100,
    repeat,
    resizeWidth,
    resizeHeight,
  } = options || {};

  if (!frames || !frames.length) {
    throw new Error('没有可编码的帧');
  }

  // gifski 要求至少 2 帧：单帧静图复制一帧
  if (frames.length === 1) {
    frames = [frames[0], frames[0]];
    if (!fps && !frameDurations) {
      frameDurations = [100, 100];
    } else if (frameDurations && frameDurations.length === 1) {
      frameDurations = [frameDurations[0], frameDurations[0]];
    }
  }

  if (!fps && !frameDurations) {
    fps = 1;
  }
  if (fps && frameDurations) {
    throw new Error('fps 与 frameDurations 不能同时传');
  }
  if (frameDurations && frameDurations.length !== frames.length) {
    throw new Error('frameDurations 长度必须与帧数一致');
  }

  const framesBuffer = framesToBuffer(frames);
  const durations = frameDurations ? new Uint32Array(frameDurations) : undefined;
  const buffer = await wasmEncode(
    framesBuffer,
    frames.length,
    width,
    height,
    fps,
    durations,
    quality,
    repeat,
    resizeWidth,
    resizeHeight,
  );
  if (!buffer) throw new Error('GIF 编码失败');
  return buffer;
}

export default encodeGifski;
