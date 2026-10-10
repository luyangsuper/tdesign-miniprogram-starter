# 趣集（微信云开发）

目录名仍为 `emojiShare`。产品名 **趣集**，内容单元叫 **合集**（表情、壁纸等均可）。上传封面 / 预览图 / **隐藏原图**；用户凭 **包月会员 / 积分** 保存原图到相册（广告通道暂关）。

## 产品流程

```
管理员上传 → 云存储 + 数据库 packs
     ↓
用户首页看封面 → 详情看预览
     ↓
保存原图鉴权：本月包月额度（36 积分，自然月重置）→ 购买积分（静态 1 积分 / 动态 2 积分）
     ↓
云函数下发该张原图临时 URL → 保存到相册 → reportDownload（含 grantType）
```

兑换码：管理员「兑换码管理」生成 → 用户「我的」兑换 → `users.vipExpireAt` / `users.points` / `users.vipMonthQuota`。  
已发放权益可在「用户权益」取消包月 / 调整积分；未使用的码可在兑换码列表作废。

### 建议定价（整包静≈¥2、动≈¥4）

| 商品 | 建议售价 | 说明 |
|------|----------|------|
| 包月 30 天 | ¥9.9 | 每月 36 积分（约 18 张动态），月底清零 |
| 季卡 / 年卡 | ¥25 / ¥68 | 约 ¥8.3 / ¥5.7 每月 |
| 积分 20 | ¥6 | ≈10 张动态或 20 张静态 |
| 积分 60（赠 6） | ¥15 | 大包略赠 |
| 积分 150（赠 20） | ¥30 | 囤积档 |

单张积分通道略贵于整包均价，避免冲击整包网盘销售。

## 命名约定

| 用户可见 | 含义 |
|----------|------|
| 趣集 | 产品名 |
| 合集 | 一套可下载素材（表情、壁纸等） |
| 预览图 | 用户可看，不能直接当下载结果 |
| 原图 | 鉴权通过后保存的真实文件 |
| 主题分类 | 如哆啦A梦、系列名等 |

## 你需要在微信开发者工具里做的事

### 1. 开通云开发

1. 用本项目的 AppID 打开工程
2. 点击「云开发」开通环境，把环境 ID 填进 `config.js` 的 `cloudEnv`
3. 确认 `project.config.json` 已有 `"cloudfunctionRoot": "cloudfunctions/"`

### 2. 创建数据库集合

| 集合 | 说明 |
|------|------|
| `packs` | 合集主表 |
| `categories` | 主题分类 |
| `users` | 登录用户与权益（`vipExpireAt` / `vipMonthQuota` / `vipQuotaPeriod` / `points`）；订阅额度 `newPackNotifyCredits` / `feedbackNotifyCredits` |
| `redeem_codes` | 兑换码（`vip_days` / `points`；`unused` / `used` / `disabled`） |
| `download_logs` | 下载记录（含 `grantType`: vip / points） |
| `feedback` | 用户意见反馈（`content` / `contact` / `status`） |

建议索引：

- `packs`：`status` + `createdAt`（降序）；`downloadCount`（降序）
- `redeem_codes`：`code`（唯一）；`status` + `createdAt`
- `download_logs`：`createdAt`（降序）
- `users`：`vipExpireAt`；`lastLoginAt`（降序，openid 片段搜索）

**权限建议：** 集合对客户端「所有用户不可读写」，只走云函数。

### 3. 上传并部署云函数

右键各目录 →「上传并部署：云端安装依赖」（含 `dayjs` 的函数务必云端安装依赖）。时间格式统一走各函数内 `time.js`（dayjs，上海时区）。管理端相关务必部署：

| 云函数 | 作用 |
|--------|------|
| `login` / `userEntitlement` | 登录、查询 / 兑换权益 |
| `adminCreateCodes` | 批量生成兑换码 |
| `adminManageCodes` | 兑换码列表 / 作废 |
| `adminManageUser` | 查用户、取消包月、设天数 / 积分 |
| `getEmojiDownload` | 鉴权下发原图 |
| `reportDownload` | 保存成功后 +1，并记录 `grantType` |
| `userSubscribe` | 记录订阅消息发送额度（新合集 / 反馈） |
| `submitFeedback` | 写入反馈；向有额度的管理员推订阅消息 |
| `notifyNewPack` | 新合集上线推送给已订阅用户 |

### 4. 配置管理员

「我的」复制 openid → 云函数环境变量 `ADMIN_OPENIDS` + `config.js` 的 `adminOpenids`。

### 5. 订阅消息（新合集 + 管理员反馈通知）

1. 小程序后台 → **订阅消息** → 选用长期模板（类目需匹配）  
   - **新合集**：已有 `config.subscribeNewPackTmplId`（thing1 作品名 / thing2 分类 / time3 时间 / thing4 简介）  
   - **反馈通知（仅管理员）**：模板「留言通知」`jYzc2X5SfzI89vwnNVGU00v3x4poeZhl9KIkiOaBvm4`（name1 留言人 / thing2 留言内容 / time3 留言时间），已写入 `config.subscribeFeedbackTmplId`
2. 云函数 `submitFeedback` 可设环境变量 `SUBSCRIBE_FEEDBACK_TMPL_ID`（可选，默认同上）；并确认已勾选 `subscribeMessage.send`
4. 真机：管理员在「我的 → 反馈通知」点同意攒额度 → 用户提交反馈 → 管理员收到服务通知  
5. 云开发控制台集合 `feedback` 可查看全部反馈正文

一次性订阅每同意一次 +1 发送额度；额度用尽需管理员再次点击授权。

### 6. 广告位（暂关）

`config.js` 的 `rewardedAdUnitId` 留空则无免费通道；无包月/积分时引导兑换。接好广告后再填广告位 ID。

### 7. 默认头像（DiceBear）

未选微信头像时，用 [DiceBear](https://www.dicebear.com/) 按 openid 固定生成可爱头像（`config.avatarStyle`，默认 `fun-emoji`）。  
小程序后台 → 开发管理 → 服务器域名 → **downloadFile 合法域名** 增加：`https://api.dicebear.com`（开发期可勾选不校验合法域名）。

## 管理入口（「我的」管理员可见）

| 入口 | 说明 |
|------|------|
| 上传合集 / 管理分类 | 内容管理 |
| 兑换码 | 生成、列表、作废未用码 |
| 用户权益 | 按 openid 取消包月、开通/续期、调整积分 |

## 目录要点

```
cloudfunctions/          云函数
pages/home/              合集列表（仅封面）
pages/pack/detail/       预览 + 鉴权保存原图
pages/my/                权益 + 兑换 + 管理入口
pages/admin/upload/      上传合集
pages/admin/categories/  管理分类
pages/admin/codes/       兑换码管理
pages/admin/users/       用户权益
config.js                环境 ID / 广告位 / 管理员
```
