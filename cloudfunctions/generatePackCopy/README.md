# generatePackCopy

根据 **主题分类 + 封面图** 调用大模型识图，生成合集标题与简介；可选再生成微信公众号文案（`includeArticle`）。

## 推荐：云开发体验模型（免费）

若已参加 [小程序成长计划](https://docs.cloudbase.net/ai/model/overview)，可免自备 API Key：

1. 云开发控制台 → **AI+** → 开通（体验模型免费额度）
2. 本云函数 `package.json` 使用支持 `cloud.ai()` 的 `wx-server-sdk`（≥ `3.0.5-beta.1`）
3. 右键本目录 → **上传并部署：云端安装依赖**，超时 **60 秒**
4. 小程序 **我的** 页连点顶栏「我的」**3 次**进入 AI 配置 → **添加云开发体验** → 点「刷新模型」→ 选识图模型 → 设为当前 → 保存
5. 点「测试联通」通过后，上传页即可生成

成长计划可抵扣模型（[公告](https://docs.cloudbase.net/ai/ai-inspire-plan-new-models-2026-11)）：

| 模型 | 识图 |
|------|------|
| `hy4` | ✅ |
| `hy4-preview` | ❌ |
| `hy3` | ❌ |
| `deepseek-v4.1-flash` | ✅ |
| `deepseek-v4.1-flash-1017` | ✅ |

封面识图优先 `hy4` 或带识图能力的 DeepSeek 体验款。环境并发约 5 路。

调用方式见 [wx-server-sdk 调用](https://docs.cloudbase.net/ai/model/wx-server-sdk-access)。

## 自备 OpenAI 兼容接口

在「AI 配置」添加 baseURL + API Key，加载模型后选用。配置写入 `app_config/ai`。

## 云函数 action

| action | 说明 |
|--------|------|
| `getConfig` / `saveConfig` | 读写多套配置 |
| `listModels` | 拉模型列表（体验模型返回固定列表） |
| `ping` | 测试联通 |
| （默认） | 按当前配置生成文案 |

## 环境变量（可选回退）

| 变量 | 说明 |
|------|------|
| `ADMIN_OPENIDS` | 管理员 openid |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEYS` | 自备 Key 回退 |
| `DEEPSEEK_MODEL` / `DEEPSEEK_MODELS` | 模型回退 |
| `DEEPSEEK_API_BASE` | 默认 `https://api.deepseek.com` |

无自备 Key 且未保存过配置时，默认回退为「云开发体验模型」。
