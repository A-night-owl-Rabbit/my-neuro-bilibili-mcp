/**
 * B站工具集插件 (v3.7.0)
 * 提供B站视频搜索、排行榜、信息获取、内容转录与智能总结、评论与弹幕发送、点赞投币收藏等功能
 */

const { Plugin } = require('../../../js/core/plugin-base.js');

const { loadCredential } = require('./bili-credential.js');
const { loginByQRCode } = require('./bili-credential.js');
const { searchVideo, getRanking } = require('./bili-search.js');
const { getComprehensiveInfo } = require('./bili-video.js');
const { doSendComment, doSendDanmaku, doInteract } = require('./bili-interact.js');

class BilibiliToolsPlugin extends Plugin {

    async onInit() {
        this._pluginConfig = this.context.getPluginConfig();
        if (!this._pluginConfig.enabled) {
            this.context.log('info', 'B站工具集已禁用');
            return;
        }
        this.context.log('info', 'B站工具集初始化中...');
    }

    async onStart() {
        if (!this._pluginConfig.enabled) return;
        try {
            const result = await loadCredential();
            if (result.outcome === 'ready') {
                this.context.log('info', 'B站凭证有效、登录未失效，全部功能已就绪');
            } else if (result.outcome === 'limited') {
                this.context.log('info', 'B站本地凭证已加载；启动时未完成联网校验（不表示已失效）。发送类功能将在使用时由 B 站接口确认。搜索/排行榜可用。');
            } else if (result.outcome === 'missing_config') {
                this.context.log('warn', '未配置 B 站登录凭证，发送类功能不可用（可使用 login_bilibili_by_qrcode）。搜索/排行榜仍可使用。');
            } else if (result.outcome === 'dead') {
                this.context.log('warn', 'B站登录已失效（服务端确认未登录），请使用 login_bilibili_by_qrcode 重新登录。搜索/排行榜仍可使用。');
            } else if (result.outcome === 'load_error') {
                this.context.log('warn', `B站凭证加载异常: ${result.error || '未知错误'}（不表示登录已失效）。搜索/排行榜仍可使用。`);
            }
        } catch (err) {
            this.context.log('error', `B站凭证加载异常: ${err.message}`);
        }
    }

    getTools() {
        if (!this._pluginConfig.enabled) return [];
        return [
            LOGIN_TOOL, SEARCH_TOOL, COMPREHENSIVE_INFO_TOOL,
            COMMENT_TOOL, DANMAKU_TOOL, RANKING_TOOL, INTERACT_TOOL
        ];
    }

    async executeTool(name, params) {
        if (!this._pluginConfig.enabled) return undefined;
        const cfg = this._pluginConfig;

        switch (name) {
            case 'login_bilibili_by_qrcode':
                return await loginByQRCode();
            case 'search_bilibili_video':
                return await searchVideo(params, cfg.search_limit);
            case 'get_bilibili_video_comprehensive_info':
                return await getComprehensiveInfo(params, cfg);
            case 'send_bilibili_comment':
                return await doSendComment(params, cfg.anti_risk);
            case 'send_bilibili_danmaku':
                return await doSendDanmaku(params);
            case 'get_bilibili_ranking':
                return await getRanking(params, cfg.ranking_limit);
            case 'interact_bilibili_video':
                return await doInteract(params);
            default:
                return undefined;
        }
    }

    async onStop() {
        this.context.log('info', 'B站工具集已停止');
    }
}

// --- 工具定义 ---

const LOGIN_TOOL = {
    type: 'function',
    function: {
        name: 'login_bilibili_by_qrcode',
        description: '通过扫描二维码登录B站，以便执行需要登录的操作（如评论、发送弹幕）。',
        parameters: { type: 'object', properties: {}, required: [] }
    }
};

const SEARCH_TOOL = {
    type: 'function',
    function: {
        name: 'search_bilibili_video',
        description: '根据关键词搜索B站视频。',
        parameters: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '搜索关键词' },
                limit: { type: 'number', description: '返回结果数量限制，默认3个' }
            },
            required: ['keyword']
        }
    }
};

const COMPREHENSIVE_INFO_TOOL = {
    type: 'function',
    function: {
        name: 'get_bilibili_video_comprehensive_info',
        description: '获取B站视频的综合信息，包括标题、简介、评论、弹幕和视频内容总结（字幕通过 bilibili-api-python 获取，与 BiliRead 插件相同；无字幕时降级为 Whisper 语音转录）。需配置 python_executable 并 pip install -r 插件目录 requirements.txt。',
        parameters: {
            type: 'object',
            properties: {
                bvid: { type: 'string', description: '必须是从 search_bilibili_video 工具搜索结果中获取的有效BV号' },
                model_size: { type: 'string', description: 'Whisper模型大小，可选值：tiny、base、small、medium、large，默认为medium' }
            },
            required: ['bvid']
        }
    }
};

const COMMENT_TOOL = {
    type: 'function',
    function: {
        name: 'send_bilibili_comment',
        description: '向指定的B站视频发送一条评论。',
        parameters: {
            type: 'object',
            properties: {
                bvid: { type: 'string', description: '视频的BV号' },
                comment_text: { type: 'string', description: '评论内容' }
            },
            required: ['bvid', 'comment_text']
        }
    }
};

const DANMAKU_TOOL = {
    type: 'function',
    function: {
        name: 'send_bilibili_danmaku',
        description: '向指定的B站视频发送一条弹幕。',
        parameters: {
            type: 'object',
            properties: {
                bvid: { type: 'string', description: '视频的BV号' },
                danmaku_text: { type: 'string', description: '弹幕内容' },
                time: { type: 'number', description: '弹幕出现的时间点（秒）' }
            },
            required: ['bvid', 'danmaku_text', 'time']
        }
    }
};

const RANKING_TOOL = {
    type: 'function',
    function: {
        name: 'get_bilibili_ranking',
        description: '获取B站视频排行榜，可按分区筛选，返回热门视频列表。',
        parameters: {
            type: 'object',
            properties: {
                rid: { type: 'number', description: '分区ID：0=全站(默认), 1=动画, 3=音乐, 4=游戏, 5=娱乐, 36=科技, 119=鬼畜, 129=舞蹈, 160=生活, 211=美食, 217=动物圈, 234=运动, 236=知识' },
                type: { type: 'string', description: '排行榜类型：all=全部(默认), rookie=新人, origin=原创' },
                limit: { type: 'number', description: '返回数量（默认10，最大100）' }
            },
            required: []
        }
    }
};

const INTERACT_TOOL = {
    type: 'function',
    function: {
        name: 'interact_bilibili_video',
        description: '对B站视频进行互动操作，支持点赞、投币、收藏，或一键三连。',
        parameters: {
            type: 'object',
            properties: {
                bvid: { type: 'string', description: '视频的BV号' },
                action: { type: 'string', description: '互动类型：like=点赞, coin=投币, favorite=收藏, triple=一键三连（点赞+投币+收藏）' },
                coin_num: { type: 'number', description: '投币数量（1或2），仅在 action=coin 时有效，默认1' },
                like_with_coin: { type: 'boolean', description: '投币时是否同时点赞，仅在 action=coin 时有效，默认true' }
            },
            required: ['bvid', 'action']
        }
    }
};

module.exports = BilibiliToolsPlugin;
