# 背单词（vocab-pwa）

自己的词表，**看英文写中文 / 看中文写英文**，两个方向都是手打（不是选择题）；
词可以同时归入多个分级词库；按遗忘曲线自动排复习。iPhone 和 Windows 都能装，**离线能用**。

纯 HTML + CSS + 原生 JS，零依赖、零 CDN；数据存在你自己浏览器的 IndexedDB 里，不上传任何服务器。

---

## 马上用起来

### 电脑上（最快）

双击 **`启动背单词.bat`**（或者在这个目录里跑 `python tool/serve.py`），
浏览器会自动打开 <http://127.0.0.1:5173>。

> 为什么要起这个小服务？因为「装成应用」「离线可用」这些能力只在 http(s) 下生效，
> 直接双击 `index.html`（file://）用不了 service worker。

### 装成 Windows 应用

用 Edge 打开 <http://127.0.0.1:5173> → 地址栏右侧的**安装**图标（或 `…` 菜单 → 应用 → 安装此站点）
→ 装好后从开始菜单启动，独立窗口，断网也能用。

### 装到 iPhone

1. 先把这份代码发布到一个 https 地址（见下面「发布到 GitHub Pages」，大约 5 分钟）
2. iPhone 上用 **Safari**（必须 Safari）打开那个地址 → 分享按钮 → **添加到主屏幕**
3. 从主屏幕图标打开就是全屏应用；想验证离线，开飞行模式再打开一次

> 想先在自己手机上试一次、又不想发 GitHub 的话，可以用 Cloudflare 的临时隧道：
> `cloudflared tunnel --url http://127.0.0.1:5173`，它会给你一个 `https://xxx.trycloudflare.com` 地址，
> 手机浏览器打开即可（临时地址，关了电脑就失效）。

---

## 导入自己的词表

1. 在 Excel 里**选中「单词」和「释义」两列**（整列选，不要选标题行也行）
2. `Ctrl+C` 复制
3. 打开应用 → 底部「导入」→ 粘进大框里
4. 它会自动认出哪列是单词、哪列是释义（**认错了可以手动改**），下面给出前 5 行预览
5. 勾上要放进哪个词库（可以多选，也可以现场新建）→ 点「导入」

也可以点「选择文件…」直接选文件，**`.xlsx` 也能直接选**（应用会自己解压读出来，不需要任何库或转换），
另外还支持 `.csv` / `.tsv` / `.txt`（Excel 另存的 CSV 也认，UTF-8 和 GBK 都能读）。
老式的 `.xls` / `.ods` 读不了，请在 Excel/WPS 里「另存为 .xlsx」。

**它会自动处理**：
- 标题行、`总词数 187` 这种统计行、空行 → 跳过
- 表头不在第一行（你的《英语词汇背诵检查表》表头在第 4 行）→ 照样认得出
- 释义是英汉混排（`take in or soak up吸收；使专心`）→ 存两条，写「吸收」就算对
- 「常用搭配」列 → 存进例句字段
- 已经有的词：默认跳过，也可以选「合并释义」把新释义并进去
- 整个导入是**一个事务**：中间出错就一条都不写，不会留下半截数据

想先看看界面长什么样：打开 <http://127.0.0.1:5173/tool/seed_demo.html> 点「灌入示例数据」，
回到首页就有了 2 个词库 + 12 个词（含到期的复习词）。「清空全部数据」可以随时归零。

### 更省事的办法（可选）：批量把 Excel 转成 `.tsv`

应用本身已经能直接读 `.xlsx` 了，所以这一步不是必须的。但如果你想把很多份表一次转好、
或者想在电脑上先看一眼认出了多少词，可以用这个脚本：

```powershell
python tool\xlsx_to_tsv.py                                    # 自动在桌面/文档/下载/D:\Study 等位置找词表
python tool\xlsx_to_tsv.py "D:\Study\CET\英语词汇背诵检查表（二）.xlsx"   # 指定文件
python tool\xlsx_to_tsv.py "D:\Study\CET" --out "D:\Study\CET\导入用"    # 整个文件夹
```

转换结果放在原文件旁边（同名 `.tsv`），并且会自动用应用那套解析逻辑跑一遍自检，
告诉你认出了多少词、哪列是哪列。

你的《英语词汇背诵检查表（一）》已经转好了一份：
`D:\Study\CET\英语词汇背诵检查表（一）.tsv`（187 个词）。

---

## 复习规则（Leitner 六盒）

| 盒子 | 答对后 | 该盒子的间隔 |
|---|---|---|
| 1 | → 2 | 10 分钟 |
| 2 | → 3 | 1 天 |
| 3 | → 4 | 3 天 |
| 4 | → 5 | 7 天 |
| 5 | → 6 | 21 天 |
| 6（已掌握） | → 6 | 60 天 |

- 下次复习时间 = 现在 + **判完之后所在盒子**的间隔（新词第一次答对 → 1 天后见）
- **答错** → 回盒子 1，10 分钟后再来
- **差点**（拼错一个字母）**不升不降**：
  - 中→英：提示「再试一次」，**不算错、不写库**，重打对了才算过
  - 英→中：给「算我对」按钮，由你自己定夺
- 每日队列 = 到期的复习词（按到期时间）+ 新词（默认每天 10 个）

判定细节：忽略大小写、空格、全角半角、标点；英文侧只忽略首尾空格，内部空格算数（`ice cream` ≠ `icecream`）；
撇号算数（`can't` ≠ `cant`）。

---

## 想改代码

```
index.html            应用外壳（四个界面的容器 + hash 路由）
style.css             全部样式（含深色模式）
sw.js                 service worker（预缓存清单在这里，**加了新模块记得登记**）
manifest.webmanifest  PWA 信息
src/
  app.js              路由 + 建元素的小助手 el()
  db.js               IndexedDB 封装（words / libs / links / prog / meta）
  store.js            各界面共用的数据读取与小工具
  srs.js              遗忘曲线（纯函数）
  judge.js            答案归一化与判定（纯函数）
  parse.js            词表解析、认列、导入计划（纯函数）
  ui-home.js          界面 A：库列表
  ui-practice.js      界面 B：练习
  ui-import.js        界面 C：导入
  ui-word.js          界面 D：词条
tests/
  *.test.js           纯逻辑单元测试（node --test）
  browser/*.test.html 浏览器内测试（数据层 + 四个界面 + 布局 + 无障碍）
  fixtures/           测试用的词表样例
tool/
  serve.py            本地服务（开发用）
  verify_all.py       ★ 一条命令跑完全部验证
  xlsx_to_tsv.py      Excel 词表 → 可导入的 .tsv（自动查找 + 转完自检）
  check_tsv.mjs       自检用：拿应用自己的解析逻辑数一遍有多少词
  shots.py            给界面截图（shots/ 目录）
  seed_demo.html      灌示例数据 / 清空数据
  publish_github.py   发到 GitHub Pages（建仓库 / 推送 / 开 Pages）
  headless.py         无头浏览器管道（所有验证脚本共用）
```

改完跑一遍：

```powershell
python tool\verify_all.py          # 全部（约 3 分钟）
python tool\verify_all.py --quick  # 只跑纯逻辑单元测试（几秒）
```

它会依次跑：65 项纯逻辑单元测试 → PWA 离线可用 → 数据层 → 四个界面 → 布局 → 无障碍，
最后对照 `SPEC.md §10` 打印验收清单。

**改完代码要发版时，别忘了把 `sw.js` 里的 `VERSION` 加一**（`v3` → `v4`）。
不然手机上装好的那份会先用旧缓存里的 JS（"先给缓存、后台更新"策略），要刷新两次才生效。
版本号一变，service worker 激活时会把旧缓存清掉，下次打开就是新的。

---

## 发布到 GitHub Pages

在这个目录里执行（把 `你的用户名` 换成你的 GitHub 用户名）：

```powershell
git remote add origin https://github.com/你的用户名/vocab.git
git branch -M main
git push -u origin main
```

然后在 GitHub 网页上：仓库 **Settings → Pages → Source 选 `Deploy from a branch` → Branch 选 `main` / `root` → Save**。
等 1 分钟，地址就是 `https://你的用户名.github.io/vocab/`。

> 免费账号的 Pages 需要仓库是 **public**。词表数据存在浏览器里，**不会**跟着代码上传。
>
> 如果 `git push` 报 `Connection was reset`（这台机器直连 GitHub 偶尔会这样），走本地代理再来一次：
> ```powershell
> git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
> ```

---

## 已知限制

- **没有发音**（这一版刻意先做纯文字）
- iOS 上 **PWA 没有可靠的后台通知**：「今天该复习了」只能等你打开应用时才结算
- iOS Safari 长期不访问可能清理站点数据 → 第二阶段的云同步同时也是备份
- 没有账号、没有分享、暂时没有多设备同步

## 第二阶段的计划（还没有做）

接 Supabase：四张表一一对应，冲突按「最后写入为准」，登录用邮箱魔法链接。
数据结构已经为它留好了 `updatedAt` + 软删除（`deleted`），到时候只需要加一个同步模块。
