const MUTE_KEY = 'puzzleSoundMuted';

const SRC = {
  slide: '/pages/puzzle/sfx/tick.mp3',
  snap: '/pages/puzzle/sfx/start.mp3',
  bounce: '/pages/puzzle/sfx/miss.mp3',
  win: '/pages/puzzle/sfx/win.mp3',
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

function createPuzzleAudio() {
  let muted = readMuted();
  const snap = make(SRC.snap, 0.55);
  const bounce = make(SRC.bounce, 0.4);
  const win = make(SRC.win, 0.8);
  const slides = [make(SRC.slide, 0.85), make(SRC.slide, 0.85), make(SRC.slide, 0.85)];
  let slideI = 0;

  return {
    isMuted() {
      return muted;
    },

    setMuted(next) {
      muted = !!next;
      writeMuted(muted);
    },

    /** 拖动过程中的轻点，偏 Q 弹 */
    playSlide() {
      if (muted) return;
      const ctx = slides[slideI % slides.length];
      slideI += 1;
      replay(ctx);
    },

    /** 滑入空格吸附 */
    playSnap() {
      if (muted) return;
      replay(snap);
    },

    /** 没滑够弹回 */
    playBounce() {
      if (muted) return;
      replay(bounce);
    },

    playWin() {
      if (muted) return;
      replay(win);
    },

    destroy() {
      [snap, bounce, win, ...slides].forEach((ctx) => {
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

export function getPuzzleAudio() {
  if (!singleton) singleton = createPuzzleAudio();
  return singleton;
}

export function destroyPuzzleAudio() {
  if (!singleton) return;
  singleton.destroy();
  singleton = null;
}
