# Pack mood overlays

氛围 GIF **已上传云存储**，不进小程序包体。

- 云路径：`assets/pack-mood/{moodId}.gif`
- fileID 清单：`utils/packMoodAssets.js`（由 `scripts/upload-pack-mood-fx.mjs` 生成）
- 素材： [ParticleFX Studio](https://particlefx.studio/effects)（免费商用、无需署名）

重新拉取并上传：

```bash
node scripts/upload-pack-mood-fx.mjs
```

本目录下的 `*-strip.webp` 仅作本地预览备用，可删；正式展示走云端 GIF。
