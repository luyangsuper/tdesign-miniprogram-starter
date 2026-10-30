# 节日 Theme Assets

## 权限

| 角色 | 能力 |
| --- | --- |
| 管理员 | 云端「全员可见」；预览任意节日；上传顶栏/底栏；**自定义各节日持续月日区间** |
| 普通用户 | 仅当全员可见后，可开关「节日效果」；跟随日期（含自定义区间）自动换肤 |

入口：**我的 → 节日氛围**。

## 发布前检查

1. **部署云函数** `cloudfunctions/festivalConfig`（右键 → 上传并部署：云端安装依赖）
2. 本地执行 `npm install` 与 `npm run build:npm`（含农历库）
3. 管理员在「节日氛围」打开 **全员可见**，并为当期节日上传 **顶栏 750×200**（底栏可选）
4. 用非管理员账号确认：能开关「节日效果」、跟随日期生效；未开全员时入口显示「敬请期待」

配置写在云库 `app_config/festival`。未部署云函数时上传/全局开关会报「云函数未部署」。

## 首页顶栏背景图

仅覆盖**导航栏（含状态栏）**，不延伸到分类条。

| 项 | 值 |
| --- | --- |
| 尺寸 | **750 × 200** px |
| 比例 | **75 : 20**（约 3.75 : 1） |
| 格式 | PNG（建议底部渐隐透明） |
| 真机 | 高度跟导航实测，`aspectFill` 裁切 |

无内置默认顶栏图，需管理员按节日自行上传。旧版 750×280 图仍可用，会被裁切到导航高度。

## 底栏背景图

| 项 | 值 |
| --- | --- |
| 建议尺寸 | **750 × 160** px |
| 格式 | **透明 PNG**，支持异形；过高会按限高 `aspectFill` 贴底裁切 |
| 展示 | 背景图原样铺底，栏体透明不加遮罩；出图时请在图标文字区域留出干净视觉带 |

上传后覆盖本地默认；清除后回退到 `static/festival/<id>/` 下的默认 bank（若有）。

## 上传与裁剪

小程序内流程：**选图 → 固定比例裁剪 → 确认后才上传裁剪结果**（顶栏 750×200，底栏 750×160；单指拖、双指缩放）。

AI 用任意常见比例出图即可，不必卡最终尺寸。电脑端可选脚本：

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

跟随日期默认用本地库 [lunar-javascript](https://github.com/6tail/lunar-javascript) 按 `FESTIVAL_PRESETS[].rule` 计算。管理员可在「节日氛围 → 点具体节日 → 持续日期」覆盖为**公历月日区间**（云 `windows`，每年循环）。

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

装依赖后需构建小程序 npm（含拷贝 lunar）：

```bash
npm install
npm run build:npm
```

飘落粒子来自 [IconPark](https://iconpark.oceanengine.com/)（Apache-2.0），生成到 `static/festival/particles/`。

```bash
npm run festival:gen
```
