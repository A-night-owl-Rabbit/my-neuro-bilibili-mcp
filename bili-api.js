/**
 * bili-api.js - B站 API 常量与基础工具函数
 * 包含：API 端点、请求头、Cookie、WBI 签名、buvid、bili_ticket、通用工具函数
 */

const axios = require('axios');
const md5 = require('md5');
const crypto = require('crypto');

// --- API 端点 ---
const BILI_API = {
    NAV: 'https://api.bilibili.com/x/web-interface/nav',
    USER_INFO: 'https://api.bilibili.com/x/space/acc/info',
    VIDEO_INFO: 'https://api.bilibili.com/x/web-interface/view',
    VIDEO_DETAIL: 'https://api.bilibili.com/x/web-interface/view/detail',
    VIDEO_STAT: 'https://api.bilibili.com/x/web-interface/archive/stat',
    COMMENT_LIST: 'https://api.bilibili.com/x/v2/reply',
    COMMENT_ADD: 'https://api.bilibili.com/x/v2/reply/add',
    COMMENT_LIKE: 'https://api.bilibili.com/x/v2/reply/action',
    DANMAKU_LIST: 'https://api.bilibili.com/x/v1/dm/list.so',
    DANMAKU_POST: 'https://api.bilibili.com/x/v2/dm/post',
    DANMAKU_HISTORY: 'https://api.bilibili.com/x/v2/dm/history',
    QR_GENERATE: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
    QR_POLL: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
    COOKIE_REFRESH: 'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
    COOKIE_INFO: 'https://passport.bilibili.com/x/passport-login/web/cookie/info',
    SEARCH: 'https://api.bilibili.com/x/web-interface/search/type',
    HISTORY_REPORT: 'https://api.bilibili.com/x/v2/history/report',
    VIDEO_HEARTBEAT: 'https://api.bilibili.com/x/click-interface/web/heartbeat',
    VIDEO_LIKE: 'https://api.bilibili.com/x/web-interface/archive/like',
    VIDEO_COIN: 'https://api.bilibili.com/x/web-interface/coin/add',
    VIDEO_FAVORITE: 'https://api.bilibili.com/x/v3/fav/resource/deal',
    VIDEO_TRIPLE: 'https://api.bilibili.com/x/web-interface/archive/like/triple',
    FAV_FOLDER_LIST: 'https://api.bilibili.com/x/v3/fav/folder/created/list-all',
    BUVID_SPI: 'https://api.bilibili.com/x/frontend/finger/spi',
    BILI_TICKET: 'https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket',
    RANKING: 'https://api.bilibili.com/x/web-interface/ranking/v2',
    PLAYER_V2: 'https://api.bilibili.com/x/player/v2'
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ERROR_CODES = {
    '-101': '账号未登录或登录失效',
    '-102': '账号被封停',
    '-111': 'CSRF 校验失败',
    '-400': '请求错误',
    '-403': '权限不足',
    '-404': '无此项',
    '-509': '请求过于频繁',
    '412': '请求被拦截（风控）',
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
    '36700': '弹幕内容包含敏感词',
    '36701': '弹幕发送太频繁',
    '36702': '该视频禁止发送弹幕',
    '61001': '账号被封禁',
    '62011': '稿件审核中',
    '10003': '不存在该稿件',
    '34005': '超过投币上限',
    '65004': '取消点赞失败',
    '65006': '重复点赞',
    '90001': '账号被封禁（互动）',
    '11201': '已经收藏过了',
    '11203': '收藏夹容量已满'
};

const VIDEO_ZONES = {
    0: '全站', 1: '动画', 3: '音乐', 4: '游戏', 5: '娱乐',
    11: '电视剧', 13: '番剧', 17: '单机游戏', 23: '电影', 36: '科技',
    119: '鬼畜', 129: '舞蹈', 155: '时尚', 160: '生活', 165: '广告',
    167: '国创', 177: '纪录片', 181: '影视', 188: '科技', 202: '资讯',
    211: '美食', 217: '动物圈', 223: '汽车', 234: '运动', 236: '知识'
};

// --- WBI 签名 ---
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
];

let wbiKeysCache = { img_key: null, sub_key: null, mixin_key: null, lastUpdate: 0 };
let biliTicketCache = { ticket: null, created_at: 0, ttl: 0 };

// 共享凭证对象，各模块通过 getCredential/setCredential 访问
let credential = null;

function getCredential() { return credential; }
function setCredential(cred) { credential = cred; }

// --- 通用工具函数 ---

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay(min = 1000, max = 3000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function parseErrorMessage(code, message) {
    const codeStr = String(code);
    if (ERROR_CODES[codeStr]) {
        return `${ERROR_CODES[codeStr]} (code: ${code})`;
    }
    return `${message || '未知错误'} (code: ${code})`;
}

function parseCookieString(cookieStr) {
    const parts = cookieStr.split(';')[0].split('=');
    return parts.length >= 2 ? parts[1] : null;
}

// --- Cookie / Headers ---

function getCookieString(cred) {
    if (!cred) return '';
    const cookies = [
        `SESSDATA=${cred.SESSDATA}`,
        `bili_jct=${cred.bili_jct}`,
        `DedeUserID=${cred.DedeUserID}`
    ];
    if (cred.buvid3) cookies.push(`buvid3=${cred.buvid3}`);
    if (cred.buvid4) cookies.push(`buvid4=${cred.buvid4}`);
    if (cred.b_nut) cookies.push(`b_nut=${cred.b_nut}`);
    if (biliTicketCache.ticket) cookies.push(`bili_ticket=${biliTicketCache.ticket}`);
    return cookies.join('; ');
}

function getHeaders(cred = null, videoUrl = null) {
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
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1'
    };
    if (cred) {
        headers['Cookie'] = getCookieString(cred);
    }
    return headers;
}

async function simulateBrowsing(bvid, cred = null) {
    try {
        console.log("[Bilibili] 模拟浏览器行为：访问视频页面...");
        const videoUrl = `https://www.bilibili.com/video/${bvid}`;
        await axios.get('https://www.bilibili.com', {
            headers: getHeaders(cred),
            timeout: 8000
        });
        await sleep(getRandomDelay(300, 600));
        await axios.get(videoUrl, {
            headers: getHeaders(cred, videoUrl),
            timeout: 10000
        });
        await sleep(getRandomDelay(800, 1500));
        console.log("[Bilibili] 浏览行为模拟完成");
        return true;
    } catch (error) {
        console.warn("[Bilibili] 浏览行为模拟失败（不影响后续操作）:", error.message);
        return false;
    }
}

// --- WBI 签名 ---

function getMixinKey(imgKey, subKey) {
    const orig = imgKey + subKey;
    return MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32);
}

async function getWbiKeys() {
    const now = Date.now();
    if (wbiKeysCache.mixin_key && (now - wbiKeysCache.lastUpdate) < 3600000) {
        return wbiKeysCache;
    }
    try {
        console.log("[Bilibili] 获取 WBI Keys...");
        const response = await axios.get(BILI_API.NAV, {
            headers: getHeaders(credential),
            timeout: 10000
        });
        if (response.data.data?.wbi_img) {
            const { img_url, sub_url } = response.data.data.wbi_img;
            const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
            const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
            const mixin_key = getMixinKey(img_key, sub_key);
            wbiKeysCache = { img_key, sub_key, mixin_key, lastUpdate: now };
            console.log(`[Bilibili] WBI Keys 获取成功`);
            return wbiKeysCache;
        }
        console.error("[Bilibili] 响应中未找到 wbi_img 字段");
        return null;
    } catch (error) {
        console.error("[Bilibili] 获取 WBI Keys 失败:", error.message);
        return null;
    }
}

async function encWbi(params) {
    const wbiKeys = await getWbiKeys();
    if (!wbiKeys || !wbiKeys.mixin_key) {
        console.warn("[Bilibili] WBI Keys 不可用，跳过签名");
        return params;
    }
    const mixin_key = wbiKeys.mixin_key;
    const curr_time = Math.round(Date.now() / 1000);
    const chr_filter = /[!'()*]/g;
    const signParams = { ...params, wts: curr_time };
    const query = Object.keys(signParams)
        .sort()
        .map(key => {
            const value = String(signParams[key]).replace(chr_filter, '');
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');
    const w_rid = md5(query + mixin_key);
    return { ...signParams, w_rid };
}

// --- buvid ---

async function fetchBuvid() {
    try {
        console.log("[Bilibili] 正在从 API 获取 buvid...");
        const response = await axios.get(BILI_API.BUVID_SPI, {
            headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://www.bilibili.com' },
            timeout: 10000
        });
        if (response.data.code === 0 && response.data.data) {
            const buvid3 = response.data.data.b_3;
            const buvid4 = response.data.data.b_4;
            const b_nut = Math.floor(Date.now() / 1000);
            console.log("[Bilibili] 成功获取 buvid3/buvid4");
            return { buvid3, buvid4, b_nut };
        } else {
            console.warn("[Bilibili] 获取 buvid 失败，使用本地生成");
            return generateBuvidLocal();
        }
    } catch (error) {
        console.warn("[Bilibili] 获取 buvid 网络错误，使用本地生成:", error.message);
        return generateBuvidLocal();
    }
}

function generateBuvidLocal() {
    const uuid = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => {
        return Math.floor(Math.random() * 16).toString(16).toUpperCase();
    });
    const randomNum = Math.floor(Math.random() * 100000);
    const buvid3 = `${uuid}${randomNum}infoc`;
    const uuid4 = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => {
        return Math.floor(Math.random() * 16).toString(16).toUpperCase();
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const buvid4 = `${uuid4}${randomNum}-0${String(timestamp).slice(-6)}-${Math.random().toString(36).slice(2, 10)}`;
    const b_nut = timestamp;
    console.log("[Bilibili] 已本地生成 buvid3/buvid4");
    return { buvid3, buvid4, b_nut };
}

// --- bili_ticket ---

function hmacSha256(key, message) {
    return crypto.createHmac('sha256', key).update(message).digest('hex');
}

async function getBiliTicket(csrf = '') {
    const now = Math.floor(Date.now() / 1000);
    if (biliTicketCache.ticket && (now - biliTicketCache.created_at) < biliTicketCache.ttl - 3600) {
        return { ticket: biliTicketCache.ticket, fromCache: true };
    }
    try {
        console.log("[Bilibili] 正在获取 bili_ticket...");
        const ts = Math.floor(Date.now() / 1000);
        const hexSign = hmacSha256('XgwSnGZ1p', `ts${ts}`);
        const params = new URLSearchParams({
            key_id: 'ec02',
            hexsign: hexSign,
            'context[ts]': ts.toString(),
            csrf: csrf || ''
        });
        const response = await axios.post(`${BILI_API.BILI_TICKET}?${params.toString()}`, null, {
            headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://www.bilibili.com' },
            timeout: 10000
        });
        if (response.data.code === 0 && response.data.data) {
            const { ticket, created_at, ttl, nav } = response.data.data;
            biliTicketCache = { ticket, created_at, ttl };
            console.log("[Bilibili] bili_ticket 获取成功，有效期:", Math.floor(ttl / 86400), "天");
            if (nav && nav.img && nav.sub) {
                const img_key = nav.img.slice(nav.img.lastIndexOf('/') + 1, nav.img.lastIndexOf('.'));
                const sub_key = nav.sub.slice(nav.sub.lastIndexOf('/') + 1, nav.sub.lastIndexOf('.'));
                const mixin_key = getMixinKey(img_key, sub_key);
                wbiKeysCache = { img_key, sub_key, mixin_key, lastUpdate: Date.now() };
                console.log("[Bilibili] 同时更新了 WBI Keys");
            }
            return { ticket, fromCache: false };
        } else {
            console.warn("[Bilibili] 获取 bili_ticket 失败:", response.data.message);
            return null;
        }
    } catch (error) {
        console.warn("[Bilibili] 获取 bili_ticket 网络错误:", error.message);
        return null;
    }
}

module.exports = {
    BILI_API, USER_AGENT, ERROR_CODES, VIDEO_ZONES,
    getCredential, setCredential,
    sleep, getRandomDelay, formatDuration, parseErrorMessage, parseCookieString,
    getCookieString, getHeaders, simulateBrowsing,
    getMixinKey, getWbiKeys, encWbi,
    fetchBuvid, generateBuvidLocal,
    hmacSha256, getBiliTicket
};
