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

## 快速开始（my-neuro live-2d）

1. 将本仓库**整个文件夹**复制到：`live-2d/plugins/community/bilibili-tools`（文件夹名可与 `metadata.json` 中 `name` 一致）。
2. **Node 依赖（二选一）**  
   - **免安装（推荐小白）**：将本目录下的 **`node_modules.zip` 解压到当前文件夹**，解压后应出现与 `index.js` 同级的 **`node_modules`** 目录。  
   - **命令行安装**：已安装 Node.js 时，在本目录执行 `npm ci`（或 `npm install`）。
3. **Python（字幕 / Whisper）**  
   - 字幕（与 BiliRead 同款）：在所用 Python 环境中执行  
     `pip install -r requirements.txt`  
   - 需要无字幕时的 **Whisper 转录**：额外执行  
     `pip install -r requirements-whisper.txt`  
     并安装系统级 **ffmpeg**（Whisper / yt-dlp 需要）。
4. 复制 `bili_config.example.json` → `bili_config.json`，填入 B 站登录字段；或使用工具 **`login_bilibili_by_qrcode`** 扫码写入。
5. 在 my-neuro **插件配置**中填写：`python_executable`、总结用 **`summary.api_key`**（及可选 API 地址与模型）。

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

## 参考

- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)  
- 字幕方案与 [BiliRead / bilibili-api-python](https://github.com/SocialSisterYi/bilibili-API-collect) 生态一致  
