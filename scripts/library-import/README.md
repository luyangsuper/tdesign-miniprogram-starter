# 素材库导入

## 推荐：小程序一键导入（管理员）

1. **重新部署** `adminUpsertLibrary`（含 `otherCatalog.json` + `fluentZhNames.json` + 云存储镜像）和 `listLibrary`
2. 管理员打开「素材库」：
   - **一键导入经典动态** → 公开 API ≈720（GIF/WebP/Lottie）
   - **一键导入立体 + 反应** → Fluent ≈393 + 社区 ≈400（GIF/WebP）
3. 点击后进**云端后台任务**（集合 `lib_import_jobs`），可离开/刷新；已入库会跳过。进度看「入库 / 跳过 / 失败」。卡住约 50s 回 Hub 会自动续跑  
   过程：下载原站 → 上传云存储 `library/{sourceId}/...` → 写入 `lib_*`

### 三个源卡

| sourceId | 内容 |
| --- | --- |
| `animatemojis` | Google Noto（API） |
| `fluent-emoji` | Microsoft Fluent Animated（sitemap + 稳定 `/emojis/fluent/{slug}.gif`） |
| `animatemojis-community` | 社区 `ae-*`（sitemap hashed CDN） |

### 重建「其他」目录（开发机）

```bash
# 需有完整 emojis sitemap 文本（含 fluent-/ae-）
node scripts/library-import/build-other-catalog.mjs
node scripts/library-import/build-fluent-zh.mjs
```

会写出：

- `scripts/library-import/out/other-catalog.json`
- `cloudfunctions/adminUpsertLibrary/otherCatalog.json`
- `cloudfunctions/adminUpsertLibrary/fluentZhNames.json`

### 域名

镜像上传在云函数内完成，用户预览/下载走云存储临时链。Fluent 稳定地址来自 `animatemojis.com/emojis/fluent/`；社区走 `animatemojis-media.pages.dev`。

## 备选：本机目录上传

见历史约定：`raw/animatemojis/by-slug/<slug>/<slug>.gif|webp|json` + `import.mjs --upload`。
