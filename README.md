# B站也逃脱不了肥牛大人的魔爪

原 [my-neuro-bilibili-mcp](https://github.com/A-night-owl-Rabbit/my-neuro-bilibili-mcp) 已**整体迁移为 my-neuro live-2d 社区插件**形态。本仓库内容与 `live-2d/plugins/community/bilibili-tools` 插件目录一致，便于单独分发与版本管理。

## 仓库更新说明（中文）

| 项目 | 说明 |
|------|------|
| **形态变更** | 旧版为 `server-tools/bilibili_mcp.js` 单文件工具；现改为标准 **Plugin**（`index.js` + `metadata.json` + 多模块），放入 `plugins/community/` 即可加载。 |
| **显示名称** | 插件在面板中显示为 **「B站也逃脱不了肥牛大人的魔爪」**（`metadata.json` 的 `displayName`）。 |
| **依赖** | 本仓库含 **`package-lock.json`**。因 GitHub 对「直接提交的 `node_modules` 目录」会触发推送保护，故提供 **`node_modules.zip`**：下载/克隆后在本目录**解压**得到 `node_modules` 文件夹即可，**无需 npm**（开箱即用，解压工具用系统自带或 7-Zip 均可）。若推送被拒或你希望自行安装，仍可在插件目录执行 **`npm ci`**。Python 侧见下文。 |
| **隐私与密钥** | **不会**收录任何用户的 `bili_config.json`、API Key、本地 Python 路径等。请复制 `bili_config.example.json` 为 `bili_config.json` 并自行填写；在 my-neuro 插件设置中填写总结用 API Key 与 `python_executable`。 |
| **总结提示词** | 作者私有长版 AI system 提示词**未放入仓库**。默认使用 `summary_system_prompt.default.txt`；你可复制 `summary_system_prompt.example.txt` 的说明，自行创建 `summary_system_prompt.txt` 覆盖（该文件已列入 `.gitignore`）。 |

## 使用前必读：避免「综合信息 / 字幕 / 转录」报错

若工具返回 **「未配置 python_executable 或解释器路径无效」**、**「未在指定路径找到 Python 解释器」**，或提示 **pip install -r requirements.txt**，说明 **插件里填的 Python 路径不对**，或 **没有在同一个 Python 里安装依赖**。下面按顺序做一次即可排除绝大多数问题。

### 1. `python_executable` 填什么？

- 必须填 **`python.exe` 的完整绝对路径**（一个真实存在的文件），例如：
  - `C:\Users\你的用户名\AppData\Local\Programs\Python\Python312\python.exe`
  - `K:\ai\envs\my-neuro\python.exe`（虚拟环境）
- **不要**填：`python`、`py`、只填到目录、或从教程/别人机器上复制的路径（例如 `C:\Users\20142\...` 在你电脑上很可能不存在）。
- **不要**填 **Windows「应用执行别名」** 或商店占位路径；若路径里有 `WindowsApps` 且文件并不存在，请改用 [python.org](https://www.python.org/downloads/) 安装的 Python 或 `py launcher` 查到的路径（见下文）。

在资源管理器地址栏粘贴路径（含 `python.exe`），能打开并看到文件，才算路径有效。

### 2. Windows：如何查到本机正确的 `python.exe`？

在 **命令提示符（cmd）** 或 **PowerShell** 中执行（任选其一）：

```bat
py -0p
```

会列出已注册的 Python 及路径，选你要用的那一行里的 **`...\python.exe`**，完整复制到插件配置。

若没有 `py`，可试：

```bat
where python
```

以输出为准；若指向 `WindowsApps` 且运行异常，请安装官方 Python 后再查。

### 3. 安装依赖（必须与 `python_executable` 是同一个解释器）

1. 打开终端，`cd` 到 **本插件目录**（与 `requirements.txt`、`index.js` 同级）。
2. 用 **即将填入插件的同一个** `python.exe` 安装依赖（推荐写法）：

```bat
"C:\路径\到\python.exe" -m pip install -r requirements.txt
```

**为什么要加 `-m pip`？** 这样包装进当前这个 `python.exe`，不会出现「命令行里 pip 装了一套，插件用的却是另一个 Python」的情况。

- **字幕**：依赖 `requirements.txt`（含 `bilibili-api-python`）。
- **无字幕时 Whisper 转录**：还需额外安装 Whisper 相关包（见仓库内 `requirements-whisper.txt` 若存在；否则需自行安装 `yt-dlp`、`openai-whisper`、`torch` 等，并安装系统级 **ffmpeg**）。

### 4. Python 版本建议

建议使用 **Python 3.10～3.12** 64 位。过新的大版本（例如预览版或极新稳定版）可能导致部分依赖暂无 wheel，安装失败；若 `pip install` 报错，可换 3.11/3.12 再试。

### 5. 报错与原因速查

| 现象 | 常见原因 |
|------|----------|
| 未配置或路径无效 | `python_executable` 为空、路径拼错、从别的电脑抄的路径、文件已被卸载 |
| 字幕不可用 + 提示 pip install | 路径有效但未执行 `-m pip install -r requirements.txt`，或装到了别的 Python |
| 转录提示找不到解释器 | 同上；或路径指向了不存在的 `pythoncore-*` 目录（微软商店/安装器残留路径） |

---

## 仓库与形态说明

| 项目 | 说明 |
|------|------|
| **形态** | 标准 Plugin：`index.js` + `metadata.json` + 多模块，放入 `live-2d/plugins/community/bilibili-tools`（文件夹名可与 `metadata.json` 的 `name` 一致）。 |
| **Node 依赖** | 仓库含 `package-lock.json`。若提供 `node_modules.zip`，解压到插件目录即可；否则在本目录执行 `npm ci` 或 `npm install`。 |
| **隐私** | 勿提交 `bili_config.json`、API Key、个人 `python_executable`。可复制 `bili_config.example.json` 为 `bili_config.json` 并本地填写。 |

---

## 快速开始（my-neuro live-2d）

1. 将本文件夹放到：`live-2d/plugins/community/bilibili-tools`。
2. 处理 Node 依赖：解压 `node_modules.zip` **或** 在本目录执行 `npm ci`。
3. **配置 Python**：按上文填写 `python_executable` 并执行 `pip install -r requirements.txt`（同一解释器）。
4. 复制 `bili_config.example.json` → `bili_config.json`，填入 B 站登录信息；或使用工具 **`login_bilibili_by_qrcode`** 扫码写入。
5. 在 my-neuro **插件配置** 中填写：`python_executable`、总结用 **`summary.api_key`**（及可选 API 地址与模型）。

---
## 工具列表

| 工具名 | 功能 |
|--------|------|
| `login_bilibili_by_qrcode` | 扫码登录 B 站并保存凭证 |
| `search_bilibili_video` | 关键词搜索视频 |
| `get_bilibili_video_comprehensive_info` | 视频综合信息（含字幕优先、降级 Whisper、可选 AI 总结） |
| `send_bilibili_comment` | 发表评论 |
| `send_bilibili_danmaku` | 发送弹幕 |
| `get_bilibili_ranking` | 分区排行榜 |
| `interact_bilibili_video` | 点赞 / 投币 / 收藏 / 一键三连 |

## 版本与作者

- 插件版本见 `metadata.json` 的 `version` 字段。  
- 作者：爱熬夜的人形兔  

## 想邀请你，做这只小牛的“云饲养员”

做这个桌宠的初衷，其实是因为自己一个人工作学习的时候，总觉得屏幕里空落落的。看到大家都在使用，我就觉得熬夜写代码、调教AI的日子都亮闪闪的。🌟

不过，肥牛现在还在长身体（其实是我想给它做更多有趣的插件），养一只数字小牛其实也挺“费草”的哈哈。🌱

如果你在这只小肥牛这里获得过哪怕一秒钟的治愈，或者觉得它算个合格的桌面搭子，要不要考虑成为它的“云饲养员”呀？

你的每一次充电，都不是在打赏我，而是在给这只肥牛注入一点点魔法值。让它能变得更聪明、更通人性、能听懂你更多的碎碎念。

不用有压力哦！你愿意打开它，就是对我最大的鼓励啦。如果刚好有余力，就请肥牛喝瓶快乐水叭，它会记住你的味道的！🥤❤️

爱发电 https://ifdian.net/a/0923A
