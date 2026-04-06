/**
 * bili-search.js - B站搜索与排行榜
 */

const axios = require('axios');
const { search } = require('bilibili-api-ts/search');

const {
    BILI_API, VIDEO_ZONES,
    getCredential, getHeaders, parseErrorMessage, encWbi
} = require('./bili-api.js');

async function searchVideo(parameters, defaultLimit = 3) {
    const credential = getCredential();
    const { keyword, limit = defaultLimit } = parameters;

    if (!keyword || keyword.trim().length === 0) {
        return '搜索失败：关键词不能为空';
    }

    console.log(`[Bilibili] 开始搜索视频，关键词: "${keyword}", 限制: ${limit}`);

    try {
        const searchOptions = {
            keyword: keyword.trim(),
            type: 'video',
            page: 1,
            credential
        };

        const response = await search(searchOptions);
        const videoResultObject = response.result.find(item => item.result_type === 'video');

        if (!videoResultObject || !videoResultObject.data || videoResultObject.data.length === 0) {
            console.log(`[Bilibili] 未找到关于 "${keyword}" 的视频`);
            return `在B站没有找到关于 "${keyword}" 的视频。请尝试：\n1. 使用更通用的关键词\n2. 检查关键词拼写\n3. 使用同义词搜索`;
        }

        const videoList = videoResultObject.data;
        const results = videoList.slice(0, limit).map((v, index) => ({
            index: index + 1,
            title: (v.title || '').replace(/<em class="keyword">|<\/em>/g, ''),
            author: v.author || v.uploader || '',
            bvid: v.bvid,
            aid: v.aid,
            url: `https://www.bilibili.com/video/${v.bvid}`,
            play: v.play || 0,
            video_review: v.video_review || v.review || 0,
            duration: v.duration || '未知',
            pubdate: v.pubdate || 0,
            tag: v.tag || '',
            description: (v.description || '').substring(0, 100)
        }));

        console.log(`[Bilibili] 搜索完成，返回 ${results.length} 个结果。`);

        const formattedOutput = {
            keyword: keyword,
            total_results: results.length,
            videos: results
        };

        return JSON.stringify(formattedOutput, null, 2);
    } catch (error) {
        console.error("[Bilibili] 搜索视频失败:", error);

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

async function getRanking(parameters, defaultLimit = 10) {
    const credential = getCredential();
    const { rid = 0, type = 'all', limit = defaultLimit } = parameters;

    const validTypes = ['all', 'rookie', 'origin'];
    if (!validTypes.includes(type)) {
        return `获取排行榜失败：无效的类型 "${type}"，有效值为：all, rookie, origin`;
    }

    const zoneName = VIDEO_ZONES[rid] || `分区${rid}`;
    const typeName = { all: '全部', rookie: '新人', origin: '原创' }[type];

    console.log(`[Bilibili] 获取排行榜：${zoneName} - ${typeName}，数量: ${Math.min(limit, 100)}`);

    try {
        const rankingParams = { rid: rid, type: type, web_location: '333.934' };
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
            view: v.stat?.view || 0,
            danmaku: v.stat?.danmaku || 0,
            reply: v.stat?.reply || 0,
            favorite: v.stat?.favorite || 0,
            coin: v.stat?.coin || 0,
            share: v.stat?.share || 0,
            like: v.stat?.like || 0,
            duration: v.duration || 0,
            pubdate: v.pubdate || 0,
            desc: (v.desc || '').substring(0, 100),
            tname: v.tname || '',
            his_rank: v.stat?.his_rank || 0
        }));

        console.log(`[Bilibili] 排行榜获取成功，返回 ${results.length} 个视频`);

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
        console.error("[Bilibili] 获取排行榜失败:", error);
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

module.exports = { searchVideo, getRanking };
