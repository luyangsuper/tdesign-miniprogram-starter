import { callFunction } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import {
  defaultAdRewardDailyMax,
  defaultAdRewardPoints,
  defaultCheckinPoints,
  defaultHomeFeedAdEvery,
  defaultOaBonusPoints,
  defaultSaveAdRewardDailyMax,
  defaultSaveAdRewardPoints,
  defaultWelcomeGiftPoints,
} from '~/utils/giftHint';
import { setHomeFeedAdEvery } from '~/utils/nativeAd';
import { applyDownloadCostsFromSettings, downloadCost } from '~/utils/pricing';
Page({
  data: {
    themeStyle: '',
    loading: true,
    saving: false,
    granting: false,
    repairing: false,
    repairResultText: '',
    schemaVersionText: '',
    welcomeGiftPoints: String(defaultWelcomeGiftPoints()),
    checkinPoints: String(defaultCheckinPoints()),
    oaBonusPoints: String(defaultOaBonusPoints()),
    adRewardPoints: String(defaultAdRewardPoints()),
    adRewardDailyMax: String(defaultAdRewardDailyMax()),
    saveAdRewardPoints: String(defaultSaveAdRewardPoints()),
    saveAdRewardDailyMax: String(defaultSaveAdRewardDailyMax()),
    homeFeedAdEvery: String(defaultHomeFeedAdEvery()),
    costStatic: String(downloadCost('static')),
    costAnim: String(downloadCost('anim')),
    costWallpaper: String(downloadCost('wallpaper')),
    costAvatar: String(downloadCost('avatar')),
    costVideo: String(downloadCost('video')),
    userCount: 0,
    campaignTitle: '',
    campaignPoints: '10',
    campaigns: [],
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    if (!guardAdminPage()) return;
    applyThemeToPage(this);
    this.loadSettings();
    this.loadSchemaInfo();
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('adminManagePoints', { action: 'get' });
      const data = (res && res.data) || {};
      this.setData({
        welcomeGiftPoints: String(
          data.welcomeGiftPoints != null
            ? data.welcomeGiftPoints
            : defaultWelcomeGiftPoints(),
        ),
        checkinPoints: String(
          data.checkinPoints != null ? data.checkinPoints : defaultCheckinPoints(),
        ),
        oaBonusPoints: String(
          data.oaBonusPoints != null ? data.oaBonusPoints : defaultOaBonusPoints(),
        ),
        adRewardPoints: String(
          data.adRewardPoints != null ? data.adRewardPoints : defaultAdRewardPoints(),
        ),
        adRewardDailyMax: String(
          data.adRewardDailyMax != null
            ? data.adRewardDailyMax
            : defaultAdRewardDailyMax(),
        ),
        saveAdRewardPoints: String(
          data.saveAdRewardPoints != null
            ? data.saveAdRewardPoints
            : defaultSaveAdRewardPoints(),
        ),
        saveAdRewardDailyMax: String(
          data.saveAdRewardDailyMax != null
            ? data.saveAdRewardDailyMax
            : defaultSaveAdRewardDailyMax(),
        ),
        homeFeedAdEvery: String(
          data.homeFeedAdEvery != null
            ? data.homeFeedAdEvery
            : defaultHomeFeedAdEvery(),
        ),
        costStatic: String(
          data.costStatic != null ? data.costStatic : downloadCost('static'),
        ),
        costAnim: String(
          data.costAnim != null ? data.costAnim : downloadCost('anim'),
        ),
        costWallpaper: String(
          data.costWallpaper != null
            ? data.costWallpaper
            : downloadCost('wallpaper'),
        ),
        costAvatar: String(
          data.costAvatar != null ? data.costAvatar : downloadCost('avatar'),
        ),
        costVideo: String(
          data.costVideo != null ? data.costVideo : downloadCost('video'),
        ),
        userCount: Number(data.userCount) || 0,
        campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      });
      applyDownloadCostsFromSettings(data);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onWelcomeChange(e) {
    this.setData({ welcomeGiftPoints: (e.detail && e.detail.value) || '' });
  },

  onCheckinChange(e) {
    this.setData({ checkinPoints: (e.detail && e.detail.value) || '' });
  },

  onOaBonusChange(e) {
    this.setData({ oaBonusPoints: (e.detail && e.detail.value) || '' });
  },

  onAdRewardPointsChange(e) {
    this.setData({ adRewardPoints: (e.detail && e.detail.value) || '' });
  },

  onAdRewardDailyMaxChange(e) {
    this.setData({ adRewardDailyMax: (e.detail && e.detail.value) || '' });
  },

  onSaveAdRewardPointsChange(e) {
    this.setData({ saveAdRewardPoints: (e.detail && e.detail.value) || '' });
  },

  onSaveAdRewardDailyMaxChange(e) {
    this.setData({ saveAdRewardDailyMax: (e.detail && e.detail.value) || '' });
  },

  onHomeFeedAdEveryChange(e) {
    this.setData({ homeFeedAdEvery: (e.detail && e.detail.value) || '' });
  },

  onCostStaticChange(e) {
    this.setData({ costStatic: (e.detail && e.detail.value) || '' });
  },

  onCostAnimChange(e) {
    this.setData({ costAnim: (e.detail && e.detail.value) || '' });
  },

  onCostWallpaperChange(e) {
    this.setData({ costWallpaper: (e.detail && e.detail.value) || '' });
  },

  onCostAvatarChange(e) {
    this.setData({ costAvatar: (e.detail && e.detail.value) || '' });
  },

  onCostVideoChange(e) {
    this.setData({ costVideo: (e.detail && e.detail.value) || '' });
  },

  onCampaignTitleChange(e) {
    this.setData({ campaignTitle: (e.detail && e.detail.value) || '' });
  },

  onCampaignPointsChange(e) {
    this.setData({ campaignPoints: (e.detail && e.detail.value) || '' });
  },

  formatAlignSummary(data) {
    if (!data) return '';
    const ver = data.schemaVersion != null ? `schema v${data.schemaVersion}` : '';
    const parts = ver ? [ver] : [];
    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length) {
      results.forEach((r) => {
        if (r.kind === 'indexes') {
          const fc = r.fieldCounts || {};
          if (data.dryRun) {
            parts.push(
              `${r.label || r.id}：写入时确保 ${fc.planned || r.scanned || 0} 个索引`,
            );
            return;
          }
          const bits = [];
          if (fc.created) bits.push(`新建 ${fc.created}`);
          if (fc.skipped) bits.push(`已有 ${fc.skipped}`);
          if (fc.failed) bits.push(`失败 ${fc.failed}`);
          parts.push(
            bits.length
              ? `${r.label || r.id}：${bits.join(' · ')}`
              : `${r.label || r.id}：已齐`,
          );
          return;
        }
        const verb = data.dryRun ? '需改' : '已改';
        const line = `${r.label || r.id}：扫 ${r.scanned || 0}，${verb} ${r.patched || 0}`;
        const keys = Object.keys(r.fieldCounts || {});
        if (keys.length) {
          parts.push(
            `${line}（${keys
              .map((k) => `${k}×${r.fieldCounts[k]}`)
              .slice(0, 6)
              .join('、')}）`,
          );
        } else {
          parts.push(`${line} · 已齐`);
        }
      });
      return parts.join('\n');
    }
    // 兼容旧返回
    parts.push(
      `合计扫描 ${data.scanned || 0}，${data.dryRun ? '需对齐' : '已对齐'} ${data.patched || 0}`,
    );
    return parts.join('\n');
  },

  async loadSchemaInfo() {
    try {
      const res = await callFunction('adminAlignSchema', { action: 'info' });
      const data = (res && res.data) || {};
      const n = (data.aligners || []).length;
      this.setData({
        schemaVersionText: `当前代码 schema v${data.schemaVersion || '—'} · ${n} 项对齐规则`,
      });
    } catch (e) {
      /* 未部署云函数时忽略 */
    }
  },

  onAlignSchema() {
    if (this.data.repairing || this.data.saving || this.data.granting) return;
    wx.showModal({
      title: '对齐云库结构',
      content:
        '按当前代码 schema 扫描线上数据（合集、积分配置等），缺字段补默认；并确保热门/最新列表复合索引。是否开始？',
      confirmText: '开始扫描',
      success: (r) => {
        if (r.confirm) this.doAlignSchema();
      },
    });
  },

  async doAlignSchema() {
    this.setData({ repairing: true, repairResultText: '' });
    wx.showLoading({ title: '扫描中', mask: true });
    try {
      const scanRes = await callFunction('adminAlignSchema', { action: 'scan' });
      const scanData = (scanRes && scanRes.data) || {};
      if (scanData.schemaVersion != null) {
        this.setData({
          schemaVersionText: `当前代码 schema v${scanData.schemaVersion} · ${(scanData.aligners || []).length} 项对齐规则`,
        });
      }
      wx.hideLoading();

      const need = Number(scanData.patched) || 0;
      if (!need) {
        // 字段已齐：仍一键补索引（幂等）
        wx.showLoading({ title: '补索引中', mask: true });
        const idxRes = await callFunction('adminAlignSchema', {
          action: 'ensureIndexes',
        });
        wx.hideLoading();
        const idxData = (idxRes && idxRes.data) || {};
        const text = [
          this.formatAlignSummary(scanData),
          this.formatAlignSummary({ ...idxData, dryRun: false }),
        ]
          .filter(Boolean)
          .join('\n');
        this.setData({ repairResultText: text || '字段已齐，索引已检查' });
        wx.showModal({
          title: '对齐完成',
          content: text || '字段已齐；索引已检查/补齐。',
          showCancel: false,
        });
        return;
      }

      const confirmed = await new Promise((resolve) => {
        wx.showModal({
          title: '确认写入',
          content: this.formatAlignSummary(scanData),
          confirmText: '写入云库',
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(false),
        });
      });
      if (!confirmed) return;

      wx.showLoading({ title: '写入中', mask: true });
      const applyRes = await callFunction('adminAlignSchema', {
        action: 'applyAll',
      });
      wx.hideLoading();
      const applyData = (applyRes && applyRes.data) || {};
      const pointsChanged = !!(applyData.points && applyData.points.patched);
      const results = applyData.results || [];
      if (
        pointsChanged ||
        results.some((r) => r.id === 'app_config.points' && r.changed)
      ) {
        await this.loadSettings();
      }
      const text = this.formatAlignSummary({
        ...applyData,
        dryRun: false,
      });
      this.setData({ repairResultText: text });
      wx.showModal({
        title: '对齐完成',
        content: applyRes.message || text || '已完成',
        showCancel: false,
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '对齐失败', icon: 'none' });
    } finally {
      this.setData({ repairing: false });
    }
  },

  async onSave() {
    if (this.data.saving || this.data.granting || this.data.repairing) return;
    const welcomeGiftPoints = Number(this.data.welcomeGiftPoints);
    const checkinPoints = Number(this.data.checkinPoints);
    const oaBonusPoints = Number(this.data.oaBonusPoints);
    const adRewardPoints = Number(this.data.adRewardPoints);
    const adRewardDailyMax = Number(this.data.adRewardDailyMax);
    const saveAdRewardPoints = Number(this.data.saveAdRewardPoints);
    const saveAdRewardDailyMax = Number(this.data.saveAdRewardDailyMax);
    const homeFeedAdEvery = Number(this.data.homeFeedAdEvery);
    const costStatic = Number(this.data.costStatic);
    const costAnim = Number(this.data.costAnim);
    const costWallpaper = Number(this.data.costWallpaper);
    const costAvatar = Number(this.data.costAvatar);
    const costVideo = Number(this.data.costVideo);
    const costOk = (n) => !Number.isNaN(n) && n >= 1 && n <= 999;
    if (
      Number.isNaN(welcomeGiftPoints) ||
      welcomeGiftPoints < 0 ||
      Number.isNaN(checkinPoints) ||
      checkinPoints < 0 ||
      Number.isNaN(oaBonusPoints) ||
      oaBonusPoints < 0 ||
      Number.isNaN(adRewardPoints) ||
      adRewardPoints < 0 ||
      Number.isNaN(adRewardDailyMax) ||
      adRewardDailyMax < 0 ||
      Number.isNaN(saveAdRewardPoints) ||
      saveAdRewardPoints < 0 ||
      Number.isNaN(saveAdRewardDailyMax) ||
      saveAdRewardDailyMax < 0 ||
      Number.isNaN(homeFeedAdEvery) ||
      homeFeedAdEvery < 0 ||
      homeFeedAdEvery > 20 ||
      !costOk(costStatic) ||
      !costOk(costAnim) ||
      !costOk(costWallpaper) ||
      !costOk(costAvatar) ||
      !costOk(costVideo)
    ) {
      wx.showToast({
        title: '请填写有效数字（单价 1～999，信息流间隔 0～20）',
        icon: 'none',
      });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await callFunction('adminManagePoints', {
        action: 'set',
        welcomeGiftPoints,
        checkinPoints,
        oaBonusPoints,
        adRewardPoints,
        adRewardDailyMax,
        saveAdRewardPoints,
        saveAdRewardDailyMax,
        homeFeedAdEvery,
        costStatic,
        costAnim,
        costWallpaper,
        costAvatar,
        costVideo,
      });
      const data = (res && res.data) || {};
      const nextEvery = data.homeFeedAdEvery ?? homeFeedAdEvery;
      setHomeFeedAdEvery(nextEvery);
      applyDownloadCostsFromSettings(data);
      this.setData({
        welcomeGiftPoints: String(data.welcomeGiftPoints ?? welcomeGiftPoints),
        checkinPoints: String(data.checkinPoints ?? checkinPoints),
        oaBonusPoints: String(data.oaBonusPoints ?? oaBonusPoints),
        adRewardPoints: String(data.adRewardPoints ?? adRewardPoints),
        adRewardDailyMax: String(data.adRewardDailyMax ?? adRewardDailyMax),
        saveAdRewardPoints: String(
          data.saveAdRewardPoints ?? saveAdRewardPoints,
        ),
        saveAdRewardDailyMax: String(
          data.saveAdRewardDailyMax ?? saveAdRewardDailyMax,
        ),
        homeFeedAdEvery: String(nextEvery),
        costStatic: String(data.costStatic ?? costStatic),
        costAnim: String(data.costAnim ?? costAnim),
        costWallpaper: String(data.costWallpaper ?? costWallpaper),
        costAvatar: String(data.costAvatar ?? costAvatar),
        costVideo: String(data.costVideo ?? costVideo),
      });
      wx.showToast({ title: res.message || '已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  onGrant() {
    if (this.data.granting || this.data.saving || this.data.repairing) return;
    const title = String(this.data.campaignTitle || '').trim();
    const points = Number(this.data.campaignPoints);
    if (!title) {
      wx.showToast({ title: '请填写活动标题', icon: 'none' });
      return;
    }
    if (Number.isNaN(points) || points < 1) {
      wx.showToast({ title: '积分至少为 1', icon: 'none' });
      return;
    }
    const n = this.data.userCount || 0;
    wx.showModal({
      title: '确认发放',
      content: `将给当前已注册的 ${n} 名用户各发放 ${points} 积分（标题：${title}）。从未登录的用户不会收到。是否继续？`,
      confirmText: '确认发放',
      success: (r) => {
        if (r.confirm) this.doGrant(title, points);
      },
    });
  },

  async doGrant(title, points) {
    this.setData({ granting: true });
    wx.showLoading({ title: '发放中', mask: true });
    try {
      const res = await callFunction('adminManagePoints', {
        action: 'grantCampaign',
        title,
        points,
      });
      wx.hideLoading();
      wx.showModal({
        title: '发放完成',
        content: res.message || '已发放',
        showCancel: false,
      });
      this.setData({ campaignTitle: '', campaignPoints: '10' });
      this.loadSettings();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '发放失败', icon: 'none' });
    } finally {
      this.setData({ granting: false });
    }
  },
});
