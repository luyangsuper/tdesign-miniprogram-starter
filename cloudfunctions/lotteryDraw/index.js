const cloud = require('wx-server-sdk');
const { scanAndDrawDue, ensureCollection } = require('./draw');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 定时触发：扫到期抽奖并开奖。
 * 云开发控制台为本函数配置「定时触发器」，建议每 1 分钟：0 * * * * * *
 */
exports.main = async () => {
  try {
    await ensureCollection(db, 'lotteries');
    await ensureCollection(db, 'lottery_entries');
    const data = await scanAndDrawDue(cloud, db, 10);
    return { ok: true, data };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'FAIL',
      message: (e && e.message) || '扫表开奖失败',
    };
  }
};
