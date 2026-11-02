# 节日 Theme Assets

## 权限

| 角色 | 能力 |
| --- | --- |
| 管理员 | 云端「全员可见」；预览任意节日；上传顶栏/底栏；**自定义各节日持续月日区间** |
| 普通用户 | 仅当全员可见后，可开关「节日效果」；跟随日期（含自定义区间）自动换肤 |

入口：**我的 → 节日氛围**。

## 发布前检查

1. **部署云函数** `cloudfunctions/festivalConfig`（右键 → 上传并部署：云端安装依赖）
2. 本地执行 `npm install` 与 `npm run build:npm`
3. 管理员在「节日氛围」打开 **全员可见**，并为当期节日上传 **顶栏 750×188（4:1）**（底栏可选 750×90）
4. 用非管理员账号确认：能开关「节日效果」、跟随日期生效；未开全员时入口显示「敬请期待」

配置写在云库 `app_config/festival`。未部署云函数时上传/全局开关会报「云函数未部署」。

## 规格（顶栏 / 底栏分开）

| | 尺寸 | 比例 | AI 出图 |
| --- | --- | --- | --- |
| **顶栏** | **750 × 188** | **4:1** | `4:1` / `1600×400` |
| **底栏** | **750 × 90** | **≈8.318:1** | `8.318:1`（750/90） |

格式：PNG（顶栏建议底部渐隐透明；底栏可用透明异形）。

### 顶栏

仅覆盖**导航栏（含状态栏）**，不延伸到分类条。展示高度跟系统导航；`aspectFill` 等比铺满（机型导航比与 4:1 略有差别时上下微裁，**不拉伸**）。出图主体略靠中上更稳。

### 底栏

| 项 | 值 |
| --- | --- |
| 内容区 | **90rpx**（= `variable.less` `@tab-bar-height`；**不含底部安全区**） |
| 展示 | 只铺图标内容区；栏体始终实心，安全区由栏体实色填充 |

> 旧图若按 750×94 底栏等出的，请按 **750×90** 重新裁剪上传。

## 上传与裁剪

小程序内：**选图 → 按对应规格裁剪 → 确认上传**（顶栏 750×188，底栏 750×90；单指拖、双指缩放）。

电脑端：

```bash
npm run festival:fit -- --in raw.png --out banner.png --kind banner --gravity top --fade
npm run festival:fit -- --in raw.png --out bank.png --kind bank --gravity bottom
```

本地默认资源（运行时）：

```
static/festival/christmas/header.png      # 灯带
static/festival/christmas/snow-bank.png   # 底栏默认
static/festival/cny/header.png
static/festival/cny/gold-bank.png
static/festival/particles/*.png           # 首页飘落
```

- **首页**：顶栏图（云）/ 灯带 / 飘落
- **其他 Tab**：不飘落；底栏背景仍跟节日走

## 日期规则（无需逐年手填）

跟随日期用预计算表 `utils/festivalSolarTable.js`（`npm run festival:solar` 生成，覆盖约 2024–2036）匹配农历/节气；公历与西方节日本地算法。管理员可在「节日氛围 → 点具体节日 → 持续日期」覆盖为**公历月日+时分**（云 `windows`，每年循环；开始默认 `00:00`、结束默认 `23:59`，同一天也可只开几个小时）。

**续表提醒：** 表到期前 1 年（≥2035）起，管理员打开「节日氛围」会看到橙色提示；控制台每年也会 `console.warn` 一次。过期后农历类节日可能对不上，请执行：

```bash
npm run festival:solar
```

然后重新发版。可改 `scripts/gen-festival-solar-table.js` 里的 `YEAR_END` 再生成。

**内置清单（同日只生效列表中更靠前的一个）：**

| 类 | 节日 |
| --- | --- |
| 传统 | 腊八、小年、除夕、春节、元宵、龙抬头、清明、端午、七夕、中秋、重阳、冬至 |
| 法定/纪念 | 元旦、妇女节、植树节、劳动节、青年节、儿童节、建党节、建军节、教师节、国庆 |
| 情感 | 情人节、母亲节、520、父亲节 |
| 西方 | 复活节、万圣节、感恩节、圣诞节 |

**防重叠约定（默认窗口已收紧）：**

- 除夕仅当天；春节从初一起（`padBefore:0`），二者不抢
- 中秋排在国庆前：黄金周撞中秋时优先中秋
- 多数节日默认只开当天或 ±1；圣诞收窄为 12/22–12/26
- 若管理员把「持续日期」拉得很宽导致重叠，仍按列表顺序取第一个

| type | 含义 |
| --- | --- |
| `lunar` / `chuxi` | 农历日 / 除夕（初一前一天） |
| `jieqi` | 节气名 |
| `solar` / `solarRange` | 公历日 / 公历区间 |
| `nthWeekday` | 第 n 个星期几（母亲节、父亲节） |
| `easter` / `thanksgiving` | 西方算法 |

```bash
npm install
npm run build:npm
```

飘落粒子来自 [IconPark](https://iconpark.oceanengine.com/)（Apache-2.0），生成到 `static/festival/particles/`。

```bash
npm run festival:gen
```
