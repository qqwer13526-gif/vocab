# vocab（背单词 PWA）· 给编码代理的工作规则

**一句话**：零依赖、无构建的原生 ES 模块 PWA；数据在 IndexedDB；Service Worker 管离线；线上是 GitHub Pages。
**一切以 `SPEC.md` + `README.md` + 本文件为准**，不要凭"看起来像"去改。

---

## 一、开工前 60 秒

1. 读 `SPEC.md`（每个设计决策的**为什么**，以及"为什么不能那样做"——很多条都是真机上翻过车的）
2. 读 `README.md`（目录结构 / 命令 / 各模块职责）
3. 读 `src/changelog.js` 第一条（当前版本号 + 这次改了什么）
4. 读本文件末尾「踩过的坑」

---

## 二、硬纪律（违反会立刻红，别绕）

### 1. 版本号三处必须一致
`src/version.js` 的 `APP_VERSION` ＝ `sw.js` 的 `VERSION` ＝ `version.json` 的 `version`

```bash
python tool/bump.py v57 v58
```

### 2. `src/changelog.js` 第一条必须是当前版本
它的 `v` 必须等于 `APP_VERSION`，否则设置页测试会红。

### 3. 说完"做好了"之前，必须跑全量验证
```bash
python tool/verify_all.py     # 27 步，最后一行必须是 RESULT: OK
```
还有：`node --test "tests/**/*.test.js"`（纯函数单测，198 项）

**没跑验证不算做完。** 单跑某个套件：
```bash
python tool/browser_test.py tests/browser/<x>.test.html            # 常规
python tool/browser_test.py tests/browser/a11y.test.html --reduced-motion   # 减弱动效
```

### 4. 新增 `src/*.js` 必须同时进 `sw.js` 清单
- **被首屏模块急切 import 的**（`app.js` / `ui-home.js` 链上）→ 进 `ASSETS`（预缓存）
- 只在某个按需界面里 import 的 → 进 `DEFERRED`
- 漏了会怎样：**离线首页直接起不来**（`data-sw=None`）✗ `tool/verify_sw.py` 会抓

### 5. TDD：先写会失败的测试
新功能先写测试 → 看到它红 → 再实现。测试先红能证明它真的能抓到这个 bug（本项目多次靠这一步发现"测试自己写错了"）。

### 6. 发版（四步，缺一不可）
```bash
python tool/bump.py vOLD vNEW                    # 1) 版本
# 2) 写 src/changelog.js 新条目（放最前）
python tool/verify_all.py                        # 3) 全量绿
python tool/release.py vNEW "一句话说明"          # 4) 建 Release + 附件（需要 GH_TOKEN）
```
`release.py` 需要 `GH_TOKEN` 环境变量。**不要把 token 写进任何文件**；历史做法是：
```powershell
$lines = "protocol=https`nhost=github.com`n" | git credential fill
$env:GH_TOKEN = ($lines | Where-Object { $_ -like 'password=*' }) -replace '^password=',''
```
推送若走代理：`git -c http.proxy=http://127.0.0.1:7897 push origin main`（视本机网络而定；先试直连）

### 7. 目录与数据边界
- 用户自己的词表在 `D:\Study\CET` —— **只读，不覆盖、不删除**；要生成新文件就另起名（同名自动 `-v2`）
- 临时脚本 / 中间产物放 `D:\mod\vocab-data\`，**不要往 `D:\Study\CET` 丢**
- App 的数据在**浏览器的 IndexedDB** 里（不在仓库里），测试通过 `tests/browser/*.test.html` 自己播种

---

## 三、代码地图（改东西先认路）

| 文件 | 职责 | 改它要小心 |
|---|---|---|
| `src/app.js` | 路由、原子换页（`show()` / `commitView()`）、更新流程 | 对调那一帧的活越少越好；`scrollTo(0,0)` 必须在 `staggerPage()` **之前** |
| `src/db.js` | IndexedDB 薄封装（`DB_VERSION`、各表） | 加表要升 `DB_VERSION`；升级代码自动建表 |
| `src/store.js` | 读数据 + 派生（`libWordIds` 认子词库、删除级联） | `libWordIds` 是**唯一**取词入口，层级/统计都靠它 |
| `src/motion.js` | 入场动画、数字滚动、**冻结看门狗** | `fill:backwards` + 延迟 = 卡片先隐形 ✗（踩过） |
| `src/swipe.js` | 词条左滑删除（touch + 弹簧） | 抑制点击只吞**行内容**，别吞删除按钮 ✗ |
| `src/dragorder.js` | 首页长按拖动排序 | 单元高度只量**可见**元素（隐藏行 rect 全 0 → 负数 ✗）；落位**不重渲染** |
| `src/ui-home.js` | 首页（词库树 / 拖动 / ⋯ 菜单） | 父库统计含子库；`moveLib` 要重新 `loadAll()` |
| `src/ui-word.js` | 词条页（chips / 子库 / 左滑） | 两行 chips 靠颜色区分，别混 |
| `src/ui-notes.js` + `src/notes.js` | 笔记/提纲（阅读区 + Markdown 子集） | 先转义再套标签；表格包 `.md-table` 横向滚 |
| `src/perf.js` / `src/edge.js` | 真机排查工具（`?perf=1` / `?edge=1`） | 只读，不影响业务 |
| `sw.js` | 预缓存 ASSETS / 按需 DEFERRED / 导航 network-first | 见纪律 4 |
| `style.css` | 全部样式（含主题变量、安全区） | 圆角统一用 `--r-lg`，别写死 12/16 ✗ |

---

## 四、踩过的坑（都是真机/真测试出来的，别再踩）

| 坑 | 事实与修法 |
|---|---|
| 离线首页起不来 | 首屏模块**急切** import 的新文件必须进 `ASSETS`，而且要看**整条 import 链**（`ui-home → dragorder → spring` 就这样断过两次 ✗） |
| 落位/切页"闪一下" | 先清 transform 再整页重渲染 = 中间 1～2 帧是旧状态 ✗。改成**原地挪 DOM 节点** |
| 拖到边缘不跟手 | 自动滚必须跑在**常驻 rAF** 里（只在 `touchmove` 里滚 → 手指停住就不滚 ✗）；卡片位移要 `+scrolledY` 补偿 |
| 折叠子库参与拖动 | 隐藏元素 `getBoundingClientRect()` 全 0 → 单元高度算成**负数** ✗ → 只量可见元素 |
| 长按误触发滚动 | 阈值 10px 对拇指太小 ✗ → 16px + 手指停住 150ms 后重新计时 + 长按到点时若页面已滚 >8px 就不启动 |
| 左滑后点删除没反应 | 抑制点击不能吞整个 item ✗ → 只吞**行内容**上的那一下 |
| 卡片圆角漏红 | 裁剪框和 `.card` **必须用同一个圆角变量**（12 vs 16 差 4px → 每个卡角漏一牙红 ✗） |
| 45 个隐藏按钮进 Tab | 收起的操作按钮要 `aria-hidden` + `tabIndex=-1`；无障碍测试用 `checkVisibility({visibilityProperty:true})` 判可见 |
| 每行挂 `will-change` | 45 行 = 45 个合成层 → 4× 降速下切页明显掉帧 ✗ → 只在"正在拖/滑"那一行加 |
| iOS 拿不到震动 | `navigator.vibrate` 在 iOS 不支持 ✗ → 用"拿起动画 + 跨卡脉冲"给手感，别承诺真震动 |
| iOS 系统滚动条 | 页面上那条白条是**系统画的**，CSS 去不掉 ✗（只能改滚动容器，见 README） |
| Service Worker 冷启动 ≈750ms | 会让每次"点更新→生效"至少慢这么多；这是平台行为 ✓ 别试图用 JS 绕 |
| 无头浏览器没有真 GPU | blur/blend/层数在无头里测不出真机手感 → 相关结论要写"需真机验证" |
| PowerShell 读 UTF-8 | 别把源码 `Get-Content | Set-Content` 来回倒（会破坏编码 ✗）；用 Python 读写 |
| Python 字符串里的引号 | 中文注释里别塞 ASCII 双引号进双引号字符串（本项目在这上面反复翻车 ✗） |
| 无头里点不了"真触摸" | 合成 `TouchEvent` 的 `touches` 不一定生效；测试里用 `Touch` 构造器 + `dispatchEvent` ✓ |

---

## 五、真机排查两把工具

| 工具 | 怎么用 | 看什么 |
|---|---|---|
| `?perf=1` | 设置 → 调试 → 「帧率浮层」（或网址加参数） | 「切页最卡的一帧」+ 判定；四个开关做归因；「系统挂起」不计入（iOS 过渡会挂 rAF） |
| `?edge=1` | 网址加参数 | 把各层涂成洋红/青/黄/绿 → 过渡时露白边是哪一层 |

---

## 六、当前状态（2026-10-29）

- 当前版本 **v59**（界面与动效优化，含 v58 的 5 项 bug 修复）；发布与部署状态以 GitHub Release / Pages 为准。线上 <https://qqwer13526-gif.github.io/vocab/>，仓库 `qqwer13526-gif/vocab`
- 本次 `verify_all` 27 步全绿 ✓，单测 200 项 ✓；导入 59 项、主题/按压 42 项通过；验收说明见项目 `成果/v59_界面与动效验收说明.md`
- 待办见项目目录 `对接说明.md` 的「待办」一节
