# 成就头像框素材导入

从公开装扮仓库拉取素材，上传到云存储 `avatar_frames/`，并 seed `app_config/achievements`。

```bash
# 需根目录 .env：TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY
npm run avatar-frames:upload
npm run avatar-frames:upload -- --limit 5 --dry
npm run avatar-frames:upload -- --seed-only

# 若早期用错 set({ data }) 导致库里字段嵌套、前端看不到框：
node scripts/avatar-frames/repair-flatten.mjs

# 分类：成就已绑 / 会员专属(~24) / 其余全部 ¥3 选购
npm run avatar-frames:classify
npm run avatar-frames:classify -- --dry
```

头像框 `access`：`achievement` | `vip`（会员期可戴）| `paid`（¥3 永久）。不再使用 `pool` 暂藏。

付费槽位 `frame_skin`（¥3）需在管理端「定价」里点「首次发布」同步到微信道具后，衣橱「选购」才能拉起支付。

产品侧文案使用「头像框 / 装扮」，不展示来源品牌。
