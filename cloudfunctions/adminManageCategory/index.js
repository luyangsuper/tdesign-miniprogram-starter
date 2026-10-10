const cloud = require('wx-server-sdk');
const {
  normalizeCategoryName,
  isBuiltinId,
  createCustomCategoryId,
  ensureAndListCategories,
  assertAdmin,
} = require('./categories');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  const action = event.action || 'list';
  const col = db.collection('categories');

  try {
    if (action === 'list') {
      const categories = await ensureAndListCategories(db);
      return { ok: true, data: { categories } };
    }

    if (action === 'add') {
      const name = normalizeCategoryName(event.name);
      if (!name) {
        return { ok: false, code: 'BAD_PARAM', message: '分类名无效（1-32字）' };
      }
      const all = await ensureAndListCategories(db);
      if (all.some((c) => c.name === name)) {
        return { ok: false, code: 'DUP', message: '分类名已存在' };
      }
      const id = createCustomCategoryId();
      const sort = (all.length ? Math.max(...all.map((c) => c.sort || 0)) : 0) + 1;
      await col.add({
        data: {
          id,
          name,
          builtin: false,
          sort,
          status: 'active',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      return { ok: true, data: { categories: await ensureAndListCategories(db), id } };
    }

    if (action === 'rename') {
      const id = event.id;
      const name = normalizeCategoryName(event.name);
      if (!id || !name) {
        return { ok: false, code: 'BAD_PARAM', message: '参数错误' };
      }
      const found = await col.where({ id }).limit(1).get();
      const doc = (found.data || [])[0];
      if (!doc) {
        return { ok: false, code: 'NOT_FOUND', message: '分类不存在' };
      }
      await col.doc(doc._id).update({
        data: { name, updatedAt: db.serverDate() },
      });
      try {
        const packs = await db.collection('packs').where({ categoryId: id }).limit(100).get();
        await Promise.all(
          (packs.data || []).map((p) =>
            db.collection('packs').doc(p._id).update({
              data: { categoryName: name, updatedAt: db.serverDate() },
            }),
          ),
        );
      } catch (e) {
        console.warn('sync pack categoryName', e.message);
      }
      return { ok: true, data: { categories: await ensureAndListCategories(db) } };
    }

    if (action === 'remove') {
      const id = event.id;
      if (!id) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少 id' };
      }
      if (isBuiltinId(id)) {
        return { ok: false, code: 'FORBIDDEN', message: '内置分类不可删除' };
      }
      const found = await col.where({ id }).limit(1).get();
      const doc = (found.data || [])[0];
      if (!doc) {
        return { ok: false, code: 'NOT_FOUND', message: '分类不存在' };
      }
      await col.doc(doc._id).remove();
      try {
        const packs = await db.collection('packs').where({ categoryId: id }).limit(100).get();
        await Promise.all(
          (packs.data || []).map((p) =>
            db.collection('packs').doc(p._id).update({
              data: { categoryId: '', categoryName: '', updatedAt: db.serverDate() },
            }),
          ),
        );
      } catch (e) {
        console.warn('clear pack category', e.message);
      }
      return { ok: true, data: { categories: await ensureAndListCategories(db) } };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'MANAGE_FAIL', message: e.message || '操作失败' };
  }
};
