# 素材库导入

小程序页已去掉导入按钮。**推荐本机脚本**直连云存储 + `lib_items`（见下方「本机高速抓取上传」）。

云函数 `adminUpsertLibrary` 仍保留导入任务能力，仅供脚本/后台需要时调用；日常浏览走 `listLibrary`。

### 下载格式（全源统一）

素材库保存到相册时：**默认 GIF**。若条目只有 WebP/PNG 等静图，客户端用 **gifski-wasm**（高质量）转成 GIF（导入微信更清晰），**转 GIF 收 1 积分（或看激励广告）**；原格式仍可按源定价。格式标签显示 GIF/WebP 等具体名。

微信侧 wasm 在 `wasm/gifski/`（`npm run gifski:wx` 从 `gifski-wasm` 生成）。该库为 **AGPL-3.0**，上线前请自行评估开源义务。

### 源卡

| sourceId | 内容 |
| --- | --- |
| `animatemojis` | Google Noto（经 AnimateMojis API ≈720；底层多为 `fonts.gstatic.com/.../notoemoji/`） |
| `fluent-emoji` | Microsoft Fluent Animated（sitemap + 稳定 `/emojis/fluent/{slug}.gif`） |
| `animatemojis-community` | 社区 `ae-*`（sitemap hashed CDN） |
| `meme-api` | [萌芽 meme-api](https://github.com/shumengya/meme-api)（≈2648；`meme.smyhub.com`；**CC BY-NC-SA 4.0**，本源免费） |
| `particlefx` | [ParticleFX](https://particlefx.studio) 粒子特效动图（一效果一条，颜色在 `meta.variants`；**4 积分**） |

### 与官方 [Noto Emoji Files](https://googlefonts.github.io/noto-emoji-files/) 的关系

| | 现有「经典动态」 | 官方 Noto Emoji Files |
| --- | --- | --- |
| 规模 | ≈720 | 约 4000 |
| 是否重复 | **同一家族**，字符大量重叠 | 官方目录更全 |
| 2D | gif / webp / lottie | svg + lottie + webp + gif |
| 3D | `png`（真正 3D） | GitHub `3D/png/512/emoji_u{cp}.png`（**不是** gstatic `128.png`，那是 2D 平面） |
| 2D CDN | gif/webp/lottie | `fonts.gstatic.com/s/e/notoemoji/latest/{codepoint}/` |

补全任务会按 codepoint 去重；若旧数据误用了 gstatic `128.png` 当 3D，再跑一遍「补全官方 Noto」会重拉真正的 3D。

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

## 本机高速抓取上传（推荐补全时用）

页面一拍一拍慢；本机可并发直接写云存储 + `lib_items`：

1. 腾讯云控制台 → 访问管理 → API 密钥，拿到 `SecretId` / `SecretKey`
2. 项目根目录建 `.env`（已 gitignore）：

```
TCB_ENV=cloud1-d4g0731mc55f853ef
TCB_SECRET_ID=AKIDxxxx
TCB_SECRET_KEY=xxxx
```

3. 执行：

```bash
# Noto 官方补全（含真 3D）
npm run library:upload -- --mode noto --concurrency 10

# 只重拉/修补 3D
npm run library:upload -- --mode noto --only-3d --concurrency 12

# Fluent + 社区
npm run library:upload -- --mode other --concurrency 8

# 萌芽 meme-api（先试跑再全量；可 --category 滑稽 / --fresh 刷新清单）
npm run library:upload -- --mode meme --limit 30 --concurrency 8
npm run library:upload -- --mode meme --concurrency 8

# ParticleFX 粒子特效（一效果一条，颜色进 meta.variants；可断点续传）
npm run library:upload:particlefx -- --limit 2
npm run library:upload:particlefx -- --resume
npm run library:upload:particlefx -- --only-slug drifting-embers-overlay

# 上传后若素材库看不到：强制 enabled + 刷新计数/预览
node scripts/library-import/repair-particlefx-source.mjs
```

列表不按颜色拆行；小程序点开后选颜色再下载。源 `particlefx` 须 `enabled: true` + `status: published`（`listLibrary` 会同步种子配置）。定价 4 积分。

## 备选：本机目录上传

见历史约定：`raw/animatemojis/by-slug/<slug>/<slug>.gif|webp|json` + `import.mjs --upload`。
