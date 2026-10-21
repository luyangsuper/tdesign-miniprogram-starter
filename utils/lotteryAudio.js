const MUTE_KEY = 'lotterySoundMuted';

const SRC = {
  tick: '/static/lottery/sfx/tick.mp3',
  start: '/static/lottery/sfx/start.mp3',
  win: '/static/lottery/sfx/win.mp3',
  miss: '/static/lottery/sfx/miss.mp3',
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

function createLotteryAudio() {
  let muted = readMuted();
  const start = make(SRC.start, 0.7);
  const win = make(SRC.win, 0.85);
  const miss = make(SRC.miss, 0.75);
  const ticks = [make(SRC.tick, 1), make(SRC.tick, 1), make(SRC.tick, 1), make(SRC.tick, 1)];
  let tickI = 0;

  return {
    isMuted() {
      return muted;
    },

    setMuted(next) {
      muted = !!next;
      writeMuted(muted);
    },

    playStart() {
      if (muted) return;
      replay(start);
    },

    playTick() {
      if (muted) return;
      const ctx = ticks[tickI % ticks.length];
      tickI += 1;
      replay(ctx);
    },

    playWin() {
      if (muted) return;
      replay(win);
    },

    playMiss() {
      if (muted) return;
      replay(miss);
    },

    unduck() {},

    destroy() {
      [start, win, miss, ...ticks].forEach((ctx) => {
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

export function getLotteryAudio() {
  if (!singleton) singleton = createLotteryAudio();
  return singleton;
}

export function destroyLotteryAudio() {
  if (!singleton) return;
  singleton.destroy();
  singleton = null;
}
