# generatePackCopy

根据 **主题分类 + 封面图** 调用 DeepSeek 识图，生成合集标题与简介；可选再生成微信公众号文案（`includeArticle`）。  
主题分类用于锁定角色/系列名（纯识图容易认错）。默认不生成公众号长文以节省 token。

国内云函数可直连 `api.deepseek.com`，无需 Cloudflare 代理。

## 环境变量

| 变量 | 说明 |
|------|------|
| `ADMIN_OPENIDS` | 管理员 openid |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com/)） |
| `DEEPSEEK_API_KEYS` | 可选，多个 Key 逗号分隔 |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-flash`（识图） |
| `DEEPSEEK_MODELS` | 可选，完整模型回退列表 |
| `DEEPSEEK_API_BASE` | 可选，默认 `https://api.deepseek.com` |

改完变量后必须 **重新上传部署** 本云函数，超时建议 **60 秒**。

若仍留着旧的 `GEMINI_API_BASE`（指向 workers.dev），请删掉，否则可能覆盖默认地址导致超时。

## 部署步骤

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/) 创建 Key 并充值（1 元通常够管理员用很久）
2. 云开发控制台 → 云函数 `generatePackCopy` → 环境变量：

```
DEEPSEEK_API_KEY=sk-xxxx
```

3. 上传并部署，超时 60 秒
4. 小程序发布页点「检测 AI 连通性」→ 再点「根据封面生成」

## 模型说明

默认使用官方识图模型 `deepseek-flash`（旧名 `deepseek-v4-flash-vision-exp` 仅作回退）。  
图片按 token 计费，详见 [DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。
