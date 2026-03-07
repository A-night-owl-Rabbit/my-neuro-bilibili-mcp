/**
 * Bilibili MCP 工具集 (v3.7.0 - 字幕优先总结版)
 * 
 * 功能：提供B站视频搜索、排行榜、信息获取、内容转录与智能总结、评论与弹幕发送、点赞投币收藏等功能。
 * 作者：爱熬夜的人形兔
 * 版本：3.7.0
 * 更新：
 *   - v3.7.0: 视频总结优先使用 CC 字幕，字幕不可用时降级 Whisper 语音转录
 *   - v3.6.1: 修复弹幕发送功能（添加 WBI 签名，修正 rnd 参数为微秒级）
 *   - v3.6.0: 新增视频互动功能（点赞、投币、收藏、一键三连）
 *   - v3.5.1: 搜索功能恢复使用 bilibili-api-ts 库，避免 412 风控
 *   - v3.5.0: 添加下级智能体（硅基流动 DeepSeek-V3）对视频转录内容进行智能总结
 *   - v3.4.0: 添加 B 站视频排行榜功能，支持分区筛选
 *   - v3.3.0: 添加 bili_ticket 支持，进一步降低风控概率
 *   - v3.2.0: 从 B 站 API 获取官方 buvid3/buvid4，增强反风控
 *   - v3.1.0: 添加 WBI 签名支持（用于排行榜等接口）
 *   - v3.0.0: 参考 bilibili-api Python 库优化，增强反风控、错误处理和代码质量
 * 参考：
 *   - https://github.com/Nemo2011/bilibili-api
 *   - https://github.com/SocialSisterYi/bilibili-API-collect (WBI 签名, buvid, bili_ticket, 排行榜)
 * 
 * --- 依赖安装 ---
 * JS: (在live-2d目录) npm install bilibili-api-ts qrcode-terminal md5
 * Python: (在my-neuro环境) pip install yt-dlp openai-whisper torch ffmpeg-python
 * --------------------
 */

const axios = require('axios');
const { search } = require('bilibili-api-ts/search');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { exec } = require('child_process');
const md5 = require('md5');
const crypto = require('crypto');  // 用于 bili_ticket HMAC-SHA256

// --- 硅基流动 API 配置（用于视频内容总结 - 下级智能体）---
const SUMMARY_API_CONFIG = {
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-ai/DeepSeek-V3.2'
};

// 视频内容总结提示词（针对游戏攻略/剧情场景优化）
const VIDEO_SUMMARY_PROMPT = `你是一个专业的游戏视频内容分析助手。请根据提供的视频转录文本，生成一份详细的内容总结，确保信息完整、结构清晰，便于其他 AI 理解和使用。

## 总结要求

1. **完整性**: 提取所有关键信息，不要遗漏重要细节
2. **结构化**: 按逻辑顺序组织内容，使用清晰的分段
3. **准确性**: 忠实于原视频内容，不要添加推测或臆断
4. **可操作性**: 如果是攻略内容，确保步骤清晰可执行

## 针对不同内容类型的总结重点

### 游戏攻略类
- 详细的操作步骤和流程
- 关键道具、技能、装备的获取方法
- Boss战策略和注意事项
- 隐藏要素和彩蛋位置

### 剧情解说类
- 故事背景和世界观设定
- 主要角色及其关系
- 剧情发展的关键节点
- 重要伏笔和细节解读

### 游戏评测/介绍类
- 游戏的核心玩法机制
- 优缺点分析
- 适合的玩家群体

## 输出格式

【内容类型】攻略/剧情/评测/其他
【视频主题】一句话概括
【详细内容】
（根据内容类型，分点或分段详细阐述）
【关键要点】
- 要点1
- 要点2
...`;

// --- 常量定义 ---
const BILI_API = {
    // 用户相关
    NAV: 'https://api.bilibili.com/x/web-interface/nav',
    USER_INFO: 'https://api.bilibili.com/x/space/acc/info',
    
    // 视频相关
    VIDEO_INFO: 'https://api.bilibili.com/x/web-interface/view',
    VIDEO_DETAIL: 'https://api.bilibili.com/x/web-interface/view/detail',
    VIDEO_STAT: 'https://api.bilibili.com/x/web-interface/archive/stat',
    
    // 评论相关
    COMMENT_LIST: 'https://api.bilibili.com/x/v2/reply',
    COMMENT_ADD: 'https://api.bilibili.com/x/v2/reply/add',
    COMMENT_LIKE: 'https://api.bilibili.com/x/v2/reply/action',
    
    // 弹幕相关
    DANMAKU_LIST: 'https://api.bilibili.com/x/v1/dm/list.so',
    DANMAKU_POST: 'https://api.bilibili.com/x/v2/dm/post',
    DANMAKU_HISTORY: 'https://api.bilibili.com/x/v2/dm/history',
    
    // 登录相关
    QR_GENERATE: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
    QR_POLL: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
    COOKIE_REFRESH: 'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
    COOKIE_INFO: 'https://passport.bilibili.com/x/passport-login/web/cookie/info',
    
    // 搜索相关
    SEARCH: 'https://api.bilibili.com/x/web-interface/search/type',
    
    // 视频交互相关
    HISTORY_REPORT: 'https://api.bilibili.com/x/v2/history/report',  // 上报观看历史
    VIDEO_HEARTBEAT: 'https://api.bilibili.com/x/click-interface/web/heartbeat',  // 播放心跳
    VIDEO_LIKE: 'https://api.bilibili.com/x/web-interface/archive/like',  // 点赞
    VIDEO_COIN: 'https://api.bilibili.com/x/web-interface/coin/add',  // 投币
    VIDEO_FAVORITE: 'https://api.bilibili.com/x/v3/fav/resource/deal',  // 收藏
    VIDEO_TRIPLE: 'https://api.bilibili.com/x/web-interface/archive/like/triple',  // 一键三连
    FAV_FOLDER_LIST: 'https://api.bilibili.com/x/v3/fav/folder/created/list-all',  // 获取收藏夹列表
    
    // buvid 相关
    BUVID_SPI: 'https://api.bilibili.com/x/frontend/finger/spi',  // 获取 buvid3/buvid4
    
    // bili_ticket 相关
    BILI_TICKET: 'https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket',  // 获取 bili_ticket
    
    // 排行榜相关
    RANKING: 'https://api.bilibili.com/x/web-interface/ranking/v2',  // 获取分区视频排行榜
    
    // 字幕相关
    PLAYER_V2: 'https://api.bilibili.com/x/player/v2'  // 获取播放器信息（含字幕列表）
};

// 更新 User-Agent 以模拟最新浏览器
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 错误码映射（参考 bilibili-api 和 bilibili-API-collect）
const ERROR_CODES = {
    // 通用错误
    '-101': '账号未登录或登录失效',
    '-102': '账号被封停',
    '-111': 'CSRF 校验失败',
    '-400': '请求错误',
    '-403': '权限不足',
    '-404': '无此项',
    '-509': '请求过于频繁',
    '412': '请求被拦截（风控）',
    
    // 评论相关错误
    '12001': '已经存在评论主题',
    '12002': '评论区已关闭',
    '12003': '禁止回复',
    '12006': '没有该评论',
    '12009': '评论主体的type不合法',
    '12015': '需要评论验证码',
    '12016': '评论内容包含敏感信息',
    '12025': '评论字数过多',
    '12035': '该账号被UP主列入评论黑名单',
    '12051': '重复评论，请勿刷屏',
    '12052': '评论区已关闭',
    
    // 弹幕相关错误
    '36700': '弹幕内容包含敏感词',
    '36701': '弹幕发送太频繁',
    '36702': '该视频禁止发送弹幕',
    
    // 账号相关错误
    '61001': '账号被封禁',
    '62011': '稿件审核中',
    
    // 互动相关错误
    '10003': '不存在该稿件',
    '34005': '超过投币上限',
    '65004': '取消点赞失败',
    '65006': '重复点赞',
    '90001': '账号被封禁（互动）',
    '11201': '已经收藏过了',
    '11203': '收藏夹容量已满'
};

// --- WBI 签名相关 (参考 bilibili-API-collect) ---
// WBI 签名映射表
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
];

// WBI Keys 缓存
let wbiKeysCache = {
    img_key: null,
    sub_key: null,
    mixin_key: null,
    lastUpdate: 0
};

/**
 * 对 imgKey 和 subKey 进行字符顺序打乱编码，生成 mixin_key
 * @param {string} imgKey - img_key
 * @param {string} subKey - sub_key
 * @returns {string} - mixin_key
 */
function getMixinKey(imgKey, subKey) {
    const orig = imgKey + subKey;
    return MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32);
}

/**
 * 获取最新的 WBI Keys (img_key 和 sub_key)
 * @returns {Promise<object|null>} - { img_key, sub_key, mixin_key }
 */
async function getWbiKeys() {
    // 检查缓存是否有效（每小时更新一次）
    const now = Date.now();
    if (wbiKeysCache.mixin_key && (now - wbiKeysCache.lastUpdate) < 3600000) {
        return wbiKeysCache;
    }
    
    try {
        console.log("[Bilibili MCP] 获取 WBI Keys...");
        
        const response = await axios.get(BILI_API.NAV, {
            headers: getHeaders(credential),
            timeout: 10000
        });
        
        // 即使未登录也会返回 wbi_img
        if (response.data.data?.wbi_img) {
            const { img_url, sub_url } = response.data.data.wbi_img;
            
            // 从 URL 中提取 key
            // https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png
            const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
            const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
            const mixin_key = getMixinKey(img_key, sub_key);
            
            // 更新缓存
            wbiKeysCache = {
                img_key,
                sub_key,
                mixin_key,
                lastUpdate: now
            };
            
            console.log(`[Bilibili MCP] WBI Keys 获取成功，mixin_key: ${mixin_key.substring(0, 8)}...`);
            return wbiKeysCache;
        }
        
        console.error("[Bilibili MCP] 响应中未找到 wbi_img 字段");
        return null;
    } catch (error) {
        console.error("[Bilibili MCP] 获取 WBI Keys 失败:", error.message);
        return null;
    }
}

/**
 * 为请求参数进行 WBI 签名
 * @param {object} params - 原始请求参数
 * @returns {Promise<object>} - 签名后的参数（包含 w_rid 和 wts）
 */
async function encWbi(params) {
    const wbiKeys = await getWbiKeys();
    if (!wbiKeys || !wbiKeys.mixin_key) {
        console.warn("[Bilibili MCP] WBI Keys 不可用，跳过签名");
        return params;
    }
    
    const mixin_key = wbiKeys.mixin_key;
    const curr_time = Math.round(Date.now() / 1000);
    const chr_filter = /[!'()*]/g;
    
    // 添加 wts 字段
    const signParams = { ...params, wts: curr_time };
    
    // 按 key 排序并构建查询字符串
    const query = Object.keys(signParams)
        .sort()
        .map(key => {
            // 过滤 value 中的 "!'()*" 字符
            const value = String(signParams[key]).replace(chr_filter, '');
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');
    
    // 计算 w_rid
    const w_rid = md5(query + mixin_key);
    
    // 返回签名后的参数
    return {
        ...signParams,
        w_rid
    };
}

// --- bili_ticket 相关 ---
// 参考：https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/bili_ticket.md

// bili_ticket 缓存
let biliTicketCache = {
    ticket: null,
    created_at: 0,
    ttl: 0  // 有效期，默认 259200 秒 (3天)
};

/**
 * 使用 HMAC-SHA256 算法计算签名
 * @param {string} key - 密钥
 * @param {string} message - 消息
 * @returns {string} - 十六进制签名
 */
function hmacSha256(key, message) {
    return crypto.createHmac('sha256', key).update(message).digest('hex');
}

/**
 * 获取 bili_ticket（用于降低风控）
 * 同时可以获取 WBI keys，一举两得
 * 
 * @param {string} csrf - CSRF token (bili_jct)，可为空
 * @returns {Promise<{ticket: string, wbiKeys: object}|null>} - bili_ticket 和 WBI keys
 */
async function getBiliTicket(csrf = '') {
    // 检查缓存是否有效
    const now = Math.floor(Date.now() / 1000);
    if (biliTicketCache.ticket && (now - biliTicketCache.created_at) < biliTicketCache.ttl - 3600) {
        // 提前1小时刷新，避免边界情况
        return { ticket: biliTicketCache.ticket, fromCache: true };
    }
    
    try {
        console.log("[Bilibili MCP] 正在获取 bili_ticket...");
        
        const ts = Math.floor(Date.now() / 1000);
        const hexSign = hmacSha256('XgwSnGZ1p', `ts${ts}`);
        
        const params = new URLSearchParams({
            key_id: 'ec02',
            hexsign: hexSign,
            'context[ts]': ts.toString(),
            csrf: csrf || ''
        });
        
        const response = await axios.post(`${BILI_API.BILI_TICKET}?${params.toString()}`, null, {
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': 'https://www.bilibili.com'
            },
            timeout: 10000
        });
        
        if (response.data.code === 0 && response.data.data) {
            const { ticket, created_at, ttl, nav } = response.data.data;
            
            // 更新 bili_ticket 缓存
            biliTicketCache = {
                ticket,
                created_at,
                ttl
            };
            
            console.log("[Bilibili MCP] ✅ bili_ticket 获取成功，有效期:", Math.floor(ttl / 86400), "天");
            
            // 如果响应中包含 WBI keys，顺带更新 WBI 缓存
            if (nav && nav.img && nav.sub) {
                const img_key = nav.img.slice(nav.img.lastIndexOf('/') + 1, nav.img.lastIndexOf('.'));
                const sub_key = nav.sub.slice(nav.sub.lastIndexOf('/') + 1, nav.sub.lastIndexOf('.'));
                const mixin_key = getMixinKey(img_key, sub_key);
                
                wbiKeysCache = {
                    img_key,
                    sub_key,
                    mixin_key,
                    lastUpdate: Date.now()
                };
                
                console.log("[Bilibili MCP] ✅ 同时更新了 WBI Keys");
            }
            
            return { ticket, fromCache: false };
        } else {
            console.warn("[Bilibili MCP] 获取 bili_ticket 失败:", response.data.message);
            return null;
        }
    } catch (error) {
        console.warn("[Bilibili MCP] 获取 bili_ticket 网络错误:", error.message);
        return null;
    }
}

// --- 工具函数 ---

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 解析 Cookie 字符串
 * @param {string} cookieStr - Cookie 字符串
 * @returns {string|null} - Cookie 值
 */
function parseCookieString(cookieStr) {
    const parts = cookieStr.split(';')[0].split('=');
    return parts.length >= 2 ? parts[1] : null;
}

/**
 * 获取 Cookie 字符串（参考 bilibili-api）
 * @param {object} credential - 凭证对象
 * @returns {string} - Cookie 字符串
 */
function getCookieString(credential) {
    if (!credential) return '';
    const cookies = [
        `SESSDATA=${credential.SESSDATA}`,
        `bili_jct=${credential.bili_jct}`,
        `DedeUserID=${credential.DedeUserID}`
    ];
    // 添加 buvid3/buvid4/b_nut 以增强反风控
    if (credential.buvid3) {
        cookies.push(`buvid3=${credential.buvid3}`);
    }
    if (credential.buvid4) {
        cookies.push(`buvid4=${credential.buvid4}`);
    }
    if (credential.b_nut) {
        cookies.push(`b_nut=${credential.b_nut}`);
    }
    // 添加 bili_ticket（如果缓存中有）
    if (biliTicketCache.ticket) {
        cookies.push(`bili_ticket=${biliTicketCache.ticket}`);
    }
    return cookies.join('; ');
}

/**
 * 获取请求头（参考 bilibili-api，增强反风控）
 * @param {object} credential - 凭证对象
 * @param {string} videoUrl - 视频 URL
 * @returns {object} - 请求头对象
 */
function getHeaders(credential = null, videoUrl = null) {
    const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': videoUrl || 'https://www.bilibili.com',
        'Origin': 'https://www.bilibili.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        // 添加更多反风控标识
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1'
    };
    if (credential) {
        headers['Cookie'] = getCookieString(credential);
    }
    return headers;
}

/**
 * 生成随机延迟（模拟人类行为，参考 bilibili-api）
 * @param {number} min - 最小延迟（毫秒）
 * @param {number} max - 最大延迟（毫秒）
 * @returns {number} - 随机延迟
 */
function getRandomDelay(min = 1000, max = 3000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 解析错误信息（参考 bilibili-api）
 * @param {number|string} code - 错误码
 * @param {string} message - 原始错误信息
 * @returns {string} - 格式化的错误信息
 */
function parseErrorMessage(code, message) {
    const codeStr = String(code);
    if (ERROR_CODES[codeStr]) {
        return `${ERROR_CODES[codeStr]} (code: ${code})`;
    }
    return `${message || '未知错误'} (code: ${code})`;
}

/**
 * 模拟浏览器行为：先访问视频页面（增强反风控）
 * @param {string} bvid - 视频 BV 号
 * @param {object} cred - 凭证对象
 */
async function simulateBrowsing(bvid, cred = null) {
    try {
        console.log("[Bilibili MCP] 模拟浏览器行为：访问视频页面...");
        const videoUrl = `https://www.bilibili.com/video/${bvid}`;
        
        // 第一步：访问首页
        await axios.get('https://www.bilibili.com', {
            headers: getHeaders(cred),
            timeout: 8000
        });
        await sleep(getRandomDelay(300, 600));
        
        // 第二步：访问视频页面
        await axios.get(videoUrl, {
            headers: getHeaders(cred, videoUrl),
            timeout: 10000
        });
        await sleep(getRandomDelay(800, 1500));
        
        console.log("[Bilibili MCP] 浏览行为模拟完成");
        return true;
    } catch (error) {
        console.warn("[Bilibili MCP] 浏览行为模拟失败（不影响后续操作）:", error.message);
        return false;
    }
}

/**
 * 从 B 站 API 获取 buvid3/buvid4（用于反风控）
 * 参考：https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/buvid3_4.md
 * 
 * @returns {Promise<{buvid3: string, buvid4: string, b_nut: number}>} - buvid 信息
 */
async function fetchBuvid() {
    try {
        console.log("[Bilibili MCP] 正在从 API 获取 buvid...");
        
        const response = await axios.get(BILI_API.BUVID_SPI, {
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': 'https://www.bilibili.com'
            },
            timeout: 10000
        });
        
        if (response.data.code === 0 && response.data.data) {
            const buvid3 = response.data.data.b_3;
            const buvid4 = response.data.data.b_4;
            const b_nut = Math.floor(Date.now() / 1000);  // 当前时间戳
            
            console.log("[Bilibili MCP] ✅ 成功获取 buvid3/buvid4");
            return { buvid3, buvid4, b_nut };
        } else {
            console.warn("[Bilibili MCP] 获取 buvid 失败，使用本地生成");
            return generateBuvidLocal();
        }
    } catch (error) {
        console.warn("[Bilibili MCP] 获取 buvid 网络错误，使用本地生成:", error.message);
        return generateBuvidLocal();
    }
}

/**
 * 本地生成 buvid（备用方案，格式模拟官方）
 * @returns {{buvid3: string, buvid4: string, b_nut: number}} - buvid 信息
 */
function generateBuvidLocal() {
    // 生成 UUID 格式的 buvid3（模拟官方格式）
    const uuid = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => {
        return Math.floor(Math.random() * 16).toString(16).toUpperCase();
    });
    const randomNum = Math.floor(Math.random() * 100000);
    const buvid3 = `${uuid}${randomNum}infoc`;
    
    // buvid4 格式更复杂，简单模拟
    const uuid4 = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => {
        return Math.floor(Math.random() * 16).toString(16).toUpperCase();
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const buvid4 = `${uuid4}${randomNum}-0${String(timestamp).slice(-6)}-${Math.random().toString(36).slice(2, 10)}`;
    
    const b_nut = timestamp;
    
    console.log("[Bilibili MCP] 已本地生成 buvid3/buvid4");
    return { buvid3, buvid4, b_nut };
}

// --- 加载B站身份凭证 ---
let credential = null;

/**
 * 加载和验证凭证（参考 bilibili-api）
 */
async function loadCredential() {
    try {
        const configPath = path.join(__dirname, 'bili_config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.SESSDATA && config.bili_jct && config.DedeUserID) {
                credential = {
                    SESSDATA: config.SESSDATA,
                    bili_jct: config.bili_jct,
                    DedeUserID: config.DedeUserID,
                    refresh_token: config.refresh_token,
                    buvid3: config.buvid3,
                    buvid4: config.buvid4,
                    b_nut: config.b_nut
                };
                
                // 如果没有 buvid3/buvid4，从 API 获取
                if (!config.buvid3 || !config.buvid4) {
                    console.log("[Bilibili MCP] 检测到缺少 buvid，正在获取...");
                    const buvidInfo = await fetchBuvid();
                    credential.buvid3 = buvidInfo.buvid3;
                    credential.buvid4 = buvidInfo.buvid4;
                    credential.b_nut = buvidInfo.b_nut;
                    
                    // 保存到配置文件
                    config.buvid3 = buvidInfo.buvid3;
                    config.buvid4 = buvidInfo.buvid4;
                    config.b_nut = buvidInfo.b_nut;
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
                    console.log("[Bilibili MCP] 已保存 buvid3/buvid4/b_nut");
                }
                
                console.log("[Bilibili MCP] B站身份凭证加载成功。");
                
                // 验证凭证
                const valid = await isCredentialValid();
                if (valid) {
                    console.log("[Bilibili MCP] 凭证有效，发送功能已启用。");
                    
                    // 获取 bili_ticket（异步，不阻塞启动）
                    getBiliTicket(credential.bili_jct).catch(err => {
                        console.warn("[Bilibili MCP] bili_ticket 获取失败，继续运行:", err.message);
                    });
                    
                    return true;
                } else {
                    console.warn("[Bilibili MCP] 凭证已过期，检查是否可恢复...");
                    const stillValid = await refreshCookie();
                    if (stillValid) {
                        console.log("[Bilibili MCP] 凭证仍可使用，发送功能已启用。");
                        console.log("[Bilibili MCP] 💡 建议尽快使用 login_bilibili_by_qrcode 重新登录以获取新凭证。");
                        return true;
                    } else {
                        console.error("[Bilibili MCP] ❌ 凭证已完全失效，请使用二维码重新登录。");
                        credential = null;
                        return false;
                    }
                }
            } else {
                console.warn("[Bilibili MCP] bili_config.json 文件不完整，发送功能未启用。");
                return false;
            }
        } else {
            console.warn("[Bilibili MCP] 未找到 bili_config.json 文件，发送功能未启用。");
            return false;
        }
    } catch (e) {
        console.error("[Bilibili MCP] 加载 bili_config.json 失败:", e);
        return false;
    }
}

// 启动时加载凭证
loadCredential().catch(err => {
    console.error("[Bilibili MCP] 凭证加载异常:", err);
});


// --- 1. 工具定义 (Tool Definitions) ---
const LOGIN_TOOL = {
    name: "login_bilibili_by_qrcode",
    description: "通过扫描二维码登录B站，以便执行需要登录的操作（如评论、发送弹幕）。",
    parameters: {
        type: "object",
        properties: {},
        required: []
    }
};
const SEARCH_TOOL = {
    name: "search_bilibili_video",
    description: "根据关键词搜索B站视频。",
    parameters: {
        type: "object",
        properties: {
            keyword: {
                type: "string",
                description: "搜索关键词"
            },
            limit: {
                type: "number",
                description: "返回结果数量限制，默认3个"
            }
        },
        required: ["keyword"]
    }
};
const COMPREHENSIVE_INFO_TOOL = {
    name: "get_bilibili_video_comprehensive_info",
    description: "获取B站视频的综合信息，包括标题、简介、评论、弹幕和视频内容总结（优先使用CC字幕，字幕不可用时降级为语音转录）。",
    parameters: {
        type: "object",
        properties: {
            bvid: {
                type: "string",
                description: "必须是从 search_bilibili_video 工具搜索结果中获取的有效BV号"
            },
            model_size: {
                type: "string",
                description: "Whisper模型大小，可选值：tiny、base、small、medium、large，默认为medium"
            }
        },
        required: ["bvid"]
    }
};
const COMMENT_TOOL = {
    name: "send_bilibili_comment",
    description: "向指定的B站视频发送一条评论。",
    parameters: {
        type: "object",
        properties: {
            bvid: {
                type: "string",
                description: "视频的BV号"
            },
            comment_text: {
                type: "string",
                description: "评论内容"
            }
        },
        required: ["bvid", "comment_text"]
    }
};
const DANMAKU_TOOL = {
    name: "send_bilibili_danmaku",
    description: "向指定的B站视频发送一条弹幕。",
    parameters: {
        type: "object",
        properties: {
            bvid: {
                type: "string",
                description: "视频的BV号"
            },
            danmaku_text: {
                type: "string",
                description: "弹幕内容"
            },
            time: {
                type: "number",
                description: "弹幕出现的时间点（秒）"
            }
        },
        required: ["bvid", "danmaku_text", "time"]
    }
};

// B站主分区 ID 映射
const VIDEO_ZONES = {
    0: '全站',
    1: '动画',
    3: '音乐',
    4: '游戏',
    5: '娱乐',
    11: '电视剧',
    13: '番剧',
    17: '单机游戏',
    23: '电影',
    36: '科技',
    119: '鬼畜',
    129: '舞蹈',
    155: '时尚',
    160: '生活',
    165: '广告',
    167: '国创',
    177: '纪录片',
    181: '影视',
    188: '科技',
    202: '资讯',
    211: '美食',
    217: '动物圈',
    223: '汽车',
    234: '运动',
    236: '知识'
};

const RANKING_TOOL = {
    name: "get_bilibili_ranking",
    description: "获取B站视频排行榜，可按分区筛选，返回热门视频列表。",
    parameters: {
        type: "object",
        properties: {
            rid: {
                type: "number",
                description: "分区ID：0=全站(默认), 1=动画, 3=音乐, 4=游戏, 5=娱乐, 36=科技, 119=鬼畜, 129=舞蹈, 160=生活, 211=美食, 217=动物圈, 234=运动, 236=知识"
            },
            type: {
                type: "string",
                description: "排行榜类型：all=全部(默认), rookie=新人, origin=原创",
                enum: ["all", "rookie", "origin"]
            },
            limit: {
                type: "number",
                description: "返回数量（默认10，最大100）"
            }
        },
        required: []
    }
};

const INTERACT_TOOL = {
    name: "interact_bilibili_video",
    description: "对B站视频进行互动操作，支持点赞、投币、收藏，或一键三连。",
    parameters: {
        type: "object",
        properties: {
            bvid: {
                type: "string",
                description: "视频的BV号"
            },
            action: {
                type: "string",
                description: "互动类型：like=点赞, coin=投币, favorite=收藏, triple=一键三连（点赞+投币+收藏）",
                enum: ["like", "coin", "favorite", "triple"]
            },
            coin_num: {
                type: "number",
                description: "投币数量（1或2），仅在 action=coin 时有效，默认1"
            },
            like_with_coin: {
                type: "boolean",
                description: "投币时是否同时点赞，仅在 action=coin 时有效，默认true"
            }
        },
        required: ["bvid", "action"]
    }
};


// --- 2. 工具执行函数 ---

/**
 * 搜索视频（使用 bilibili-api-ts 库，避免 412 风控）
 * @param {object} parameters - 搜索参数
 * @returns {Promise<string>} - 搜索结果 JSON 字符串
 */
async function searchVideo(parameters) {
    const { keyword, limit = 3 } = parameters;
    
    // 参数验证
    if (!keyword || keyword.trim().length === 0) {
        return '搜索失败：关键词不能为空';
    }
    
    console.log(`[Bilibili MCP] 开始搜索视频，关键词: "${keyword}", 限制: ${limit}`);

    try {
        // 使用 bilibili-api-ts 库进行搜索（内部已处理反风控）
        const searchOptions = {
            keyword: keyword.trim(),
            type: 'video',
            page: 1,
            credential
        };

        const response = await search(searchOptions);

        const videoResultObject = response.result.find(item => item.result_type === 'video');

        if (!videoResultObject || !videoResultObject.data || videoResultObject.data.length === 0) {
            console.log(`[Bilibili MCP] 未找到关于 "${keyword}" 的视频`);
            return `在B站没有找到关于 "${keyword}" 的视频。请尝试：\n1. 使用更通用的关键词\n2. 检查关键词拼写\n3. 使用同义词搜索`;
        }

        const videoList = videoResultObject.data;

        // 增强的结果格式化
        const results = videoList.slice(0, limit).map((v, index) => ({
            index: index + 1,
            title: (v.title || '').replace(/<em class="keyword">|<\/em>/g, ''),
            author: v.author || v.uploader || '',
            bvid: v.bvid,
            aid: v.aid,
            url: `https://www.bilibili.com/video/${v.bvid}`,
            // 添加更多信息
            play: v.play || 0,
            video_review: v.video_review || v.review || 0,
            duration: v.duration || '未知',
            pubdate: v.pubdate || 0,
            tag: v.tag || '',
            description: (v.description || '').substring(0, 100) // 限制描述长度
        }));

        console.log(`[Bilibili MCP] 搜索完成，返回 ${results.length} 个结果。`);
        
        // 格式化输出
        const formattedOutput = {
            keyword: keyword,
            total_results: results.length,
            videos: results
        };
        
        return JSON.stringify(formattedOutput, null, 2);

    } catch (error) {
        console.error("[Bilibili MCP] 搜索视频失败:", error);
        
        // 增强的错误处理
        if (error.response) {
            const status = error.response.status;
            const code = error.response.data?.code;
            
            if (status === 412 || code === 412) {
                return `搜索失败：触发了 B 站风控策略 (412)。建议：\n1. 等待几分钟后重试\n2. 降低搜索频率\n3. 使用账号登录后再试\n4. 检查网络环境`;
            }
            
            if (code) {
                return `搜索失败：${parseErrorMessage(code, error.response.data?.message)}`;
            }
            
            return `搜索失败：HTTP ${status} - ${error.message}`;
        }
        
        if (error.code === 'ECONNABORTED') {
            return '搜索失败：请求超时，请检查网络连接';
        }
        
        if (error.code === 'ENOTFOUND') {
            return '搜索失败：无法连接到 B 站服务器，请检查网络';
        }
        
        return `搜索失败: ${error.message}`;
    }
}

/**
 * 获取 B 站视频排行榜
 * 参考：https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/video_ranking/ranking.md
 * 
 * @param {object} parameters - 参数对象
 * @returns {Promise<string>} - 排行榜结果 JSON 字符串
 */
async function getRanking(parameters) {
    const { rid = 0, type = 'all', limit = 10 } = parameters;
    
    // 参数验证
    const validTypes = ['all', 'rookie', 'origin'];
    if (!validTypes.includes(type)) {
        return `获取排行榜失败：无效的类型 "${type}"，有效值为：all, rookie, origin`;
    }
    
    const zoneName = VIDEO_ZONES[rid] || `分区${rid}`;
    const typeName = { all: '全部', rookie: '新人', origin: '原创' }[type];
    
    console.log(`[Bilibili MCP] 获取排行榜：${zoneName} - ${typeName}，数量: ${Math.min(limit, 100)}`);
    
    try {
        // 构建请求参数
        const rankingParams = {
            rid: rid,
            type: type,
            web_location: '333.934'
        };
        
        // 使用 WBI 签名（可选，但有助于减少风控）
        const signedParams = await encWbi(rankingParams);
        
        const response = await axios.get(BILI_API.RANKING, {
            params: signedParams,
            headers: getHeaders(credential),
            timeout: 15000
        });
        
        if (response.data.code !== 0) {
            return `获取排行榜失败：${parseErrorMessage(response.data.code, response.data.message)}`;
        }
        
        const videoList = response.data.data?.list || [];
        
        if (videoList.length === 0) {
            return `${zoneName}分区的${typeName}排行榜暂无数据`;
        }
        
        // 格式化结果
        const actualLimit = Math.min(limit, 100, videoList.length);
        const results = videoList.slice(0, actualLimit).map((v, index) => ({
            rank: index + 1,
            title: v.title || '',
            author: v.owner?.name || '',
            mid: v.owner?.mid || 0,
            bvid: v.bvid,
            aid: v.aid,
            url: `https://www.bilibili.com/video/${v.bvid}`,
            pic: v.pic || '',
            // 统计数据
            view: v.stat?.view || 0,
            danmaku: v.stat?.danmaku || 0,
            reply: v.stat?.reply || 0,
            favorite: v.stat?.favorite || 0,
            coin: v.stat?.coin || 0,
            share: v.stat?.share || 0,
            like: v.stat?.like || 0,
            // 其他信息
            duration: v.duration || 0,
            pubdate: v.pubdate || 0,
            desc: (v.desc || '').substring(0, 100),
            tname: v.tname || '',  // 子分区名称
            his_rank: v.stat?.his_rank || 0  // 历史最高排名
        }));
        
        console.log(`[Bilibili MCP] 排行榜获取成功，返回 ${results.length} 个视频`);
        
        // 格式化输出
        const formattedOutput = {
            zone: zoneName,
            zone_id: rid,
            type: typeName,
            note: response.data.data?.note || '根据稿件内容质量、近期的数据综合展示，动态更新',
            total_results: results.length,
            videos: results
        };
        
        return JSON.stringify(formattedOutput, null, 2);
        
    } catch (error) {
        console.error("[Bilibili MCP] 获取排行榜失败:", error);
        
        if (error.response) {
            const status = error.response.status;
            const code = error.response.data?.code;
            
            if (status === 412 || code === 412) {
                return `获取排行榜失败：触发了 B 站风控策略 (412)。建议等待几分钟后重试。`;
            }
            
            if (code) {
                return `获取排行榜失败：${parseErrorMessage(code, error.response.data?.message)}`;
            }
            
            return `获取排行榜失败：HTTP ${status} - ${error.message}`;
        }
        
        if (error.code === 'ECONNABORTED') {
            return '获取排行榜失败：请求超时，请检查网络连接';
        }
        
        return `获取排行榜失败: ${error.message}`;
    }
}

/**
 * 获取视频详情（参考 bilibili-api 优化）
 * @param {object} parameters - 参数对象
 * @returns {Promise<string>} - 视频详情 JSON 字符串
 */
async function getVideoDetails(parameters) {
    const { bvid } = parameters;
    
    // 参数验证
    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return `获取视频详情失败：无效的BV号格式 "${bvid}"`;
    }
    
    try {
        console.log(`[Bilibili MCP] 获取视频 ${bvid} 的详细信息...`);
        
        // 1. 获取视频基本信息（带重试）
        let videoInfo;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const videoResponse = await axios.get(BILI_API.VIDEO_INFO, {
                    params: { bvid },
                    headers: getHeaders(credential),
                    timeout: 10000
                });
                
                if (videoResponse.data.code !== 0) {
                    const errMsg = parseErrorMessage(videoResponse.data.code, videoResponse.data.message);
                    return `获取视频详情失败：${errMsg}`;
                }
                
                videoInfo = videoResponse.data.data;
                console.log(`[Bilibili MCP] 视频标题: ${videoInfo.title}`);
                break;
            } catch (err) {
                if (attempt === 3) throw err;
                console.warn(`[Bilibili MCP] 获取视频信息失败 (尝试 ${attempt}/3)，重试中...`);
                await sleep(1000);
            }
        }
        
        // 2. 获取热门评论（异步并行）
        let commentsSummary = "暂无热门评论。";
        const commentsPromise = (async () => {
            try {
                await sleep(getRandomDelay(100, 300)); // 随机延迟避免同时请求
                const commentsResponse = await axios.get(BILI_API.COMMENT_LIST, {
                    params: {
                        type: 1,
                        oid: videoInfo.aid,
                        sort: 2,  // 2=按热度排序
                        ps: 10    // 每页数量
                    },
                    headers: getHeaders(credential),
                    timeout: 10000
                });
                
                if (commentsResponse.data.code === 0 && commentsResponse.data.data?.replies) {
                    const topComments = commentsResponse.data.data.replies.slice(0, 5);
                    if (topComments.length > 0) {
                        return topComments
                            .map((c, idx) => {
                                const content = c.content?.message || '';
                                const likes = c.like || 0;
                                const username = c.member?.uname || '匿名';
                                return `${idx + 1}. ${username}: ${content} [👍${likes}]`;
                            })
                            .join('\n');
                    }
                }
            } catch (commErr) {
                console.error("[Bilibili MCP] 获取评论失败:", commErr.message);
                return "获取评论失败。";
            }
            return "暂无热门评论。";
        })();
        
        // 3. 获取弹幕样本（异步并行）
        let danmakuSample = "暂无弹幕。";
        const danmakuPromise = (async () => {
            try {
                await sleep(getRandomDelay(100, 300));
                const danmakuResponse = await axios.get(BILI_API.DANMAKU_LIST, {
                    params: { oid: videoInfo.cid },
                    headers: getHeaders(credential),
                    timeout: 10000,
                    responseType: 'text'
                });
                
                const danmakuText = danmakuResponse.data;
                // 解析XML格式的弹幕: <d p="时间,模式,大小,颜色...">弹幕内容</d>
                const danmakuMatches = danmakuText.match(/<d[^>]*>([^<]+)<\/d>/g) || [];
                
                if (danmakuMatches.length > 0) {
                    const danmakuList = danmakuMatches
                        .slice(0, 30)  // 取前30条
                        .map(d => {
                            const match = d.match(/<d[^>]*>([^<]+)<\/d>/);
                            return match ? match[1].trim() : '';
                        })
                        .filter(d => d.length > 0);
                        
                    return danmakuList.slice(0, 20).join(' | ');
                }
            } catch (dmErr) {
                console.error("[Bilibili MCP] 获取弹幕失败:", dmErr.message);
                return "获取弹幕失败。";
            }
            return "暂无弹幕。";
        })();
        
        // 等待评论和弹幕结果
        [commentsSummary, danmakuSample] = await Promise.all([commentsPromise, danmakuPromise]);
        
        // 4. 组装结果（更完整的信息）
        const result = {
            bvid: videoInfo.bvid,
            aid: videoInfo.aid,
            cid: videoInfo.cid,
            title: videoInfo.title,
            description: videoInfo.desc || "无简介",
            author: {
                name: videoInfo.owner?.name || "未知UP主",
                mid: videoInfo.owner?.mid || 0,
                face: videoInfo.owner?.face || ""
            },
            duration: videoInfo.duration,
            duration_formatted: formatDuration(videoInfo.duration),
            pubdate: videoInfo.pubdate,
            pubdate_formatted: new Date(videoInfo.pubdate * 1000).toLocaleString('zh-CN'),
            pic: videoInfo.pic,
            stat: {
                view: videoInfo.stat?.view || 0,
                danmaku: videoInfo.stat?.danmaku || 0,
                reply: videoInfo.stat?.reply || 0,
                favorite: videoInfo.stat?.favorite || 0,
                coin: videoInfo.stat?.coin || 0,
                share: videoInfo.stat?.share || 0,
                like: videoInfo.stat?.like || 0
            },
            hot_comments_summary: commentsSummary,
            danmaku_sample: danmakuSample,
            url: `https://www.bilibili.com/video/${bvid}`
        };
        
        console.log("[Bilibili MCP] 视频详情获取完成");
        return `视频《${result.title}》的详细信息如下：\n${JSON.stringify(result, null, 2)}`;
        
    } catch (error) {
        console.error("[Bilibili MCP] 获取视频详情失败:", error);
        
        // 增强错误处理
        if (error.response?.data?.code) {
            return `获取视频详情失败：${parseErrorMessage(error.response.data.code, error.response.data.message)}`;
        }
        
        return `获取视频详情失败 (BV号: ${bvid}): ${error.message}`;
    }
}

/**
 * 格式化视频时长
 * @param {number} seconds - 秒数
 * @returns {string} - 格式化的时长字符串
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * 从 B 站 API 获取视频 CC 字幕文本
 * 通过 player/v2 接口获取字幕列表，优先选择中文字幕，下载并拼接为纯文本
 * 
 * 注意：请求 player/v2 时仅使用 SESSDATA cookie。
 * 携带 buvid3/buvid4 等完整 cookie 会导致 API 返回错误的字幕 URL 或空 URL。
 * 
 * @param {string} bvid - 视频 BV 号
 * @param {number} cid - 视频 cid
 * @returns {Promise<{success: boolean, text?: string, lang?: string, error?: string}>}
 */
async function fetchSubtitles(bvid, cid) {
    try {
        console.log(`[Bilibili MCP] 尝试获取视频 ${bvid} 的 CC 字幕...`);
        
        // 仅使用 SESSDATA，避免完整 cookie 导致返回错误字幕
        const subtitleHeaders = {
            'User-Agent': USER_AGENT,
            'Referer': `https://www.bilibili.com/video/${bvid}`,
            'Accept': 'application/json, text/plain, */*'
        };
        if (credential && credential.SESSDATA) {
            subtitleHeaders['Cookie'] = `SESSDATA=${credential.SESSDATA}`;
        }
        
        const response = await axios.get(BILI_API.PLAYER_V2, {
            params: { bvid, cid },
            headers: subtitleHeaders,
            timeout: 10000
        });
        
        if (response.data.code !== 0) {
            console.warn(`[Bilibili MCP] 获取播放器信息失败: ${parseErrorMessage(response.data.code, response.data.message)}`);
            return { success: false, error: `播放器接口返回错误: ${response.data.message}` };
        }
        
        const subtitles = response.data.data?.subtitle?.subtitles;
        if (!subtitles || subtitles.length === 0) {
            console.log("[Bilibili MCP] 该视频没有 CC 字幕");
            return { success: false, error: '该视频没有 CC 字幕' };
        }
        
        // 过滤出有有效 URL 的字幕轨道
        const validSubtitles = subtitles.filter(s => s.subtitle_url && s.subtitle_url.length > 0);
        if (validSubtitles.length === 0) {
            console.log("[Bilibili MCP] 所有字幕轨道的 URL 均为空");
            return { success: false, error: '字幕 URL 不可用' };
        }
        
        console.log(`[Bilibili MCP] 发现 ${validSubtitles.length} 条可用字幕轨道:`, validSubtitles.map(s => s.lan_doc).join(', '));
        
        // 优先选择中文字幕（zh-CN > zh-Hans > zh > ai-zh）
        const langPriority = ['zh-CN', 'zh-Hans', 'zh', 'ai-zh', 'zh-Hant'];
        let selectedSubtitle = null;
        
        for (const lang of langPriority) {
            selectedSubtitle = validSubtitles.find(s => s.lan === lang);
            if (selectedSubtitle) break;
        }
        
        if (!selectedSubtitle) {
            selectedSubtitle = validSubtitles[0];
        }
        
        console.log(`[Bilibili MCP] 选择字幕: ${selectedSubtitle.lan_doc} (${selectedSubtitle.lan})`);
        
        // 下载字幕 JSON
        let subtitleUrl = selectedSubtitle.subtitle_url;
        if (subtitleUrl.startsWith('//')) {
            subtitleUrl = 'https:' + subtitleUrl;
        }
        
        const subtitleResponse = await axios.get(subtitleUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': `https://www.bilibili.com/video/${bvid}`
            },
            timeout: 15000
        });
        
        const subtitleData = subtitleResponse.data;
        if (!subtitleData.body || subtitleData.body.length === 0) {
            console.warn("[Bilibili MCP] 字幕文件内容为空");
            return { success: false, error: '字幕文件内容为空' };
        }
        
        // 过滤纯音乐标记（♪ ... ♪），保留实际语音内容
        const speechEntries = subtitleData.body.filter(item => {
            const content = (item.content || '').trim();
            if (!content) return false;
            // 跳过纯音乐符号行
            if (/^[♪♫🎵🎶\s]+$/.test(content)) return false;
            return true;
        });
        
        // 分离音乐歌词和语音内容
        const musicLines = speechEntries.filter(item => /[♪♫]/.test(item.content));
        const nonMusicLines = speechEntries.filter(item => !/[♪♫]/.test(item.content));
        
        console.log(`[Bilibili MCP] 字幕统计: 总计 ${subtitleData.body.length} 条, 音乐歌词 ${musicLines.length} 条, 语音内容 ${nonMusicLines.length} 条`);
        
        // 如果绝大部分是音乐歌词（语音内容不足 20% 或少于 3 条），认为字幕不可用
        const totalValid = speechEntries.length;
        if (totalValid === 0) {
            return { success: false, error: '字幕内容为空' };
        }
        
        const speechRatio = nonMusicLines.length / totalValid;
        if (nonMusicLines.length < 3 && speechRatio < 0.2) {
            console.warn(`[Bilibili MCP] 字幕几乎全是背景音乐歌词（语音占比 ${(speechRatio * 100).toFixed(0)}%），判定为不可用`);
            return { success: false, error: `字幕主要为背景音乐歌词（语音内容仅 ${nonMusicLines.length} 条），不适合用于总结` };
        }
        
        // 拼接字幕文本（优先使用非音乐内容，如果大部分是语音则保留全部）
        let textEntries;
        if (speechRatio >= 0.5) {
            // 语音为主，去掉纯音乐行
            textEntries = nonMusicLines;
        } else {
            // 混合内容，保留全部（包括歌词）但标注
            textEntries = speechEntries;
        }
        
        const subtitleText = textEntries
            .map(item => item.content.trim())
            .filter(content => content.length > 0)
            .join('\n');
        
        console.log(`[Bilibili MCP] ✅ 字幕获取成功，有效内容 ${textEntries.length} 条，文本长度: ${subtitleText.length}`);
        
        return {
            success: true,
            text: subtitleText,
            lang: selectedSubtitle.lan_doc
        };
        
    } catch (error) {
        console.error("[Bilibili MCP] 获取字幕失败:", error.message);
        return { success: false, error: error.message };
    }
}

async function getComprehensiveInfo(parameters) {
    const { bvid, model_size = "medium" } = parameters;

    try {
        // 1. 获取视频详情
        const detailsResult = await getVideoDetails({ bvid });
        if (detailsResult.startsWith("获取视频详情失败")) {
            return `获取综合信息失败，因为无法获取视频详情: ${detailsResult}`;
        }

        // 从详情结果中提取JSON部分并解析
        const jsonStartIndex = detailsResult.indexOf('\n{');
        const detailsJsonString = jsonStartIndex !== -1 
            ? detailsResult.substring(jsonStartIndex + 1) 
            : detailsResult.substring(detailsResult.indexOf('{'));
        const detailsObject = JSON.parse(detailsJsonString);

        // 2. 优先尝试获取 CC 字幕
        let contentText = '';
        let contentSource = '';
        
        console.log("[Bilibili MCP] [策略] 优先尝试 CC 字幕获取...");
        const subtitleResult = await fetchSubtitles(bvid, detailsObject.cid);
        
        if (subtitleResult.success && subtitleResult.text && subtitleResult.text.trim().length > 0) {
            contentText = subtitleResult.text.trim();
            contentSource = `CC字幕 (${subtitleResult.lang})`;
            console.log(`[Bilibili MCP] ✅ CC 字幕获取成功，来源: ${contentSource}，长度: ${contentText.length}`);
        } else {
            // 3. 字幕获取失败，降级使用 Whisper 语音转录
            console.log(`[Bilibili MCP] [策略] CC 字幕不可用（${subtitleResult.error}），降级使用 Whisper 语音转录...`);
            
            const transcriptResult = await transcribeVideo({ bvid, model_size });
            if (transcriptResult.includes("失败")) {
                return `获取综合信息失败：CC 字幕不可用（${subtitleResult.error}），语音转录也失败: ${transcriptResult}`;
            }
            
            contentText = (transcriptResult.split('语音内容转录如下：\n')[1] || '').trim();
            contentSource = `Whisper语音转录 (${model_size})`;
            console.log(`[Bilibili MCP] ✅ 语音转录完成，来源: ${contentSource}，长度: ${contentText.length}`);
        }

        // 4. 检查内容是否为空
        let contentOutput;
        if (!contentText) {
            console.warn("[Bilibili MCP] 内容为空，跳过AI总结");
            contentOutput = "内容为空，无法生成总结。该视频可能是纯音乐或没有语音/字幕内容。";
        } else {
            // 5. 调用下级智能体进行内容总结
            console.log("[Bilibili MCP] 正在调用下级智能体进行内容总结...");
            const summaryResult = await callSummaryAPI(contentText);
            
            if (summaryResult.success) {
                contentOutput = summaryResult.content;
            } else {
                console.warn("[Bilibili MCP] 总结失败，降级返回原始内容");
                contentOutput = `【注意：AI总结失败，以下为原始内容】\n\n${contentText}`;
            }
        }

        // 6. 格式化输出
        let formattedOutput = `视频标题：${detailsObject.title}\n`;
        formattedOutput += `简介：${detailsObject.description}\n`;
        formattedOutput += `热门评论：\n${detailsObject.hot_comments_summary}\n`;
        formattedOutput += `弹幕示例：${detailsObject.danmaku_sample}\n\n`;
        formattedOutput += `【视频内容总结】（内容来源: ${contentSource}）\n${contentOutput}`;

        return formattedOutput;

    } catch (error) {
        console.error("[Bilibili MCP] 获取综合信息时发生严重错误:", error);
        return `处理视频(BV: ${bvid})的综合信息时发生未知错误: ${error.message}`;
    }
}

/**
 * 调用硅基流动 API 进行视频内容总结（下级智能体）
 * @param {string} transcriptText - 转录文本
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<{success: boolean, content?: string, error?: string}>}
 */
async function callSummaryAPI(transcriptText, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Bilibili MCP] 调用下级智能体进行总结，第 ${attempt}/${maxRetries} 次尝试...`);
            
            const response = await axios.post(SUMMARY_API_CONFIG.url, {
                model: SUMMARY_API_CONFIG.model,
                messages: [
                    { role: "system", content: VIDEO_SUMMARY_PROMPT },
                    { role: "user", content: `请详细总结以下视频转录内容：\n\n${transcriptText}` }
                ],
                max_tokens: 8000,
                temperature: 0.5
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUMMARY_API_CONFIG.apiKey}`
                },
                timeout: 180000  // 3分钟超时（适应长文本处理）
            });
            
            if (response.data?.choices?.[0]?.message?.content) {
                console.log('[Bilibili MCP] ✅ 下级智能体总结成功');
                return { success: true, content: response.data.choices[0].message.content };
            }
            
            throw new Error('API 响应格式异常');
            
        } catch (error) {
            console.error(`[Bilibili MCP] 第 ${attempt} 次尝试失败:`, error.message);
            
            if (attempt < maxRetries) {
                const waitTime = attempt * 5000;  // 5秒、10秒、15秒递增等待
                console.log(`[Bilibili MCP] 等待 ${waitTime/1000} 秒后重试...`);
                await sleep(waitTime);
            }
        }
    }
    
    console.error('[Bilibili MCP] ❌ 下级智能体总结失败，已达最大重试次数');
    return { success: false, error: '总结 API 调用失败，已达最大重试次数' };
}

async function transcribeVideo(parameters) {
    const { bvid, model_size = "medium", max_duration } = parameters;

    // BV号格式验证
    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return `转录失败：无效的BV号格式 "${bvid}"。`;
    }

    // 验证BV号是否真实存在（通过API检查）
    try {
        const checkResponse = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        if (checkResponse.data.code !== 0) {
            return `转录失败：BV号 "${bvid}" 对应的视频不存在或无法访问。`;
        }
    } catch (checkError) {
        return `转录失败：无法验证BV号 "${bvid}" 的有效性。`;
    }

    const pythonExecutable = 'K:\\ai\\envs\\my-neuro\\python.exe';
    const scriptPath = path.join(__dirname, 'video_transcriber.py');

    if (!fs.existsSync(pythonExecutable)) {
        return `转录失败：未在指定路径找到Conda环境的Python解释器: ${pythonExecutable}。`;
    }

    const pythonArgs = [scriptPath, bvid, model_size];
    if (max_duration) {
        pythonArgs.push(max_duration.toString());
    }

    const debugInfo = `[转录信息] 使用模型: ${model_size}, 最大时长: ${max_duration || '不限制'}`;
    console.log(debugInfo);

    return new Promise((resolve) => {
        execFile(pythonExecutable, pythonArgs, { timeout: 600000, encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                console.error(`执行Python脚本出错: ${error}`);
                resolve(`转录视频(BV: ${bvid})失败: ${stderr || error.message}`);
                return;
            }
            if (stderr) {
                console.log(`Python stderr (非致命): ${stderr.trim()}`);
            }
            try {
                const result = JSON.parse(stdout.trim());
                if (result.error) {
                    resolve(`${debugInfo}\n转录失败: ${result.error}`);
                } else {
                    resolve(`${debugInfo}\n视频(BV: ${bvid})的语音内容转录如下：\n${result.transcript}`);
                }
            } catch (e) {
                console.error(`解析Python脚本输出失败: ${e}`);
                resolve(`转录结果解析失败。`);
            }
        });
    });
}

async function isCredentialValid() {
    if (!credential) {
        console.log("[Bilibili MCP] 凭证不存在");
        return false;
    }
    
    try {
        const response = await axios.get(BILI_API.NAV, {
            headers: getHeaders(credential),
            timeout: 10000
        });
        
        // code: 0 表示登录成功
        if (response.data.code === 0) {
            const userData = response.data.data;
            console.log(`[Bilibili MCP] 凭证有效，用户: ${userData.uname || '未知'}`);
            return true;
        }
        
        // code: -101 表示未登录
        if (response.data.code === -101) {
            console.log("[Bilibili MCP] 凭证已过期 (code: -101)");
            // 尝试自动刷新
            // 凭证已过期，检查是否仍可使用
            console.log("[Bilibili MCP] 凭证可能已过期，检查状态...");
            const stillValid = await refreshCookie();
            if (!stillValid) {
                console.log("[Bilibili MCP] 凭证已失效，需要重新登录");
            }
            return stillValid;
        }
        
        console.log(`[Bilibili MCP] 凭证验证失败，返回码: ${response.data.code}, 消息: ${response.data.message}`);
        return false;
        
    } catch (error) {
        console.error("[Bilibili MCP] 验证凭证时网络错误:", error.message);
        return false;
    }
}

/**
 * 二维码登录（参考 bilibili-api 优化）
 * @returns {Promise<string>} - 登录结果
 */
async function loginByQRCode() {
    try {
        console.log("[Bilibili MCP] 开始二维码登录流程...");
        
        // 1. 生成二维码
        const genResponse = await axios.get(BILI_API.QR_GENERATE, {
            headers: getHeaders(),
            timeout: 10000
        });
        
        if (genResponse.data.code !== 0) {
            return `获取登录二维码失败: ${parseErrorMessage(genResponse.data.code, genResponse.data.message)}`;
        }
        
        const { url, qrcode_key } = genResponse.data.data;
        console.log("[Bilibili MCP] 二维码 URL:", url);

        // 2. 生成二维码图片
        const qrCodePath = path.join(__dirname, 'bilibili_qrcode.png');
        await qrcode.toFile(qrCodePath, url, {
            width: 300,
            margin: 2,
            errorCorrectionLevel: 'M'
        });

        // 3. 打开二维码图片
        console.log("[Bilibili MCP] 正在尝试打开二维码图片...");
        console.log("[Bilibili MCP] 二维码文件路径:", qrCodePath);
        
        try {
            let openCommand;
            if (process.platform === 'win32') {
                // Windows: 使用 start 命令，需要特殊处理空格
                openCommand = `start "" "${qrCodePath}"`;
            } else if (process.platform === 'darwin') {
                // macOS
                openCommand = `open "${qrCodePath}"`;
            } else {
                // Linux
                openCommand = `xdg-open "${qrCodePath}"`;
            }
            
            console.log("[Bilibili MCP] 执行打开命令:", openCommand);
            
            exec(openCommand, (error, stdout, stderr) => {
                if (error) {
                    console.warn("[Bilibili MCP] ⚠️ 自动打开图片失败:", error.message);
                    console.log("[Bilibili MCP] 请手动打开二维码图片:", qrCodePath);
                } else {
                    console.log("[Bilibili MCP] ✓ 二维码图片已自动打开");
                }
            });
        } catch (openError) {
            console.warn("[Bilibili MCP] ⚠️ 打开图片时出错:", openError.message);
        }
        
        console.log("[Bilibili MCP] 二维码已生成，请在 180 秒内使用 Bilibili 手机客户端扫描登录。");
        console.log("[Bilibili MCP] 💡 如果图片没有自动打开，请手动打开:", qrCodePath);

        const pollEndTime = Date.now() + 180000; // 二维码有效期 180 秒
        let lastStatus = '';


        // 4. 轮询登录状态
        return new Promise((resolve) => {
            const pollInterval = setInterval(async () => {
                if (Date.now() > pollEndTime) {
                    clearInterval(pollInterval);
                    // 清理二维码文件
                    try {
                        if (fs.existsSync(qrCodePath)) fs.unlinkSync(qrCodePath);
                    } catch (e) { /* ignore */ }
                    resolve("❌ 登录失败：二维码已超时（180秒），请重新尝试登录。");
                    return;
                }

                try {
                    const pollResponse = await axios.get(BILI_API.QR_POLL, {
                        params: { qrcode_key },
                        headers: getHeaders(),
                        timeout: 10000
                    });
                    
                    const pollData = pollResponse.data.data;
                    const statusCode = pollData.code;

                    // 更新状态显示
                    if (statusCode === 86101 && lastStatus !== '86101') {
                        console.log("[Bilibili MCP] ⏳ 等待用户扫描二维码...");
                        lastStatus = '86101';
                    } else if (statusCode === 86090 && lastStatus !== '86090') {
                        console.log("[Bilibili MCP] 📱 已扫描，等待用户在手机上确认登录...");
                        lastStatus = '86090';
                    }

                    switch (statusCode) {
                        case 0: // 登录成功
                            clearInterval(pollInterval);
                            
                            // 清理二维码文件
                            try {
                                if (fs.existsSync(qrCodePath)) fs.unlinkSync(qrCodePath);
                            } catch (e) { /* ignore */ }
                            
                            // 解析凭证（处理 \u0026 编码问题）
                            let cookieUrl = pollData.url;
                            // 处理 Unicode 转义字符
                            cookieUrl = cookieUrl.replace(/\\u0026/g, '&');
                            const urlParams = new URLSearchParams(cookieUrl.substring(cookieUrl.indexOf('?') + 1));
                            
                            // 验证必要凭证是否存在
                            const sessdata = urlParams.get('SESSDATA');
                            const biliJct = urlParams.get('bili_jct');
                            const dedeUserID = urlParams.get('DedeUserID');
                            
                            if (!sessdata || !biliJct || !dedeUserID) {
                                console.error("[Bilibili MCP] 凭证解析失败，URL:", cookieUrl);
                                resolve("❌ 登录失败：无法从响应中解析凭证，请重试。");
                                break;
                            }
                            
                            // 获取 buvid3/buvid4
                            const buvidInfo = await fetchBuvid();
                            
                            credential = {
                                SESSDATA: sessdata,
                                bili_jct: biliJct,
                                DedeUserID: dedeUserID,
                                refresh_token: pollData.refresh_token,
                                buvid3: buvidInfo.buvid3,
                                buvid4: buvidInfo.buvid4,
                                b_nut: buvidInfo.b_nut
                            };

                            // 保存凭证
                            const configPath = path.join(__dirname, 'bili_config.json');
                            fs.writeFileSync(configPath, JSON.stringify(credential, null, 2), 'utf-8');
                            
                            console.log("[Bilibili MCP] ✅ 登录成功！凭证已保存到 bili_config.json");
                            
                            // 获取 bili_ticket（异步，不阻塞登录流程）
                            getBiliTicket(credential.bili_jct).catch(err => {
                                console.warn("[Bilibili MCP] bili_ticket 获取失败:", err.message);
                            });
                            
                            // 获取用户信息
                            try {
                                const userInfo = await axios.get(BILI_API.NAV, {
                                    headers: getHeaders(credential),
                                    timeout: 5000
                                });
                                if (userInfo.data.code === 0) {
                                    const uname = userInfo.data.data.uname;
                                    const level = userInfo.data.data.level_info?.current_level || 0;
                                    console.log(`[Bilibili MCP] 欢迎，${uname}！当前等级: Lv${level}`);
                                    resolve(`✅ 登录成功！\n用户名: ${uname}\n等级: Lv${level}\n\n现在您可以使用发送评论和弹幕功能了！`);
                                } else {
                                    resolve("✅ 登录成功！现在您可以使用发送评论和弹幕功能了！");
                                }
                            } catch (e) {
                                resolve("✅ 登录成功！现在您可以使用发送评论和弹幕功能了！");
                            }
                            break;
                            
                        case 86038: // 二维码已失效
                            clearInterval(pollInterval);
                            try {
                                if (fs.existsSync(qrCodePath)) fs.unlinkSync(qrCodePath);
                            } catch (e) { /* ignore */ }
                            resolve("❌ 登录失败：二维码已失效，请重新尝试登录。");
                            break;
                            
                        case 86090: // 已扫描，等待确认
                            // 继续轮询
                            break;
                            
                        case 86101: // 未扫描
                            // 继续轮询
                            break;
                            
                        default:
                            console.warn(`[Bilibili MCP] 未知状态码: ${statusCode}`);
                            break;
                    }
                } catch (pollError) {
                    // 网络错误不停止轮询，让超时处理
                    console.error("[Bilibili MCP] 轮询登录状态时网络错误:", pollError.message);
                }
            }, 2000); // 每 2 秒轮询一次
        });

    } catch (error) {
        console.error("[Bilibili MCP] 获取登录二维码失败:", error);
        return `获取登录二维码失败: ${error.message}`;
    }
}

/**
 * 检查 Cookie 状态（简化版）
 * 
 * 注意：完整的 Cookie 刷新需要 RSA-OAEP 加密和多步骤流程，实现复杂。
 * 参考：https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/login/cookie_refresh.md
 * 
 * 当前策略：检查 Cookie 是否有效，如果需要刷新则提示用户重新登录。
 * 
 * @returns {Promise<boolean>} - Cookie 是否有效
 */
async function refreshCookie() {
    if (!credential) {
        console.error("[Bilibili MCP] 无法检查Cookie：凭证不存在");
        return false;
    }

    try {
        console.log("[Bilibili MCP] 正在检查Cookie状态...");
        
        // 检查 Cookie 是否需要刷新
        const infoResponse = await axios.get(BILI_API.COOKIE_INFO, {
            params: { csrf: credential.bili_jct },
            headers: getHeaders(credential),
            timeout: 10000
        });
        
        if (infoResponse.data.code === -101) {
            // 账号未登录，Cookie 已失效
            console.error("[Bilibili MCP] ❌ Cookie 已失效（账号未登录）");
            console.error("[Bilibili MCP] 请使用 login_bilibili_by_qrcode 重新登录");
            return false;
        }
        
        if (infoResponse.data.code !== 0) {
            console.error(`[Bilibili MCP] 检查Cookie状态失败: ${parseErrorMessage(infoResponse.data.code, infoResponse.data.message)}`);
            return false;
        }
        
        const needRefresh = infoResponse.data.data?.refresh;
        const timestamp = infoResponse.data.data?.timestamp;
        
        if (needRefresh) {
            // Cookie 需要刷新，但完整刷新流程复杂，提示重新登录
            console.warn("[Bilibili MCP] ⚠️ Cookie 需要刷新");
            console.warn("[Bilibili MCP] 由于完整刷新流程需要 RSA-OAEP 加密等复杂操作，建议重新登录");
            console.warn("[Bilibili MCP] 请使用 login_bilibili_by_qrcode 工具重新登录以获取新的凭证");
            
            // 虽然需要刷新，但当前 Cookie 可能仍然可用，先返回 true
            // 让用户继续使用，直到真正失效
            return true;
        }
        
        console.log("[Bilibili MCP] ✅ Cookie 状态正常，无需刷新");
        return true;
        
    } catch (error) {
        console.error("[Bilibili MCP] 检查Cookie状态时发生错误:", error.message);
        
        // 网络错误时，假设 Cookie 仍然有效，让请求继续
        if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
            console.warn("[Bilibili MCP] 网络错误，假设Cookie仍然有效");
            return true;
        }
        
        return false;
    }
}

/**
 * 验证评论是否真的发送成功并可见
 * @param {string} bvid - 视频BV号
 * @param {number} aid - 视频AID
 * @param {string} commentText - 评论内容
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<object>} - { success: boolean, message: string }
 */
async function verifyCommentSuccess(bvid, aid, commentText, maxRetries = 2) {
    console.log(`[Bilibili MCP] 验证评论是否可见...`);
    
    // 等待B站处理评论
    await sleep(getRandomDelay(3000, 5000));
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Bilibili MCP] 验证尝试 ${attempt}/${maxRetries}...`);
            
            // 获取最新评论列表（按时间排序）
            const response = await axios.get(BILI_API.COMMENT_LIST, {
                params: {
                    type: 1,
                    oid: aid,
                    sort: 0,  // 0=按时间排序，2=按热度排序
                    ps: 20,   // 获取最新20条
                    pn: 1
                },
                headers: getHeaders(credential),
                timeout: 10000
            });
            
            if (response.data.code !== 0) {
                console.warn(`[Bilibili MCP] 获取评论列表失败: ${parseErrorMessage(response.data.code, response.data.message)}`);
                if (attempt < maxRetries) {
                    await sleep(2000);
                    continue;
                }
                return {
                    success: false,
                    message: '无法验证评论（获取评论列表失败）'
                };
            }
            
            const replies = response.data.data?.replies || [];
            
            // 查找匹配的评论（检查内容和用户ID）
            const myComment = replies.find(reply => 
                reply.content?.message === commentText.trim() && 
                reply.mid?.toString() === credential.DedeUserID?.toString()
            );
            
            if (myComment) {
                console.log(`[Bilibili MCP] ✓ 评论验证成功：评论已可见！`);
                return {
                    success: true,
                    message: '评论已确认可见'
                };
            }
            
            // 如果没找到，等待后重试
            if (attempt < maxRetries) {
                console.log(`[Bilibili MCP] 未找到评论，等待后重试...`);
                await sleep(3000);
            }
            
        } catch (error) {
            console.error(`[Bilibili MCP] 验证评论时出错 (尝试 ${attempt}/${maxRetries}):`, error.message);
            if (attempt < maxRetries) {
                await sleep(2000);
            }
        }
    }
    
    // 所有尝试都失败
    console.warn(`[Bilibili MCP] ⚠️ 评论验证失败：在评论列表中未找到该评论`);
    return {
        success: false,
        message: '评论可能只有自己可见（影子评论）'
    };
}

/**
 * 发送评论（参考 bilibili-api 优化反风控）
 * @param {object} parameters - 参数对象
 * @returns {Promise<string>} - 发送结果
 */
async function doSendComment(parameters) {
    // 验证凭证
    const valid = await isCredentialValid();
    if (!valid) {
        return "发送评论失败：B站身份凭证无效或已过期，且自动刷新失败。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
    }
    
    // 验证bili_jct是否存在（CSRF Token）
    if (!credential || !credential.bili_jct) {
        console.error("[Bilibili MCP] bili_jct (CSRF Token) 缺失");
        // 尝试刷新凭证获取新的bili_jct
        // bili_jct 缺失，需要重新登录
        return "发送评论失败：CSRF Token (bili_jct) 缺失。\n\n请使用 `login_bilibili_by_qrcode` 工具重新登录以获取新的凭证。";
    }
    
    const { bvid, comment_text, simulate_human = true } = parameters;
    
    // 参数验证
    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return `发送评论失败：无效的BV号格式 "${bvid}"`;
    }
    if (!comment_text || comment_text.trim().length === 0) {
        return "发送评论失败：评论内容不能为空";
    }
    if (comment_text.length > 1000) {
        return "发送评论失败：评论内容过长（最多1000字符）";
    }
    
    try {
        console.log(`[Bilibili MCP] 准备发送评论到视频 ${bvid}...`);
        
        // 0. 模拟人类行为：先浏览视频页面（增强反风控）
        if (simulate_human) {
            await simulateBrowsing(bvid, credential);
            await sleep(getRandomDelay(2000, 4000)); // 增加随机延迟，更像人类
        }
        
        // 1. 获取视频信息
        const videoUrl = `https://www.bilibili.com/video/${bvid}`;
        let videoInfo;
        
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const videoResponse = await axios.get(BILI_API.VIDEO_INFO, {
                    params: { bvid },
                    headers: getHeaders(credential, videoUrl),
                    timeout: 10000
                });
                
                if (videoResponse.data.code !== 0) {
                    return `发送评论失败：${parseErrorMessage(videoResponse.data.code, videoResponse.data.message)}`;
                }
                
                videoInfo = videoResponse.data.data;
                console.log(`[Bilibili MCP] 目标视频: ${videoInfo.title}`);
                break;
            } catch (err) {
                if (attempt === 2) throw err;
                await sleep(1000);
            }
        }
        
        // 2. 上报观看历史（关键：让B站知道你真的在看视频）
        console.log(`[Bilibili MCP] 上报观看历史...`);
        try {
            const reportData = new URLSearchParams({
                aid: videoInfo.aid.toString(),
                cid: videoInfo.cid.toString(),
                bvid: bvid,
                part: '1',
                mid: credential.DedeUserID,
                csrf: credential.bili_jct,
                played_time: '0',
                realtime: '0',
                start_ts: Math.floor(Date.now() / 1000).toString(),
                type: '3',
                dt: '2',
                play_type: '0'
            });
            
            const reportResponse = await axios.post(
                BILI_API.HISTORY_REPORT,
                reportData.toString(),
                {
                    headers: {
                        ...getHeaders(credential, videoUrl),
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 10000
                }
            );
            
            if (reportResponse.data.code === 0) {
                console.log(`[Bilibili MCP] ✓ 观看历史上报成功`);
            } else {
                console.warn(`[Bilibili MCP] ⚠️ 观看历史上报失败: ${parseErrorMessage(reportResponse.data.code, reportResponse.data.message)}`);
            }
        } catch (reportErr) {
            console.warn(`[Bilibili MCP] ⚠️ 观看历史上报异常（继续评论流程）:`, reportErr.message);
        }
        
        // 3. 模拟观看：等待一段时间，然后发送播放心跳
        const watchTime = simulate_human ? getRandomDelay(5000, 10000) : 3000;
        console.log(`[Bilibili MCP] 模拟观看视频 ${Math.floor(watchTime/1000)} 秒...`);
        await sleep(watchTime);
        
        // 发送播放心跳（增强真实性）
        try {
            const heartbeatData = new URLSearchParams({
                aid: videoInfo.aid.toString(),
                cid: videoInfo.cid.toString(),
                bvid: bvid,
                mid: credential.DedeUserID,
                csrf: credential.bili_jct,
                played_time: Math.floor(watchTime / 1000).toString(),
                realtime: Math.floor(watchTime / 1000).toString(),
                start_ts: Math.floor(Date.now() / 1000).toString(),
                type: '3',
                dt: '2',
                play_type: '0'
            });
            
            const heartbeatResponse = await axios.post(
                BILI_API.VIDEO_HEARTBEAT,
                heartbeatData.toString(),
                {
                    headers: {
                        ...getHeaders(credential, videoUrl),
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 10000
                }
            );
            
            if (heartbeatResponse.data.code === 0) {
                console.log(`[Bilibili MCP] ✓ 播放心跳发送成功`);
            } else {
                console.warn(`[Bilibili MCP] ⚠️ 播放心跳失败: ${parseErrorMessage(heartbeatResponse.data.code, heartbeatResponse.data.message)}`);
            }
        } catch (hbErr) {
            console.warn(`[Bilibili MCP] ⚠️ 播放心跳异常（继续评论流程）:`, hbErr.message);
        }
        
        // 4. 模拟思考评论的时间
        if (simulate_human) {
            const thinkingTime = Math.min(comment_text.length * 50, 3000); // 根据评论长度调整
            await sleep(getRandomDelay(thinkingTime, thinkingTime + 1000));
        }
        
        // 5. 发送评论（带增强重试机制）
        const commentData = new URLSearchParams({
            oid: videoInfo.aid.toString(),
            type: '1',  // 1表示视频评论
            message: comment_text.trim(),
            plat: '1',  // 平台类型
            csrf: credential.bili_jct
        });
        
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[Bilibili MCP] 发送评论尝试 ${attempt}/3...`);
                
                // 每次重试前添加随机延迟
                if (attempt > 1) {
                    await sleep(getRandomDelay(3000, 5000));
                }
                
                const response = await axios.post(
                    BILI_API.COMMENT_ADD,
                    commentData.toString(),
                    {
                        headers: {
                            ...getHeaders(credential, videoUrl),
                            'Content-Type': 'application/x-www-form-urlencoded',
                            // 添加更多反风控标识
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        timeout: 15000
                    }
                );
                
                if (response.data.code === 0) {
                    console.log("[Bilibili MCP] 评论API返回成功，开始验证评论是否真的可见...");
                    
                    // 验证评论是否真的发送成功
                    const verifyResult = await verifyCommentSuccess(bvid, videoInfo.aid, comment_text);
                    
                    if (verifyResult.success) {
                        // 评论确认可见
                        const successMsg = `✅ 评论发送成功并已确认可见！\n\n📝 评论内容: "${comment_text}"\n🎯 视频: ${videoInfo.title}\n✅ 验证状态: ${verifyResult.message}\n\n💡 提示：评论已成功显示在评论区，其他用户可以看到。`;
                        return successMsg;
                    } else {
                        // 评论可能是影子评论
                        const warningMsg = `⚠️ 评论已发送但验证失败（可能是影子评论）\n\n📝 评论内容: "${comment_text}"\n🎯 视频: ${videoInfo.title}\n❌ 验证状态: ${verifyResult.message}\n\n🔍 可能的原因：\n1. 账号等级不足或信用度低（新账号或低等级账号）\n2. 触发了B站的反作弊机制\n3. 评论内容包含敏感词或链接\n4. 发送频率过高\n\n💡 建议：\n1. 提升B站账号等级到Lv2以上\n2. 等待30-60秒后再发送下一条评论\n3. 使用更自然、多样化的评论内容\n4. 完成B站实名认证\n5. 多进行正常的观看、点赞、投币等操作提升信用度\n\n⚠️ 注意：影子评论只有你自己能看到，其他用户看不到。`;
                        return warningMsg;
                    }
                } else {
                    const code = response.data.code;
                    const errMsg = parseErrorMessage(code, response.data.message);
                    console.error(`[Bilibili MCP] 评论发送失败: ${errMsg}`);
                    
                    // 根据错误码判断是否需要重试
                    if (code === -101) {
                        // 凭证失效，无法自动恢复
                        console.log("[Bilibili MCP] 凭证已失效 (code: -101)");
                        return "发送评论失败：凭证已过期。\n\n请使用 `login_bilibili_by_qrcode` 工具重新登录。";
                    }
                    
                    // -111: CSRF校验失败（bili_jct过期）
                    if (code === -111) {
                        console.log("[Bilibili MCP] CSRF校验失败 (code: -111)");
                        return "发送评论失败：CSRF Token (bili_jct) 已过期。\n\n请使用 `login_bilibili_by_qrcode` 工具重新登录以获取新的凭证。";
                    }
                    
                    // 特定错误码不重试，直接返回
                    // 12002/12052: 评论区已关闭
                    // 12003: 禁止回复
                    // 12015: 需要验证码（无法自动处理）
                    // 12016: 包含敏感信息
                    // 12025: 字数过多
                    // 12035: 被UP主拉黑
                    // 12051: 重复评论
                    // -102: 账号被封停
                    // 61001: 账号被封禁
                    if ([12002, 12003, 12015, 12016, 12025, 12035, 12051, 12052, -102, 61001].includes(code)) {
                        // 针对特定错误给出更详细的建议
                        let advice = '';
                        if (code === 12015) {
                            advice = '\n\n💡 建议：B站要求验证码，请稍后在网页端手动发送评论，或等待一段时间后重试。';
                        } else if (code === 12016) {
                            advice = '\n\n💡 建议：请检查评论内容是否包含敏感词、链接或特殊字符，修改后重试。';
                        } else if (code === 12051) {
                            advice = '\n\n💡 建议：请等待一段时间后发送不同内容的评论，避免重复内容。';
                        } else if (code === 12035) {
                            advice = '\n\n💡 提示：您已被该视频的UP主列入评论黑名单，无法在此视频下评论。';
                        } else if (code === -509) {
                            advice = '\n\n💡 建议：请求过于频繁，请等待几分钟后再试。';
                        }
                        return `发送评论失败：${errMsg}${advice}`;
                    }
                    
                    // -509: 请求过于频繁，可以重试但需要更长延迟
                    if (code === -509) {
                        console.warn("[Bilibili MCP] 请求过于频繁，增加延迟...");
                        if (attempt < 3) {
                            await sleep(getRandomDelay(10000, 15000));
                        }
                    }
                    
                    lastError = errMsg;
                }
                
            } catch (reqError) {
                console.error(`[Bilibili MCP] 评论发送请求失败 (尝试 ${attempt}/3):`, reqError.message);
                lastError = reqError.message;
                
                // HTTP 412 风控错误，增加更长延迟
                if (reqError.response?.status === 412) {
                    console.warn("[Bilibili MCP] 触发风控 (412)，增加延迟...");
                    if (attempt < 3) {
                        await sleep(getRandomDelay(5000, 8000));
                    }
                } else if (attempt < 3) {
                    await sleep(getRandomDelay(2000, 3000));
                }
            }
        }
        
        // 根据最后的错误类型提供更具体的建议
        let errorMsg = `发送评论失败（已重试3次）：${lastError}`;
        
        if (lastError && lastError.includes('CSRF')) {
            errorMsg += `\n\n🔐 CSRF校验失败通常表示您的登录凭证(bili_jct)已过期。\n\n解决方案：\n1. 使用 login_bilibili_by_qrcode 工具重新登录\n2. 扫码后等待完整保存凭证\n3. 确保系统时间正确（与北京时间一致）\n4. 如果频繁出现此问题，可能是账号异常，请检查B站账号状态`;
        } else if (lastError && (lastError.includes('风控') || lastError.includes('412'))) {
            errorMsg += `\n\n建议：\n1. 等待30-60分钟后重试\n2. 降低操作频率\n3. 提升B站账号等级\n4. 完成B站实名认证`;
        } else {
            errorMsg += `\n\n建议：\n1. 等待更长时间后重试\n2. 检查账号状态\n3. 降低发送频率`;
        }
        
        return errorMsg;
        
    } catch (error) {
        console.error("[Bilibili MCP] 发送评论时发生严重错误:", error);
        return `发送评论时发生错误: ${error.message}`;
    }
}

/**
 * 发送弹幕（参考 bilibili-api 优化反风控）
 * @param {object} parameters - 参数对象
 * @returns {Promise<string>} - 发送结果
 */
async function doSendDanmaku(parameters) {
    // 验证凭证
    const valid = await isCredentialValid();
    if (!valid) {
        return "发送弹幕失败：B站身份凭证无效或已过期，且自动刷新失败。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
    }
    
    const { bvid, danmaku_text, time = 0, color = '16777215', fontsize = '25', mode = '1' } = parameters;
    
    // 参数验证
    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return `发送弹幕失败：无效的BV号格式 "${bvid}"`;
    }
    if (!danmaku_text || danmaku_text.trim().length === 0) {
        return "发送弹幕失败：弹幕内容不能为空";
    }
    if (danmaku_text.length > 100) {
        return "发送弹幕失败：弹幕内容过长（最多100字符）";
    }
    if (time < 0) {
        return "发送弹幕失败：时间参数不能为负数";
    }
    
    try {
        console.log(`[Bilibili MCP] 准备发送弹幕到视频 ${bvid}，时间点: ${time}秒...`);
        
        // 1. 获取视频信息（带重试）
        const videoUrl = `https://www.bilibili.com/video/${bvid}`;
        let videoInfo;
        
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const videoResponse = await axios.get(BILI_API.VIDEO_INFO, {
                    params: { bvid },
                    headers: getHeaders(credential, videoUrl),
                    timeout: 10000
                });
                
                if (videoResponse.data.code !== 0) {
                    return `发送弹幕失败：${parseErrorMessage(videoResponse.data.code, videoResponse.data.message)}`;
                }
                
                videoInfo = videoResponse.data.data;
                console.log(`[Bilibili MCP] 目标视频: ${videoInfo.title}`);
                break;
            } catch (err) {
                if (attempt === 2) throw err;
                await sleep(1000);
            }
        }
        
        // 检查时间是否超过视频长度
        if (time > videoInfo.duration) {
            return `发送弹幕失败：指定时间(${time}秒)超过视频长度(${videoInfo.duration}秒，即${formatDuration(videoInfo.duration)})`;
        }
        
        // 添加随机延迟，模拟人类行为
        await sleep(getRandomDelay(500, 1500));
        
        // 2. 发送弹幕（带增强重试机制）
        // 注意：根据 bilibili-API-collect 文档，发送弹幕需要 WBI 签名
        const danmakuData = new URLSearchParams({
            type: '1',  // 弹幕类型: 1-视频弹幕
            oid: videoInfo.cid.toString(),  // cid
            msg: danmaku_text.trim(),
            aid: videoInfo.aid.toString(),  // aid
            bvid: bvid,  // bvid
            progress: Math.round(time * 1000).toString(), // 进度，毫秒
            color: color,  // 颜色: 16777215-白色
            fontsize: fontsize,     // 字体大小: 25-正常
            pool: '0',          // 弹幕池: 0-普通池
            mode: mode,          // 弹幕模式: 1-滚动, 4-底部, 5-顶部
            rnd: (Date.now() * 1000).toString(),  // 时间戳*1000（微秒级），减少冷却时间
            plat: '1',          // 平台
            csrf: credential.bili_jct
        });
        
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[Bilibili MCP] 发送弹幕尝试 ${attempt}/3...`);
                
                // 每次重试前添加随机延迟
                if (attempt > 1) {
                    await sleep(getRandomDelay(2000, 4000));
                }
                
                // 获取 WBI 签名参数（文档要求 w_rid 和 wts 是必要的）
                const wbiParams = await encWbi({
                    csrf: credential.bili_jct
                });
                
                // 构建带 WBI 签名的 URL
                const urlWithWbi = `${BILI_API.DANMAKU_POST}?csrf=${credential.bili_jct}&w_rid=${wbiParams.w_rid}&wts=${wbiParams.wts}`;
                
                const response = await axios.post(
                    urlWithWbi,
                    danmakuData.toString(),
                    {
                        headers: {
                            ...getHeaders(credential, videoUrl),
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        timeout: 15000
                    }
                );
                
                if (response.data.code === 0) {
                    console.log("[Bilibili MCP] 弹幕发送成功！");
                    const modeText = mode === '1' ? '滚动' : mode === '4' ? '底部' : mode === '5' ? '顶部' : '未知';
                    return `✅ 弹幕发送成功！\n内容: "${danmaku_text}"\n时间: ${time}秒 (${formatDuration(time)})\n模式: ${modeText}`;
                } else {
                    const code = response.data.code;
                    const errMsg = parseErrorMessage(code, response.data.message);
                    console.error(`[Bilibili MCP] 弹幕发送失败: ${errMsg}`);
                    
                    // 根据错误码判断
                    if (code === -101) {
                        // 凭证失效，无法自动恢复
                        console.log("[Bilibili MCP] 凭证已失效 (code: -101)");
                        return "发送弹幕失败：凭证已过期。\n\n请使用 `login_bilibili_by_qrcode` 工具重新登录。";
                    }
                    
                    // 特定错误码不重试
                    if ([36700, 36702, 61001].includes(code)) {
                        return `发送弹幕失败：${errMsg}`;
                    }
                    
                    lastError = errMsg;
                }
                
            } catch (reqError) {
                console.error(`[Bilibili MCP] 弹幕发送请求失败 (尝试 ${attempt}/3):`, reqError.message);
                lastError = reqError.message;
                
                // HTTP 412 风控错误，增加更长延迟
                if (reqError.response?.status === 412) {
                    console.warn("[Bilibili MCP] 触发风控 (412)，增加延迟...");
                    if (attempt < 3) {
                        await sleep(getRandomDelay(5000, 8000));
                    }
                } else if (attempt < 3) {
                    await sleep(getRandomDelay(2000, 3000));
                }
            }
        }
        
        return `发送弹幕失败（已重试3次）：${lastError}\n\n建议：\n1. 等待更长时间后重试\n2. 检查账号状态\n3. 降低发送频率`;
        
    } catch (error) {
        console.error("[Bilibili MCP] 发送弹幕时发生严重错误:", error);
        return `发送弹幕时发生错误: ${error.message}`;
    }
}

/**
 * 视频互动功能：点赞、投币、收藏、一键三连
 * @param {object} parameters - 参数对象
 * @returns {Promise<string>} - 操作结果
 */
async function doInteract(parameters) {
    // 验证凭证
    const valid = await isCredentialValid();
    if (!valid) {
        return "互动失败：B站身份凭证无效或已过期。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
    }
    
    const { bvid, action, coin_num = 1, like_with_coin = true } = parameters;
    
    // 参数验证
    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return `互动失败：无效的BV号格式 "${bvid}"`;
    }
    
    const validActions = ['like', 'coin', 'favorite', 'triple'];
    if (!validActions.includes(action)) {
        return `互动失败：无效的操作类型 "${action}"，有效值为：like, coin, favorite, triple`;
    }
    
    try {
        console.log(`[Bilibili MCP] 准备对视频 ${bvid} 执行 ${action} 操作...`);
        
        // 获取视频信息
        const videoUrl = `https://www.bilibili.com/video/${bvid}`;
        const videoResponse = await axios.get(BILI_API.VIDEO_INFO, {
            params: { bvid },
            headers: getHeaders(credential, videoUrl),
            timeout: 10000
        });
        
        if (videoResponse.data.code !== 0) {
            return `互动失败：${parseErrorMessage(videoResponse.data.code, videoResponse.data.message)}`;
        }
        
        const videoInfo = videoResponse.data.data;
        console.log(`[Bilibili MCP] 目标视频: ${videoInfo.title}`);
        
        // 添加随机延迟，模拟人类行为
        await sleep(getRandomDelay(500, 1500));
        
        // 根据操作类型执行
        switch (action) {
            case 'like':
                return await doLike(bvid, videoInfo, videoUrl);
            case 'coin':
                return await doCoin(bvid, videoInfo, videoUrl, coin_num, like_with_coin);
            case 'favorite':
                return await doFavorite(bvid, videoInfo, videoUrl);
            case 'triple':
                return await doTriple(bvid, videoInfo, videoUrl);
            default:
                return `互动失败：不支持的操作类型 "${action}"`;
        }
        
    } catch (error) {
        console.error("[Bilibili MCP] 视频互动时发生错误:", error);
        return `互动失败: ${error.message}`;
    }
}

/**
 * 点赞视频
 */
async function doLike(bvid, videoInfo, videoUrl) {
    try {
        console.log(`[Bilibili MCP] 正在点赞视频...`);
        
        const likeData = new URLSearchParams({
            bvid: bvid,
            like: '1',  // 1=点赞, 2=取消点赞
            csrf: credential.bili_jct
        });
        
        const response = await axios.post(
            BILI_API.VIDEO_LIKE,
            likeData.toString(),
            {
                headers: {
                    ...getHeaders(credential, videoUrl),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            }
        );
        
        if (response.data.code === 0) {
            console.log("[Bilibili MCP] ✅ 点赞成功！");
            return `✅ 点赞成功！\n\n🎬 视频: ${videoInfo.title}\n👍 已为该视频点赞`;
        } else if (response.data.code === 65006) {
            return `⚠️ 你已经点赞过这个视频了\n\n🎬 视频: ${videoInfo.title}`;
        } else {
            return `点赞失败：${parseErrorMessage(response.data.code, response.data.message)}`;
        }
        
    } catch (error) {
        console.error("[Bilibili MCP] 点赞失败:", error);
        return `点赞失败: ${error.message}`;
    }
}

/**
 * 投币视频
 */
async function doCoin(bvid, videoInfo, videoUrl, coinNum, likeWithCoin) {
    try {
        // 验证投币数量
        const num = Math.min(Math.max(parseInt(coinNum) || 1, 1), 2);
        
        console.log(`[Bilibili MCP] 正在投${num}个币...`);
        
        const coinData = new URLSearchParams({
            bvid: bvid,
            multiply: num.toString(),  // 投币数量
            select_like: likeWithCoin ? '1' : '0',  // 是否同时点赞
            csrf: credential.bili_jct
        });
        
        const response = await axios.post(
            BILI_API.VIDEO_COIN,
            coinData.toString(),
            {
                headers: {
                    ...getHeaders(credential, videoUrl),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            }
        );
        
        if (response.data.code === 0) {
            console.log("[Bilibili MCP] ✅ 投币成功！");
            const likeText = likeWithCoin ? '（已同时点赞）' : '';
            return `✅ 投币成功！\n\n🎬 视频: ${videoInfo.title}\n🪙 已投${num}个硬币${likeText}`;
        } else if (response.data.code === 34005) {
            return `⚠️ 投币失败：超过投币上限\n\n🎬 视频: ${videoInfo.title}\n💡 每个视频最多投2个币，或今日硬币已用完`;
        } else {
            return `投币失败：${parseErrorMessage(response.data.code, response.data.message)}`;
        }
        
    } catch (error) {
        console.error("[Bilibili MCP] 投币失败:", error);
        return `投币失败: ${error.message}`;
    }
}

/**
 * 收藏视频
 */
async function doFavorite(bvid, videoInfo, videoUrl) {
    try {
        console.log(`[Bilibili MCP] 正在收藏视频...`);
        
        // 先获取用户的收藏夹列表
        const folderResponse = await axios.get(BILI_API.FAV_FOLDER_LIST, {
            params: {
                up_mid: credential.DedeUserID,
                type: 2  // 2表示视频收藏夹
            },
            headers: getHeaders(credential, videoUrl),
            timeout: 10000
        });
        
        if (folderResponse.data.code !== 0 || !folderResponse.data.data?.list) {
            return `收藏失败：无法获取收藏夹列表 (${folderResponse.data.message || '未知错误'})`;
        }
        
        // 使用默认收藏夹（第一个）
        const defaultFolder = folderResponse.data.data.list[0];
        if (!defaultFolder) {
            return `收藏失败：找不到可用的收藏夹`;
        }
        
        console.log(`[Bilibili MCP] 使用收藏夹: ${defaultFolder.title}`);
        
        const favoriteData = new URLSearchParams({
            rid: videoInfo.aid.toString(),
            type: '2',  // 2表示视频
            add_media_ids: defaultFolder.id.toString(),
            del_media_ids: '',
            csrf: credential.bili_jct
        });
        
        const response = await axios.post(
            BILI_API.VIDEO_FAVORITE,
            favoriteData.toString(),
            {
                headers: {
                    ...getHeaders(credential, videoUrl),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            }
        );
        
        if (response.data.code === 0) {
            console.log("[Bilibili MCP] ✅ 收藏成功！");
            return `✅ 收藏成功！\n\n🎬 视频: ${videoInfo.title}\n📁 已添加到收藏夹: ${defaultFolder.title}`;
        } else if (response.data.code === 11201) {
            return `⚠️ 你已经收藏过这个视频了\n\n🎬 视频: ${videoInfo.title}`;
        } else {
            return `收藏失败：${parseErrorMessage(response.data.code, response.data.message)}`;
        }
        
    } catch (error) {
        console.error("[Bilibili MCP] 收藏失败:", error);
        return `收藏失败: ${error.message}`;
    }
}

/**
 * 一键三连（点赞+投币+收藏）
 */
async function doTriple(bvid, videoInfo, videoUrl) {
    try {
        console.log(`[Bilibili MCP] 正在执行一键三连...`);
        
        const tripleData = new URLSearchParams({
            bvid: bvid,
            csrf: credential.bili_jct
        });
        
        const response = await axios.post(
            BILI_API.VIDEO_TRIPLE,
            tripleData.toString(),
            {
                headers: {
                    ...getHeaders(credential, videoUrl),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            }
        );
        
        if (response.data.code === 0) {
            const data = response.data.data;
            console.log("[Bilibili MCP] ✅ 一键三连成功！");
            
            // 构建结果信息
            let resultText = `✅ 一键三连成功！\n\n🎬 视频: ${videoInfo.title}\n`;
            resultText += `👍 点赞: ${data.like ? '成功' : '已点赞'}\n`;
            resultText += `🪙 投币: ${data.coin ? '成功' : '已投满'}\n`;
            resultText += `⭐ 收藏: ${data.fav ? '成功' : '已收藏'}`;
            
            return resultText;
        } else {
            // 如果三连 API 失败，尝试分别执行
            console.warn("[Bilibili MCP] 一键三连API失败，尝试分别执行...");
            
            const results = [];
            
            // 点赞
            try {
                const likeResult = await doLike(bvid, videoInfo, videoUrl);
                results.push(`👍 ${likeResult.includes('成功') || likeResult.includes('已经') ? '✓' : '✗'}`);
            } catch (e) {
                results.push('👍 ✗');
            }
            
            await sleep(getRandomDelay(500, 1000));
            
            // 投币
            try {
                const coinResult = await doCoin(bvid, videoInfo, videoUrl, 2, false);
                results.push(`🪙 ${coinResult.includes('成功') || coinResult.includes('上限') ? '✓' : '✗'}`);
            } catch (e) {
                results.push('🪙 ✗');
            }
            
            await sleep(getRandomDelay(500, 1000));
            
            // 收藏
            try {
                const favResult = await doFavorite(bvid, videoInfo, videoUrl);
                results.push(`⭐ ${favResult.includes('成功') || favResult.includes('已经') ? '✓' : '✗'}`);
            } catch (e) {
                results.push('⭐ ✗');
            }
            
            return `一键三连结果（分步执行）\n\n🎬 视频: ${videoInfo.title}\n${results.join('\n')}`;
        }
        
    } catch (error) {
        console.error("[Bilibili MCP] 一键三连失败:", error);
        return `一键三连失败: ${error.message}`;
    }
}


// --- 3. MCP模块导出 ---
function getToolDefinitions() {
    return [LOGIN_TOOL, SEARCH_TOOL, COMPREHENSIVE_INFO_TOOL, COMMENT_TOOL, DANMAKU_TOOL, RANKING_TOOL, INTERACT_TOOL];
}

async function executeFunction(name, parameters) {
    switch (name) {
        case "login_bilibili_by_qrcode": return await loginByQRCode();
        case "search_bilibili_video": return await searchVideo(parameters);
        case "get_bilibili_video_comprehensive_info": return await getComprehensiveInfo(parameters);
        case "send_bilibili_comment": return await doSendComment(parameters);
        case "send_bilibili_danmaku": return await doSendDanmaku(parameters);
        case "get_bilibili_ranking": return await getRanking(parameters);
        case "interact_bilibili_video": return await doInteract(parameters);
        default: throw new Error(`不支持的功能: ${name}`);
    }
}

module.exports = {
    getToolDefinitions,
    executeFunction
};
