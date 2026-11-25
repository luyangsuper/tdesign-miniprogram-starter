import { callFunction } from '~/utils/cloud';
import { resolveIsAdmin } from '~/utils/auth';
import { presentLibrarySource } from '~/utils/library';
import { getCustomNavMetrics } from '~/utils/systemInfo';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

const JOB_CACHE_KEY = 'lib_import_job_cards_v1';

function jobPercent(job) {
  if (!job) return 0;
  if (job.mode === 'google') {
    const total = Math.max(1, Number(job.total) || 720);
    const pageSize = 3;
    const totalPages = Math.max(
      1,
      Number(job.totalPages) || Math.ceil(total / pageSize),
    );
    const page = Math.max(1, Number(job.page) || 1);
    const donePages = job.status === 'done' ? totalPages : Math.max(0, page - 1);
    return Math.min(100, Math.round((donePages / totalPages) * 100));
  }
  const total = Math.max(1, Number(job.total) || 793);
  const offset = Math.max(0, Number(job.offset) || 0);
  const pct = job.status === 'done' ? 100 : Math.round((offset / total) * 100);
  return Math.min(100, Math.max(0, pct));
}

function presentJob(job, title) {
  if (!job || !job.status) return null;
  const status = String(job.status || '');
  if (!['running', 'done', 'cancelled', 'error'].includes(status)) return null;
  const imported = Number(job.imported) || 0;
  const skipped = Number(job.skipped) || 0;
  const fail = (Number(job.fail) || 0) + (Number(job.mirrorFail) || 0);
  const isGoogle = job.mode === 'google' || title.indexOf('经典') >= 0;
  const total = Number(job.total) || (isGoogle ? 720 : 793);
  const offset = Number(job.offset) || 0;
  const page = Number(job.page) || 1;
  let progressText = '';
  if (isGoogle) {
    progressText =
      status === 'done'
        ? `已扫完约 ${total} 条`
        : `正在处理第 ${page} 页（共约 ${total} 条）`;
  } else {
    progressText =
      status === 'done'
        ? `已扫完 ${total} 条目录`
        : `已扫描 ${offset}/${total}`;
  }
  let statusText = '进行中';
  if (status === 'done') statusText = '已完成';
  else if (status === 'cancelled') statusText = '已停止';
  else if (status === 'error') statusText = '出错';
  return {
    mode: job.mode || (isGoogle ? 'google' : 'other'),
    title,
    status,
    statusText,
    running: status === 'running',
    percent: jobPercent({
      ...job,
      mode: isGoogle ? 'google' : 'other',
      total,
    }),
    progressText,
    imported,
    skipped,
    fail,
    total,
    offset,
    page,
    detail: String(job.message || '').trim(),
    updatedAt: Number(job.updatedAt) || Date.now(),
  };
}

function cardsToJobMap(cards = []) {
  const out = { other: null, google: null };
  (cards || []).forEach((c) => {
    if (!c || (c.mode !== 'other' && c.mode !== 'google')) return;
    out[c.mode] = {
      mode: c.mode,
      status: c.status,
      imported: c.imported,
      skipped: c.skipped,
      fail: c.fail,
      mirrorFail: 0,
      total: Number(c.total) || (c.mode === 'other' ? 793 : 720),
      offset: Number(c.offset) || 0,
      page: Number(c.page) || 1,
      message: c.detail,
      updatedAt: c.updatedAt || Date.now(),
    };
  });
  return out;
}

Page({
  data: {
    themeStyle: '',
    themeBrand: '#07c160',
    navHeight: 0,
    navBarStyle: '',
    loading: true,
    sources: [],
    emptyTip: '暂无素材源',
    isAdmin: false,
    importingGoogle: false,
    importingOther: false,
    startingGoogle: false,
    startingOther: false,
    jobCards: [],
    hasRunningJob: false,
  },

  _pollTimer: null,
  _driveBusy: false,
  _driveCursor: 0,
  /** 用户点过停止的 mode，禁止被缓存/服务端 running 状态再次拉起 */
  _stopped: { other: false, google: false },

  onLoad() {
    try {
      const nav = getCustomNavMetrics();
      this.setData({
        navHeight: nav.navHeight,
        navBarStyle: nav.navBarStyle || '',
        themeStyle: getThemeStyle(),
        isAdmin: resolveIsAdmin(),
      });
    } catch (e) {
      this.setData({
        navHeight: 64,
        navBarStyle: '',
        themeStyle: getThemeStyle(),
        isAdmin: resolveIsAdmin(),
      });
    }
    applyThemeToPage(this);
    // 不自动恢复「进行中」缓存，避免假进度粘住、停止无效
    this.clearJobCache();
    this.loadSources();
    if (resolveIsAdmin()) {
      this.pullStatusOnly();
    }
  },

  onShow() {
    applyThemeToPage(this);
    this.setData({ isAdmin: resolveIsAdmin() });
    if (resolveIsAdmin() && this.data.hasRunningJob) {
      this.startPoll();
      this.pullAndDrive();
    } else if (resolveIsAdmin()) {
      this.pullStatusOnly();
    }
  },

  onHide() {
    this.stopPoll();
  },

  onUnload() {
    this.stopPoll();
  },

  clearJobCache() {
    try {
      wx.removeStorageSync(JOB_CACHE_KEY);
    } catch (e) {
      /* ignore */
    }
  },

  saveJobCache() {
    // 仅缓存非 running，避免假进度复活
    try {
      const cards = (this.data.jobCards || []).filter(
        (c) => c && c.status && c.status !== 'running',
      );
      wx.setStorageSync(JOB_CACHE_KEY, { cards, at: Date.now() });
    } catch (e) {
      /* ignore */
    }
  },

  stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  startPoll() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => {
      this.pullAndDrive();
    }, 2500);
  },

  commitCards(google, other) {
    const cards = [google, other].filter(Boolean);
    const importingGoogle = !!(google && google.running);
    const importingOther = !!(other && other.running);
    const hasRunningJob = importingGoogle || importingOther;
    const wasRunning = this.data.hasRunningJob;
    this.setData({
      jobCards: cards,
      importingGoogle,
      importingOther,
      hasRunningJob,
    });
    this.saveJobCache();
    if (hasRunningJob) this.startPoll();
    else this.stopPoll();

    if (wasRunning && !hasRunningJob && cards.some((c) => c.status === 'done')) {
      this.loadSources();
      wx.showToast({ title: '导入已完成', icon: 'success' });
    }
  },

  applyJobsFromServer(serverJobs = {}) {
    const local = cardsToJobMap(this.data.jobCards);
    const pick = (mode, title) => {
      if (this._stopped[mode]) {
        // 用户已停止：只展示 cancelled，绝不恢复 running
        const remote = serverJobs[mode];
        if (remote && remote.status && remote.status !== 'running') {
          return presentJob(remote, title);
        }
        const loc = local[mode];
        if (loc && loc.status && loc.status !== 'running') {
          return presentJob(loc, title);
        }
        return null;
      }
      const remote = serverJobs[mode];
      if (remote && remote.status === 'running') {
        return presentJob(remote, title);
      }
      if (remote && remote.status) return presentJob(remote, title);
      const loc = local[mode];
      if (loc && loc.status === 'running') {
        return presentJob(loc, title);
      }
      return loc ? presentJob(loc, title) : null;
    };
    this.commitCards(pick('google', '经典动态'), pick('other', '立体 + 反应'));
  },

  /** 只读状态，不推进（进页用） */
  async pullStatusOnly() {
    if (!resolveIsAdmin()) return;
    try {
      const res = await callFunction('adminUpsertLibrary', {
        action: 'importJobStatus',
      });
      const jobs = (res && res.data) || {};
      // 进页时若云端仍 running，但用户没主动点开始，先标 stopped，避免僵尸任务
      ['other', 'google'].forEach((mode) => {
        const j = jobs[mode];
        if (j && j.status === 'running' && !this.data.hasRunningJob) {
          // 不自动续跑僵尸任务：提示用户重新点导入或点清除
          this._stopped[mode] = true;
        }
      });
      this.applyJobsFromServer(jobs);
    } catch (e) {
      console.warn('[import status]', e);
    }
  },

  async pullAndDrive() {
    if (!resolveIsAdmin()) return;
    if (this._driveBusy) return;
    if (!this.data.importingGoogle && !this.data.importingOther) {
      this.stopPoll();
      return;
    }
    this._driveBusy = true;
    try {
      let jobs = {};
      try {
        const res = await callFunction('adminUpsertLibrary', {
          action: 'importJobStatus',
        });
        jobs = (res && res.data) || {};
        this.applyJobsFromServer(jobs);
      } catch (e) {
        console.warn('[import status]', e);
      }

      if (!this.data.importingGoogle && !this.data.importingOther) return;

      const modes = [];
      if (this.data.importingOther && !this._stopped.other) modes.push('other');
      if (this.data.importingGoogle && !this._stopped.google) modes.push('google');
      if (!modes.length) return;

      this._driveCursor = (Number(this._driveCursor) || 0) + 1;
      const mode = modes[this._driveCursor % modes.length];

      try {
        const tick = await callFunction(
          'adminUpsertLibrary',
          { action: 'importJobTick', mode, _force: true },
          { timeout: 90000 },
        );
        if (this._stopped[mode]) return;
        if (tick && tick.data) {
          const cur = cardsToJobMap(this.data.jobCards);
          this.applyJobsFromServer({
            other: mode === 'other' ? tick.data : jobs.other || cur.other,
            google: mode === 'google' ? tick.data : jobs.google || cur.google,
          });
        }
      } catch (e) {
        console.warn('[import tick]', mode, e);
        if (this._stopped[mode]) return;
        const cur = cardsToJobMap(this.data.jobCards);
        const failed = {
          ...(jobs[mode] || cur[mode] || {
            mode,
            status: 'running',
            total: mode === 'other' ? 793 : 720,
          }),
          status: 'running',
          message: `推进失败：${e.message || e}`,
          updatedAt: Date.now(),
        };
        this.applyJobsFromServer({
          other: mode === 'other' ? failed : jobs.other || cur.other,
          google: mode === 'google' ? failed : jobs.google || cur.google,
        });
      }
    } finally {
      this._driveBusy = false;
    }
  },

  async loadSources() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('listLibrary', { action: 'sources' });
      const list = ((res.data && res.data.list) || []).map((s) =>
        presentLibrarySource(s),
      );
      this.setData({
        sources: list,
        loading: false,
        emptyTip: '暂无合集，请重新部署 listLibrary 云函数',
      });
    } catch (e) {
      console.warn('[library hub]', e);
      const msg = String((e && e.message) || '');
      const needTable = /lib_sources|collection not exist|502005/i.test(msg);
      this.setData({
        sources: [],
        loading: false,
        emptyTip: needTable
          ? '数据库表未创建：请重新上传部署 listLibrary（会自动建表）'
          : '加载失败，请确认已部署 listLibrary 云函数',
      });
    }
  },

  onOpenSource(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/library/source/index?sourceId=${encodeURIComponent(id)}`,
    });
  },

  toastRunningProgress(mode) {
    const card = (this.data.jobCards || []).find((c) => c.mode === mode);
    if (card) {
      wx.showToast({
        title: `进行中 ${card.percent}% · 已入库 ${card.imported}`,
        icon: 'none',
      });
      return;
    }
    wx.showToast({ title: '该任务已在后台跑', icon: 'none' });
  },

  /** 立刻从 UI 干掉该任务（不等云） */
  stopModeLocal(mode) {
    this._stopped[mode] = true;
    const map = cardsToJobMap(this.data.jobCards);
    if (map[mode]) {
      map[mode] = {
        ...map[mode],
        status: 'cancelled',
        message: '已停止（已入库的会保留）',
      };
    }
    this.applyJobsFromServer(map);
    if (!this.data.importingGoogle && !this.data.importingOther) {
      this.stopPoll();
      this._driveBusy = false;
    }
  },

  async startJob(mode) {
    if (!resolveIsAdmin()) {
      wx.showToast({ title: '仅管理员可导入', icon: 'none' });
      return;
    }
    const running =
      mode === 'google' ? this.data.importingGoogle : this.data.importingOther;
    if (running) {
      this.toastRunningProgress(mode);
      this.pullAndDrive();
      return;
    }
    const startingKey = mode === 'google' ? 'startingGoogle' : 'startingOther';
    if (this.data[startingKey]) return;

    const label = mode === 'google' ? '经典动态' : '立体 + 反应';
    this._stopped[mode] = false;
    this.setData({ [startingKey]: true });

    const placeholder = presentJob(
      {
        mode,
        status: 'running',
        offset: 0,
        page: 1,
        total: mode === 'other' ? 793 : 720,
        imported: 0,
        skipped: 0,
        fail: 0,
        message: '正在启动…',
        updatedAt: Date.now(),
      },
      label,
    );
    const cur = cardsToJobMap(this.data.jobCards);
    if (mode === 'other') this.commitCards(presentJob(cur.google, '经典动态'), placeholder);
    else this.commitCards(placeholder, presentJob(cur.other, '立体 + 反应'));

    try {
      // restart: true 强制新开，清掉云端僵尸 running
      const res = await callFunction(
        'adminUpsertLibrary',
        { action: 'importJobStart', mode, restart: true },
        { timeout: 20000 },
      );
      if (this._stopped[mode]) return;
      const seed = res && res.data;
      if (seed) {
        const map = cardsToJobMap(this.data.jobCards);
        this.applyJobsFromServer({
          other: mode === 'other' ? seed : map.other,
          google: mode === 'google' ? seed : map.google,
        });
      }
      this.startPoll();
      this.pullAndDrive();
      wx.showToast({ title: `${label}已启动`, icon: 'none' });
    } catch (e) {
      console.warn('[import start]', e);
      this.stopModeLocal(mode);
      const map = cardsToJobMap(this.data.jobCards);
      map[mode] = null;
      this.applyJobsFromServer(map);
      wx.showToast({
        title: e.message || '启动失败，请部署 adminUpsertLibrary',
        icon: 'none',
        duration: 3000,
      });
    } finally {
      this.setData({ [startingKey]: false });
    }
  },

  onImportAnimate() {
    this.startJob('google');
  },

  onImportOther() {
    this.startJob('other');
  },

  onCancelImport(e) {
    const mode = String(
      (e &&
        e.currentTarget &&
        (e.currentTarget.dataset.mode ||
          (e.target && e.target.dataset && e.target.dataset.mode))) ||
        '',
    ).trim();
    if (!mode || mode === 'hint') {
      wx.showToast({ title: '无法识别任务', icon: 'none' });
      return;
    }

    // 先本地停干净，再异步通知云
    this.stopModeLocal(mode);
    wx.showToast({ title: '已停止', icon: 'none' });

    callFunction('adminUpsertLibrary', {
      action: 'importJobCancel',
      mode,
    }).catch((err) => {
      console.warn('[import cancel]', err);
    });

    this.loadSources().catch(() => null);
  },

  onClearAllJobs() {
    this._stopped.other = true;
    this._stopped.google = true;
    this.stopPoll();
    this._driveBusy = false;
    this.setData({
      jobCards: [],
      importingGoogle: false,
      importingOther: false,
      hasRunningJob: false,
    });
    this.clearJobCache();
    ['other', 'google'].forEach((mode) => {
      callFunction('adminUpsertLibrary', {
        action: 'importJobCancel',
        mode,
      }).catch(() => null);
    });
    wx.showToast({ title: '进度已清除', icon: 'none' });
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) });
  },
});
