# Bilibili MCP 工具集

[my-neuro](https://github.com/A-night-owl-Rabbit/my-neuro) live-2d 的 B站 server-tool，提供视频搜索、排行榜、信息获取、内容转录与智能总结、评论与弹幕发送、点赞投币收藏等功能。

## 快速开始

1. 将 `bilibili_mcp.js` 放入 `live-2d/server-tools/` 目录
2. 在 `live-2d` 目录安装 JS 依赖：`npm install bilibili-api-ts qrcode-terminal md5`
3. 安装 Python 依赖（用于视频语音转录）：`pip install yt-dlp openai-whisper torch ffmpeg-python`
4. 在 `bili_config.json` 中填入 B站凭据，或使用扫码登录工具自动获取
5. 在 `bilibili_mcp.js` 中填入硅基流动 API Key（用于视频内容总结）

## 配置说明

### bili_config.json

| 字段 | 说明 |
|------|------|
| SESSDATA | B站登录凭证 |
| bili_jct | CSRF Token |
| DedeUserID | B站用户ID |
| refresh_token | 刷新令牌 |
| buvid3 / buvid4 | 设备标识（可自动获取） |
| b_nut | 时间戳（可自动生成） |

> 凭据可通过 `login_bilibili_by_qrcode` 工具扫码自动获取并保存。

### 硅基流动 API（视频内容总结）

在 `bilibili_mcp.js` 顶部的 `SUMMARY_API_CONFIG` 中配置：

```javascript
const SUMMARY_API_CONFIG = {
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    apiKey: '你的硅基流动API Key',
    model: 'deepseek-ai/DeepSeek-V3.2'
};
```

## 工具列表

| 工具名 | 功能 |
|--------|------|
| `login_bilibili_by_qrcode` | 扫描二维码登录B站 |
| `search_bilibili_video` | 根据关键词搜索B站视频 |
| `get_bilibili_video_comprehensive_info` | 获取视频综合信息（标题、评论、弹幕、内容总结） |
| `send_bilibili_comment` | 向视频发送评论 |
| `send_bilibili_danmaku` | 向视频发送弹幕 |
| `get_bilibili_ranking` | 获取B站视频排行榜（支持分区筛选） |
| `interact_bilibili_video` | 视频互动（点赞、投币、收藏、一键三连） |

## 核心特性

- **字幕优先总结**：优先使用 CC 字幕进行视频内容总结，字幕不可用时降级为 Whisper 语音转录
- **智能总结**：通过硅基流动 DeepSeek 下级智能体对视频内容进行结构化总结
- **反风控**：自动获取 buvid3/buvid4、bili_ticket，使用 WBI 签名，降低 412 风控概率
- **QR 登录**：支持终端二维码扫码登录，自动保存凭据
- **完整互动**：支持评论、弹幕、点赞、投币、收藏、一键三连

## 版本历史

- **v3.7.0** 视频总结优先使用 CC 字幕，字幕不可用时降级 Whisper 语音转录
- **v3.6.1** 修复弹幕发送功能（WBI 签名 + 微秒级 rnd 参数）
- **v3.6.0** 新增视频互动功能（点赞、投币、收藏、一键三连）
- **v3.5.1** 搜索恢复使用 bilibili-api-ts 库，避免 412 风控
- **v3.5.0** 添加 DeepSeek 下级智能体视频转录内容总结
- **v3.4.0** 添加 B 站视频排行榜功能
- **v3.3.0** 添加 bili_ticket 支持
- **v3.2.0** 从 B 站 API 获取官方 buvid3/buvid4
- **v3.1.0** 添加 WBI 签名支持
- **v3.0.0** 参考 bilibili-api Python 库优化

## 依赖

**JS**（在 live-2d 目录安装）：
- `bilibili-api-ts` — B站搜索
- `qrcode-terminal` — 终端二维码
- `md5` — WBI 签名

**Python**（用于 Whisper 语音转录）：
- `yt-dlp` — 视频/音频下载
- `openai-whisper` — 语音转文字
- `torch` — PyTorch
- `ffmpeg-python` — 音频处理

## 参考

- [bilibili-api (Python)](https://github.com/Nemo2011/bilibili-api)
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)

## 作者

爱熬夜的人形兔
