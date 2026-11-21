const MUTE_KEY = 'answerbookSoundMuted';

const SRC = {
  open: '/pages/tools/answerbook/sfx/open.mp3',
  close: '/pages/tools/answerbook/sfx/close.mp3',
  flip: '/pages/tools/answerbook/sfx/flip.mp3',
  flipA: '/pages/tools/answerbook/sfx/flip-a.mp3',
  flipB: '/pages/tools/answerbook/sfx/flip-b.mp3',
  riffle: '/pages/tools/answerbook/sfx/riffle.mp3',
  reveal: '/pages/tools/answerbook/sfx/reveal.mp3',
};

function readMuted() {
  try {
    return !!wx.getStorageSync(MUTE_KEY);
  } catch (e) {
    return false;
  }
}

function writeMuted(muted) {
  try {
    wx.setStorageSync(MUTE_KEY, !!muted);
  } catch (e) {
    /* ignore */
  }
}

function make(src, volume) {
  const ctx = wx.createInnerAudioContext({ useWebAudioImplement: true });
  ctx.src = src;
  ctx.volume = volume;
  ctx.obeyMuteSwitch = true;
  return ctx;
}

function replay(ctx) {
  if (!ctx) return;
  try {
    ctx.stop();
  } catch (e) {
    /* ignore */
  }
  try {
    ctx.seek(0);
  } catch (e) {
    /* ignore */
  }
  try {
    ctx.play();
  } catch (e) {
    /* ignore */
  }
}

let singleton = null;

function createAnswerbookAudio() {
  let muted = readMuted();
  const open = make(SRC.open, 0.85);
  const close = make(SRC.close, 0.9);
  const reveal = make(SRC.reveal, 0.8);
  const riffle = make(SRC.riffle, 0.7);
  // 多条短翻页轮播，听感更像连续翻书
  const flips = [
    make(SRC.flip, 0.78),
    make(SRC.flipA, 0.78),
    make(SRC.flipB, 0.78),
    make(SRC.flip, 0.78),
    make(SRC.flipA, 0.78),
  ];
  let flipI = 0;
  let flipTimer = null;
  let riffleStopTimer = null;

  function haltRiffle() {
    if (flipTimer) {
      clearInterval(flipTimer);
      flipTimer = null;
    }
    if (riffleStopTimer) {
      clearTimeout(riffleStopTimer);
      riffleStopTimer = null;
    }
    try {
      riffle.stop();
    } catch (e) {
      /* ignore */
    }
  }

  return {
    isMuted() {
      return muted;
    },

    setMuted(next) {
      muted = !!next;
      writeMuted(muted);
      if (muted) haltRiffle();
    },

    /** 翻开封面 */
    playOpen() {
      if (muted) return;
      haltRiffle();
      replay(open);
    },

    /** 合上书 */
    playClose() {
      if (muted) return;
      haltRiffle();
      replay(close);
    },

    /** 快速连翻：书页连翻底噪 + 短翻页点缀 */
    playRiffle(durationMs) {
      if (muted) return;
      haltRiffle();
      replay(riffle);
      const span = Math.max(800, Number(durationMs) || 2000);
      // 先立即翻一页，再按节奏连翻
      replay(flips[0]);
      flipI = 1;
      flipTimer = setInterval(() => {
        if (muted) return;
        const ctx = flips[flipI % flips.length];
        flipI += 1;
        replay(ctx);
      }, 220);
      riffleStopTimer = setTimeout(() => {
        haltRiffle();
      }, span);
    },

    stopRiffle() {
      haltRiffle();
    },

    /** 揭晓：书页落定 */
    playReveal() {
      if (muted) return;
      haltRiffle();
      replay(reveal);
    },

    destroy() {
      haltRiffle();
      [open, close, reveal, riffle, ...flips].forEach((ctx) => {
        try {
          ctx.stop();
          ctx.destroy();
        } catch (e) {
          /* ignore */
        }
      });
    },
  };
}

export function getAnswerbookAudio() {
  if (!singleton) singleton = createAnswerbookAudio();
  return singleton;
}

export function destroyAnswerbookAudio() {
  if (!singleton) return;
  singleton.destroy();
  singleton = null;
}
