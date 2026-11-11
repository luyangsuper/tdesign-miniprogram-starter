# Kubai UI icons

`<kubai-icon name color size />` 使用 **远程 SVG**（不进代码包）：

`https://icons.kubai.design/api/icon/{name}.svg?color={hex}&size=96`

- 组件：`components/kubai-icon`
- 解析：`utils/kubaiIcon.js` → Kubai [Static SVG API](https://icons.kubai.design/docs/static/)
- 动效：官网 hover morph 依赖 DOM SVG，小程序改为 **点击弹跳**（460ms，同官网缓动）；`motion="{{false}}"` 可关
- 后台：将 `icons.kubai.design` 加入 **downloadFile 合法域名**
- 可选离线 PNG 备份（默认不打包）：`npm run icons:gen -- --ui-png`
