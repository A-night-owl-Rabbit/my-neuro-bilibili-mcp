/**
 * bili-video.js - B站视频详情、字幕提取、语音转录、AI总结
 */

const axios = require('axios');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const {
    BILI_API, USER_AGENT,
    getCredential, getHeaders,
    sleep, getRandomDelay, formatDuration, parseErrorMessage
} = require('./bili-api.js');

const PLUGIN_DIR = __dirname;

/** 总结用 system 提示词：优先读 summary_system_prompt.txt，否则 summary_system_prompt.default.txt，最后用内置极简兜底（仓库不含作者私有长提示词）。 */
function loadSummarySystemPrompt() {
    const customPath = path.join(PLUGIN_DIR, 'summary_system_prompt.txt');
    const defaultPath = path.join(PLUGIN_DIR, 'summary_system_prompt.default.txt');
    try {
        if (fs.existsSync(customPath)) {
            const t = fs.readFileSync(customPath, 'utf8').trim();
            if (t) return t;
        }
        if (fs.existsSync(defaultPath)) {
            const t = fs.readFileSync(defaultPath, 'utf8').trim();
            if (t) return t;
        }
    } catch (e) {
        console.warn('[Bilibili] 读取总结 system 提示词失败:', e.message);
    }
    return '你是中文助手。请根据用户给出的视频标题、简介与转录文本，输出准确、结构化的简明总结，不要臆造视频中不存在的内容。';
}

// --- 视频详情 ---

async function fetchVideoInfoRaw(bvid) {
    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return { success: false, error: `无效的BV号格式 "${bvid}"` };
    }
    const credential = getCredential();
    try {
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
                    return { success: false, error: errMsg };
                }
                videoInfo = videoResponse.data.data;
                break;
            } catch (err) {
                if (attempt === 3) throw err;
                console.warn(`[Bilibili] 获取视频信息失败 (尝试 ${attempt}/3)，重试中...`);
                await sleep(1000);
            }
        }
        return { success: true, data: videoInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function getVideoDetails(parameters) {
    const { bvid } = parameters;
    const credential = getCredential();

    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return `获取视频详情失败：无效的BV号格式 "${bvid}"`;
    }

    try {
        console.log(`[Bilibili] 获取视频 ${bvid} 的详细信息...`);
        let videoInfo;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const videoResponse = await axios.get(BILI_API.VIDEO_INFO, {
                    params: { bvid },
                    headers: getHeaders(credential),
                    timeout: 10000
                });
                if (videoResponse.data.code !== 0) {
                    return `获取视频详情失败：${parseErrorMessage(videoResponse.data.code, videoResponse.data.message)}`;
                }
                videoInfo = videoResponse.data.data;
                console.log(`[Bilibili] 视频标题: ${videoInfo.title}`);
                break;
            } catch (err) {
                if (attempt === 3) throw err;
                console.warn(`[Bilibili] 获取视频信息失败 (尝试 ${attempt}/3)，重试中...`);
                await sleep(1000);
            }
        }

        let commentsSummary = "暂无热门评论。";
        const commentsPromise = (async () => {
            try {
                await sleep(getRandomDelay(100, 300));
                const commentsResponse = await axios.get(BILI_API.COMMENT_LIST, {
                    params: { type: 1, oid: videoInfo.aid, sort: 2, ps: 10 },
                    headers: getHeaders(credential),
                    timeout: 10000
                });
                if (commentsResponse.data.code === 0 && commentsResponse.data.data?.replies) {
                    const topComments = commentsResponse.data.data.replies.slice(0, 5);
                    if (topComments.length > 0) {
                        return topComments.map((c, idx) => {
                            const content = c.content?.message || '';
                            const likes = c.like || 0;
                            const username = c.member?.uname || '匿名';
                            return `${idx + 1}. ${username}: ${content} [👍${likes}]`;
                        }).join('\n');
                    }
                }
            } catch (commErr) {
                console.error("[Bilibili] 获取评论失败:", commErr.message);
                return "获取评论失败。";
            }
            return "暂无热门评论。";
        })();

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
                const danmakuMatches = danmakuText.match(/<d[^>]*>([^<]+)<\/d>/g) || [];
                if (danmakuMatches.length > 0) {
                    const danmakuList = danmakuMatches.slice(0, 30)
                        .map(d => { const match = d.match(/<d[^>]*>([^<]+)<\/d>/); return match ? match[1].trim() : ''; })
                        .filter(d => d.length > 0);
                    return danmakuList.slice(0, 20).join(' | ');
                }
            } catch (dmErr) {
                console.error("[Bilibili] 获取弹幕失败:", dmErr.message);
                return "获取弹幕失败。";
            }
            return "暂无弹幕。";
        })();

        [commentsSummary, danmakuSample] = await Promise.all([commentsPromise, danmakuPromise]);

        const result = {
            bvid: videoInfo.bvid, aid: videoInfo.aid, cid: videoInfo.cid,
            title: videoInfo.title,
            description: videoInfo.desc || "无简介",
            author: { name: videoInfo.owner?.name || "未知UP主", mid: videoInfo.owner?.mid || 0, face: videoInfo.owner?.face || "" },
            duration: videoInfo.duration,
            duration_formatted: formatDuration(videoInfo.duration),
            pubdate: videoInfo.pubdate,
            pubdate_formatted: new Date(videoInfo.pubdate * 1000).toLocaleString('zh-CN'),
            pic: videoInfo.pic,
            stat: {
                view: videoInfo.stat?.view || 0, danmaku: videoInfo.stat?.danmaku || 0,
                reply: videoInfo.stat?.reply || 0, favorite: videoInfo.stat?.favorite || 0,
                coin: videoInfo.stat?.coin || 0, share: videoInfo.stat?.share || 0,
                like: videoInfo.stat?.like || 0
            },
            hot_comments_summary: commentsSummary,
            danmaku_sample: danmakuSample,
            url: `https://www.bilibili.com/video/${bvid}`
        };

        console.log("[Bilibili] 视频详情获取完成");
        return `视频《${result.title}》的详细信息如下：\n${JSON.stringify(result, null, 2)}`;
    } catch (error) {
        console.error("[Bilibili] 获取视频详情失败:", error);
        if (error.response?.data?.code) {
            return `获取视频详情失败：${parseErrorMessage(error.response.data.code, error.response.data.message)}`;
        }
        return `获取视频详情失败 (BV号: ${bvid}): ${error.message}`;
    }
}

// --- 字幕提取（与 AstrBot BiliRead 相同：bilibili-api-python 子进程） ---

function fetchSubtitlesViaBilibiliApiPython(bvid, pythonExecutable, cid = 0) {
    const scriptPath = path.join(PLUGIN_DIR, 'subtitle_fetch_biliapi.py');
    if (!pythonExecutable || !fs.existsSync(pythonExecutable)) {
        return Promise.resolve({
            success: false,
            error: '未配置 python_executable 或解释器路径无效，无法使用 bilibili-api-python 获取字幕（请安装: pip install -r requirements.txt）'
        });
    }
    if (!fs.existsSync(scriptPath)) {
        return Promise.resolve({ success: false, error: '未找到 subtitle_fetch_biliapi.py' });
    }
    const args = [scriptPath, bvid];
    if (cid > 0) args.push(String(cid));

    return new Promise((resolve) => {
        execFile(pythonExecutable, args, {
            timeout: 90000,
            encoding: 'utf8',
            cwd: PLUGIN_DIR,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
        }, (error, stdout, stderr) => {
            if (stderr) {
                stderr.trim().split('\n').forEach(line => {
                    if (line.trim()) console.log(`[Bilibili] ${line.trim()}`);
                });
            }
            if (error) {
                resolve({ success: false, error: `bilibili-api-python 字幕脚本失败: ${error.message}` });
                return;
            }
            try {
                const result = JSON.parse(stdout.trim());
                if (result.success) {
                    resolve({
                        success: true,
                        text: result.text,
                        lang: result.lang || 'unknown',
                        isAiGenerated: result.is_ai === true
                    });
                } else {
                    resolve({ success: false, error: result.error || '未知错误' });
                }
            } catch (e) {
                resolve({ success: false, error: '解析字幕脚本输出失败' });
            }
        });
    });
}

/**
 * 字幕仅通过 bilibili-api-python（与 https://github.com/SodaCodeSave/astrbot_plugin_biliread 一致），由子进程执行 subtitle_fetch_biliapi.py。
 */
async function fetchSubtitles(bvid, cid = 0, videoDuration = 0, aid = 0, pythonExecutable = '') {
    void videoDuration;
    void aid;
    console.log(`[Bilibili] 使用 bilibili-api-python 获取视频 ${bvid} 的字幕（BiliRead 同款方案）...`);
    const apiResult = await fetchSubtitlesViaBilibiliApiPython(bvid, pythonExecutable, cid);
    if (apiResult.success) {
        console.log(`[Bilibili] 字幕获取成功: ${apiResult.isAiGenerated ? 'AI生成' : '人工/CC'}, 语言: ${apiResult.lang}, ${apiResult.text.length}字`);
    } else {
        console.log(`[Bilibili] 未获取到字幕: ${apiResult.error}`);
    }
    return apiResult;
}

// --- Whisper 语音转录 ---

async function transcribeVideo(parameters, pythonExecutable, defaultModel = 'medium') {
    const { bvid, model_size = defaultModel, max_duration } = parameters;

    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) {
        return `转录失败：无效的BV号格式 "${bvid}"。`;
    }

    try {
        const checkResponse = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
            timeout: 5000,
            headers: { 'User-Agent': USER_AGENT }
        });
        if (checkResponse.data.code !== 0) {
            return `转录失败：BV号 "${bvid}" 对应的视频不存在或无法访问。`;
        }
    } catch (checkError) {
        return `转录失败：无法验证BV号 "${bvid}" 的有效性。`;
    }

    if (!pythonExecutable) {
        return '转录失败：未配置 Python 解释器路径。请在插件配置中设置 python_executable。';
    }

    const scriptPath = path.join(PLUGIN_DIR, 'video_transcriber.py');
    if (!fs.existsSync(pythonExecutable)) {
        return `转录失败：未在指定路径找到Python解释器: ${pythonExecutable}。`;
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

// --- AI 总结 ---

async function callSummaryAPI(transcriptText, videoTitle = '', videoDesc = '', summaryConfig = {}, maxRetries = 3) {
    const apiUrl = summaryConfig.api_url || '';
    const apiKey = summaryConfig.api_key || '';
    const model = summaryConfig.model || 'deepseek-ai/DeepSeek-V3.2';
    const maxTokens = summaryConfig.max_tokens || 8000;
    const temperature = summaryConfig.temperature || 0.5;

    if (!apiUrl || !apiKey) {
        console.warn("[Bilibili] 总结 API 未配置，跳过 AI 总结");
        return { success: false, error: '总结 API 未配置' };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Bilibili] 调用下级智能体进行总结，第 ${attempt}/${maxRetries} 次尝试...`);

            let userPrompt = '';
            if (videoTitle) userPrompt += `视频标题：${videoTitle}\n`;
            if (videoDesc && videoDesc !== '无简介') userPrompt += `视频简介：${videoDesc}\n`;
            userPrompt += `\n请紧密围绕上述视频标题和简介的主题，详细总结以下视频转录内容。如果转录文本中存在与视频标题明显无关的片段（可能是识别错误），请忽略这些无关内容，聚焦于与标题相关的核心信息：\n\n${transcriptText}`;

            const response = await axios.post(apiUrl, {
                model: model,
                messages: [
                    { role: "system", content: loadSummarySystemPrompt() },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: maxTokens,
                temperature: temperature
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 180000
            });

            if (response.data?.choices?.[0]?.message?.content) {
                console.log('[Bilibili] 下级智能体总结成功');
                return { success: true, content: response.data.choices[0].message.content };
            }
            throw new Error('API 响应格式异常');
        } catch (error) {
            console.error(`[Bilibili] 第 ${attempt} 次尝试失败:`, error.message);
            if (attempt < maxRetries) {
                const waitTime = attempt * 5000;
                console.log(`[Bilibili] 等待 ${waitTime/1000} 秒后重试...`);
                await sleep(waitTime);
            }
        }
    }
    console.error('[Bilibili] 下级智能体总结失败，已达最大重试次数');
    return { success: false, error: '总结 API 调用失败，已达最大重试次数' };
}

// --- 综合信息入口 ---

async function getComprehensiveInfo(parameters, pluginConfig = {}) {
    const { bvid, model_size } = parameters;
    const credential = getCredential();
    const pythonExecutable = pluginConfig.python_executable || '';
    const defaultModel = pluginConfig.whisper_model || 'medium';
    const summaryConfig = pluginConfig.summary || {};
    const useSummary = summaryConfig.use_summary !== false;

    try {
        const videoInfoResult = await fetchVideoInfoRaw(bvid);
        if (!videoInfoResult.success) {
            return `获取综合信息失败，因为无法获取视频详情: ${videoInfoResult.error}`;
        }
        const videoInfo = videoInfoResult.data;
        console.log(`[Bilibili] 视频标题: ${videoInfo.title}`);

        const pages = videoInfo.pages || [];
        if (pages.length > 1) {
            console.log(`[Bilibili] 多P视频，共 ${pages.length} 个分P，当前使用第一P (cid: ${videoInfo.cid})`);
        }

        const firstPageDur = (pages.length > 1 && pages[0]?.duration) ? pages[0].duration : (videoInfo.duration || 0);
        console.log("[Bilibili] [策略] 并行获取字幕(bilibili-api-python) + 评论 + 弹幕...");
        const subtitlePromise = fetchSubtitles(bvid, videoInfo.cid, firstPageDur, videoInfo.aid, pythonExecutable);

        const commentsPromise = (async () => {
            try {
                await sleep(getRandomDelay(500, 1000));
                const commentsResponse = await axios.get(BILI_API.COMMENT_LIST, {
                    params: { type: 1, oid: videoInfo.aid, sort: 2, ps: 10 },
                    headers: getHeaders(credential),
                    timeout: 10000
                });
                if (commentsResponse.data.code === 0 && commentsResponse.data.data?.replies) {
                    const topComments = commentsResponse.data.data.replies.slice(0, 5);
                    if (topComments.length > 0) {
                        return topComments.map((c, idx) => {
                            const content = c.content?.message || '';
                            const likes = c.like || 0;
                            const username = c.member?.uname || '匿名';
                            return `${idx + 1}. ${username}: ${content} [👍${likes}]`;
                        }).join('\n');
                    }
                }
            } catch (commErr) {
                console.error("[Bilibili] 获取评论失败:", commErr.message);
                return "获取评论失败。";
            }
            return "暂无热门评论。";
        })();

        const danmakuPromise = (async () => {
            try {
                await sleep(getRandomDelay(500, 1000));
                const danmakuResponse = await axios.get(BILI_API.DANMAKU_LIST, {
                    params: { oid: videoInfo.cid },
                    headers: getHeaders(credential),
                    timeout: 10000,
                    responseType: 'text'
                });
                const danmakuText = danmakuResponse.data;
                const danmakuMatches = danmakuText.match(/<d[^>]*>([^<]+)<\/d>/g) || [];
                if (danmakuMatches.length > 0) {
                    const danmakuList = danmakuMatches.slice(0, 30)
                        .map(d => { const match = d.match(/<d[^>]*>([^<]+)<\/d>/); return match ? match[1].trim() : ''; })
                        .filter(d => d.length > 0);
                    return danmakuList.slice(0, 20).join(' | ');
                }
            } catch (dmErr) {
                console.error("[Bilibili] 获取弹幕失败:", dmErr.message);
                return "获取弹幕失败。";
            }
            return "暂无弹幕。";
        })();

        const [subtitleResult, commentsSummary, danmakuSample] = await Promise.all([
            subtitlePromise, commentsPromise, danmakuPromise
        ]);

        const detailsObject = {
            bvid: videoInfo.bvid, aid: videoInfo.aid, cid: videoInfo.cid,
            title: videoInfo.title,
            description: videoInfo.desc || "无简介",
            hot_comments_summary: commentsSummary,
            danmaku_sample: danmakuSample
        };

        let contentText = '';
        let contentSource = '';

        if (subtitleResult.success && subtitleResult.text && subtitleResult.text.trim().length > 0) {
            contentText = subtitleResult.text.trim();
            const aiTag = subtitleResult.isAiGenerated ? ', AI自动生成' : ', 人工上传';
            contentSource = `CC字幕 (${subtitleResult.lang}${aiTag})`;
            console.log(`[Bilibili] CC 字幕获取成功，来源: ${contentSource}，长度: ${contentText.length}`);

            if (subtitleResult.isAiGenerated && firstPageDur > 60) {
                const expectedMinChars = firstPageDur * 2;
                if (contentText.length < expectedMinChars * 0.3) {
                    console.warn(`[Bilibili] AI字幕文本过短（${contentText.length}字，视频${firstPageDur}秒），降级使用 Whisper`);
                    contentText = '';
                    contentSource = '';
                }
            }
        }

        if (!contentText) {
            console.log(`[Bilibili] [策略] CC 字幕不可用（${subtitleResult.error}），降级使用 Whisper 语音转录...`);
            const transcriptResult = await transcribeVideo({ bvid, model_size: model_size || defaultModel }, pythonExecutable, defaultModel);
            if (transcriptResult.includes("失败")) {
                return `获取综合信息失败：CC 字幕不可用（${subtitleResult.error}），语音转录也失败: ${transcriptResult}`;
            }
            contentText = (transcriptResult.split('语音内容转录如下：\n')[1] || '').trim();
            contentSource = `Whisper语音转录 (${model_size || defaultModel})`;
            console.log(`[Bilibili] 语音转录完成，来源: ${contentSource}，长度: ${contentText.length}`);
        }

        let contentOutput;
        if (!contentText) {
            console.warn("[Bilibili] 内容为空，跳过AI总结");
            contentOutput = "内容为空，无法生成总结。该视频可能是纯音乐或没有语音/字幕内容。";
        } else if (useSummary) {
            console.log("[Bilibili] 正在调用下级智能体进行内容总结...");
            const summaryResult = await callSummaryAPI(contentText, detailsObject.title, detailsObject.description, summaryConfig);
            if (summaryResult.success) {
                contentOutput = summaryResult.content;
            } else {
                console.warn("[Bilibili] 总结失败，降级返回原始内容");
                contentOutput = `【注意：AI总结失败，以下为原始内容】\n\n${contentText}`;
            }
        } else {
            contentOutput = contentText;
        }

        let formattedOutput = `视频标题：${detailsObject.title}\n`;
        formattedOutput += `简介：${detailsObject.description}\n`;
        formattedOutput += `热门评论：\n${detailsObject.hot_comments_summary}\n`;
        formattedOutput += `弹幕示例：${detailsObject.danmaku_sample}\n\n`;
        formattedOutput += `【视频内容总结】（内容来源: ${contentSource}）\n`;

        if (contentSource.includes('AI自动生成')) {
            formattedOutput += `⚠️ 注意：本字幕由B站AI自动识别生成，可能存在识别错误，总结内容仅供参考。\n\n`;
        }

        formattedOutput += contentOutput;

        if (pages.length > 1) {
            formattedOutput += `\n\n⚠️ 提示：该视频共有 ${pages.length} 个分P，以上总结仅基于第1P「${pages[0]?.part || '未知'}」的内容。`;
        }

        return formattedOutput;
    } catch (error) {
        console.error("[Bilibili] 获取综合信息时发生严重错误:", error);
        return `处理视频(BV: ${bvid})的综合信息时发生未知错误: ${error.message}`;
    }
}

module.exports = {
    fetchVideoInfoRaw,
    getVideoDetails,
    fetchSubtitles,
    transcribeVideo,
    callSummaryAPI,
    getComprehensiveInfo
};
