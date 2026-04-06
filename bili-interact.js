/**
 * bili-interact.js - B站评论、弹幕、互动功能（点赞/投币/收藏/三连）
 */

const axios = require('axios');

const {
    BILI_API,
    getCredential, getHeaders,
    sleep, getRandomDelay, formatDuration, parseErrorMessage,
    simulateBrowsing, encWbi
} = require('./bili-api.js');
const { isCredentialValid } = require('./bili-credential.js');

// --- 评论验证 ---

async function verifyCommentSuccess(bvid, aid, commentText, maxRetries = 2) {
    const credential = getCredential();
    console.log(`[Bilibili] 验证评论是否可见...`);
    await sleep(getRandomDelay(3000, 5000));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Bilibili] 验证尝试 ${attempt}/${maxRetries}...`);
            const response = await axios.get(BILI_API.COMMENT_LIST, {
                params: { type: 1, oid: aid, sort: 0, ps: 20, pn: 1 },
                headers: getHeaders(credential),
                timeout: 10000
            });
            if (response.data.code !== 0) {
                console.warn(`[Bilibili] 获取评论列表失败: ${parseErrorMessage(response.data.code, response.data.message)}`);
                if (attempt < maxRetries) { await sleep(2000); continue; }
                return { success: false, message: '无法验证评论（获取评论列表失败）' };
            }
            const replies = response.data.data?.replies || [];
            const myComment = replies.find(reply =>
                reply.content?.message === commentText.trim() &&
                reply.mid?.toString() === credential.DedeUserID?.toString()
            );
            if (myComment) {
                console.log(`[Bilibili] 评论验证成功：评论已可见！`);
                return { success: true, message: '评论已确认可见' };
            }
            if (attempt < maxRetries) {
                console.log(`[Bilibili] 未找到评论，等待后重试...`);
                await sleep(3000);
            }
        } catch (error) {
            console.error(`[Bilibili] 验证评论时出错 (尝试 ${attempt}/${maxRetries}):`, error.message);
            if (attempt < maxRetries) await sleep(2000);
        }
    }
    console.warn(`[Bilibili] 评论验证失败：在评论列表中未找到该评论`);
    return { success: false, message: '评论可能只有自己可见（影子评论）' };
}

// --- 发送评论 ---

async function doSendComment(parameters, antiRiskConfig = {}) {
    const valid = await isCredentialValid();
    if (!valid) {
        return "发送评论失败：B站身份凭证无效或已过期，且自动刷新失败。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
    }
    const credential = getCredential();
    if (!credential || !credential.bili_jct) {
        return "发送评论失败：CSRF Token (bili_jct) 缺失。\n\n请使用 `login_bilibili_by_qrcode` 工具重新登录以获取新的凭证。";
    }

    const { bvid, comment_text } = parameters;
    const simulate_human = antiRiskConfig.simulate_human !== false;

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
        console.log(`[Bilibili] 准备发送评论到视频 ${bvid}...`);
        if (simulate_human) {
            await simulateBrowsing(bvid, credential);
            await sleep(getRandomDelay(2000, 4000));
        }

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
                console.log(`[Bilibili] 目标视频: ${videoInfo.title}`);
                break;
            } catch (err) {
                if (attempt === 2) throw err;
                await sleep(1000);
            }
        }

        // 上报观看历史
        try {
            const reportData = new URLSearchParams({
                aid: videoInfo.aid.toString(), cid: videoInfo.cid.toString(), bvid: bvid,
                part: '1', mid: credential.DedeUserID, csrf: credential.bili_jct,
                played_time: '0', realtime: '0', start_ts: Math.floor(Date.now() / 1000).toString(),
                type: '3', dt: '2', play_type: '0'
            });
            const reportResponse = await axios.post(BILI_API.HISTORY_REPORT, reportData.toString(), {
                headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000
            });
            if (reportResponse.data.code === 0) console.log(`[Bilibili] 观看历史上报成功`);
        } catch (reportErr) {
            console.warn(`[Bilibili] 观看历史上报异常:`, reportErr.message);
        }

        // 模拟观看 + 心跳
        const watchTime = simulate_human ? getRandomDelay(5000, 10000) : 3000;
        console.log(`[Bilibili] 模拟观看视频 ${Math.floor(watchTime/1000)} 秒...`);
        await sleep(watchTime);

        try {
            const heartbeatData = new URLSearchParams({
                aid: videoInfo.aid.toString(), cid: videoInfo.cid.toString(), bvid: bvid,
                mid: credential.DedeUserID, csrf: credential.bili_jct,
                played_time: Math.floor(watchTime / 1000).toString(),
                realtime: Math.floor(watchTime / 1000).toString(),
                start_ts: Math.floor(Date.now() / 1000).toString(),
                type: '3', dt: '2', play_type: '0'
            });
            await axios.post(BILI_API.VIDEO_HEARTBEAT, heartbeatData.toString(), {
                headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000
            });
        } catch (hbErr) {
            console.warn(`[Bilibili] 播放心跳异常:`, hbErr.message);
        }

        if (simulate_human) {
            const thinkingTime = Math.min(comment_text.length * 50, 3000);
            await sleep(getRandomDelay(thinkingTime, thinkingTime + 1000));
        }

        // 发送评论
        const commentData = new URLSearchParams({
            oid: videoInfo.aid.toString(), type: '1', message: comment_text.trim(),
            plat: '1', csrf: credential.bili_jct
        });

        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[Bilibili] 发送评论尝试 ${attempt}/3...`);
                if (attempt > 1) await sleep(getRandomDelay(3000, 5000));

                const response = await axios.post(BILI_API.COMMENT_ADD, commentData.toString(), {
                    headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                    timeout: 15000
                });

                if (response.data.code === 0) {
                    console.log("[Bilibili] 评论API返回成功，验证评论是否可见...");
                    const verifyResult = await verifyCommentSuccess(bvid, videoInfo.aid, comment_text);
                    if (verifyResult.success) {
                        return `✅ 评论发送成功并已确认可见！\n\n📝 评论内容: "${comment_text}"\n🎯 视频: ${videoInfo.title}\n✅ 验证状态: ${verifyResult.message}`;
                    } else {
                        return `⚠️ 评论已发送但验证失败（可能是影子评论）\n\n📝 评论内容: "${comment_text}"\n🎯 视频: ${videoInfo.title}\n❌ 验证状态: ${verifyResult.message}\n\n🔍 可能的原因：\n1. 账号等级不足或信用度低\n2. 触发了B站的反作弊机制\n3. 评论内容包含敏感词或链接\n4. 发送频率过高`;
                    }
                } else {
                    const code = response.data.code;
                    const errMsg = parseErrorMessage(code, response.data.message);
                    console.error(`[Bilibili] 评论发送失败: ${errMsg}`);

                    if (code === -101) return "发送评论失败：凭证已过期。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
                    if (code === -111) return "发送评论失败：CSRF Token 已过期。请使用 `login_bilibili_by_qrcode` 工具重新登录。";

                    if ([12002, 12003, 12015, 12016, 12025, 12035, 12051, 12052, -102, 61001].includes(code)) {
                        let advice = '';
                        if (code === 12015) advice = '\n\n💡 建议：B站要求验证码，请稍后在网页端手动发送评论。';
                        else if (code === 12016) advice = '\n\n💡 建议：请检查评论内容是否包含敏感词。';
                        else if (code === 12051) advice = '\n\n💡 建议：请等待后发送不同内容的评论。';
                        else if (code === 12035) advice = '\n\n💡 提示：您已被该视频的UP主列入评论黑名单。';
                        return `发送评论失败：${errMsg}${advice}`;
                    }

                    if (code === -509 && attempt < 3) {
                        await sleep(getRandomDelay(10000, 15000));
                    }
                    lastError = errMsg;
                }
            } catch (reqError) {
                console.error(`[Bilibili] 评论发送请求失败 (尝试 ${attempt}/3):`, reqError.message);
                lastError = reqError.message;
                if (reqError.response?.status === 412 && attempt < 3) {
                    await sleep(getRandomDelay(5000, 8000));
                } else if (attempt < 3) {
                    await sleep(getRandomDelay(2000, 3000));
                }
            }
        }
        return `发送评论失败（已重试3次）：${lastError}\n\n建议：\n1. 等待更长时间后重试\n2. 检查账号状态\n3. 降低发送频率`;
    } catch (error) {
        console.error("[Bilibili] 发送评论时发生严重错误:", error);
        return `发送评论时发生错误: ${error.message}`;
    }
}

// --- 发送弹幕 ---

async function doSendDanmaku(parameters) {
    const valid = await isCredentialValid();
    if (!valid) {
        return "发送弹幕失败：B站身份凭证无效或已过期。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
    }
    const credential = getCredential();
    const { bvid, danmaku_text, time = 0, color = '16777215', fontsize = '25', mode = '1' } = parameters;

    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) return `发送弹幕失败：无效的BV号格式 "${bvid}"`;
    if (!danmaku_text || danmaku_text.trim().length === 0) return "发送弹幕失败：弹幕内容不能为空";
    if (danmaku_text.length > 100) return "发送弹幕失败：弹幕内容过长（最多100字符）";
    if (time < 0) return "发送弹幕失败：时间参数不能为负数";

    try {
        console.log(`[Bilibili] 准备发送弹幕到视频 ${bvid}，时间点: ${time}秒...`);
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
                break;
            } catch (err) {
                if (attempt === 2) throw err;
                await sleep(1000);
            }
        }

        if (time > videoInfo.duration) {
            return `发送弹幕失败：指定时间(${time}秒)超过视频长度(${videoInfo.duration}秒，即${formatDuration(videoInfo.duration)})`;
        }
        await sleep(getRandomDelay(500, 1500));

        const danmakuData = new URLSearchParams({
            type: '1', oid: videoInfo.cid.toString(), msg: danmaku_text.trim(),
            aid: videoInfo.aid.toString(), bvid: bvid,
            progress: Math.round(time * 1000).toString(),
            color: color, fontsize: fontsize, pool: '0', mode: mode,
            rnd: (Date.now() * 1000).toString(), plat: '1', csrf: credential.bili_jct
        });

        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[Bilibili] 发送弹幕尝试 ${attempt}/3...`);
                if (attempt > 1) await sleep(getRandomDelay(2000, 4000));

                const wbiParams = await encWbi({ csrf: credential.bili_jct });
                const urlWithWbi = `${BILI_API.DANMAKU_POST}?csrf=${credential.bili_jct}&w_rid=${wbiParams.w_rid}&wts=${wbiParams.wts}`;

                const response = await axios.post(urlWithWbi, danmakuData.toString(), {
                    headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                    timeout: 15000
                });

                if (response.data.code === 0) {
                    console.log("[Bilibili] 弹幕发送成功！");
                    const modeText = mode === '1' ? '滚动' : mode === '4' ? '底部' : mode === '5' ? '顶部' : '未知';
                    return `✅ 弹幕发送成功！\n内容: "${danmaku_text}"\n时间: ${time}秒 (${formatDuration(time)})\n模式: ${modeText}`;
                } else {
                    const code = response.data.code;
                    const errMsg = parseErrorMessage(code, response.data.message);
                    if (code === -101) return "发送弹幕失败：凭证已过期。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
                    if ([36700, 36702, 61001].includes(code)) return `发送弹幕失败：${errMsg}`;
                    lastError = errMsg;
                }
            } catch (reqError) {
                console.error(`[Bilibili] 弹幕发送请求失败 (尝试 ${attempt}/3):`, reqError.message);
                lastError = reqError.message;
                if (reqError.response?.status === 412 && attempt < 3) {
                    await sleep(getRandomDelay(5000, 8000));
                } else if (attempt < 3) {
                    await sleep(getRandomDelay(2000, 3000));
                }
            }
        }
        return `发送弹幕失败（已重试3次）：${lastError}\n\n建议：\n1. 等待更长时间后重试\n2. 检查账号状态\n3. 降低发送频率`;
    } catch (error) {
        console.error("[Bilibili] 发送弹幕时发生严重错误:", error);
        return `发送弹幕时发生错误: ${error.message}`;
    }
}

// --- 点赞/投币/收藏/三连 ---

async function doLike(bvid, videoInfo, videoUrl) {
    const credential = getCredential();
    try {
        const likeData = new URLSearchParams({ bvid: bvid, like: '1', csrf: credential.bili_jct });
        const response = await axios.post(BILI_API.VIDEO_LIKE, likeData.toString(), {
            headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        if (response.data.code === 0) return `✅ 点赞成功！\n\n🎬 视频: ${videoInfo.title}\n👍 已为该视频点赞`;
        if (response.data.code === 65006) return `⚠️ 你已经点赞过这个视频了\n\n🎬 视频: ${videoInfo.title}`;
        return `点赞失败：${parseErrorMessage(response.data.code, response.data.message)}`;
    } catch (error) {
        return `点赞失败: ${error.message}`;
    }
}

async function doCoin(bvid, videoInfo, videoUrl, coinNum, likeWithCoin) {
    const credential = getCredential();
    try {
        const num = Math.min(Math.max(parseInt(coinNum) || 1, 1), 2);
        const coinData = new URLSearchParams({
            bvid: bvid, multiply: num.toString(),
            select_like: likeWithCoin ? '1' : '0', csrf: credential.bili_jct
        });
        const response = await axios.post(BILI_API.VIDEO_COIN, coinData.toString(), {
            headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        if (response.data.code === 0) {
            const likeText = likeWithCoin ? '（已同时点赞）' : '';
            return `✅ 投币成功！\n\n🎬 视频: ${videoInfo.title}\n🪙 已投${num}个硬币${likeText}`;
        }
        if (response.data.code === 34005) return `⚠️ 投币失败：超过投币上限\n\n🎬 视频: ${videoInfo.title}`;
        return `投币失败：${parseErrorMessage(response.data.code, response.data.message)}`;
    } catch (error) {
        return `投币失败: ${error.message}`;
    }
}

async function doFavorite(bvid, videoInfo, videoUrl) {
    const credential = getCredential();
    try {
        const folderResponse = await axios.get(BILI_API.FAV_FOLDER_LIST, {
            params: { up_mid: credential.DedeUserID, type: 2 },
            headers: getHeaders(credential, videoUrl),
            timeout: 10000
        });
        if (folderResponse.data.code !== 0 || !folderResponse.data.data?.list) {
            return `收藏失败：无法获取收藏夹列表 (${folderResponse.data.message || '未知错误'})`;
        }
        const defaultFolder = folderResponse.data.data.list[0];
        if (!defaultFolder) return `收藏失败：找不到可用的收藏夹`;

        const favoriteData = new URLSearchParams({
            rid: videoInfo.aid.toString(), type: '2',
            add_media_ids: defaultFolder.id.toString(), del_media_ids: '',
            csrf: credential.bili_jct
        });
        const response = await axios.post(BILI_API.VIDEO_FAVORITE, favoriteData.toString(), {
            headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        if (response.data.code === 0) return `✅ 收藏成功！\n\n🎬 视频: ${videoInfo.title}\n📁 已添加到收藏夹: ${defaultFolder.title}`;
        if (response.data.code === 11201) return `⚠️ 你已经收藏过这个视频了\n\n🎬 视频: ${videoInfo.title}`;
        return `收藏失败：${parseErrorMessage(response.data.code, response.data.message)}`;
    } catch (error) {
        return `收藏失败: ${error.message}`;
    }
}

async function doTriple(bvid, videoInfo, videoUrl) {
    const credential = getCredential();
    try {
        console.log(`[Bilibili] 正在执行一键三连...`);
        const tripleData = new URLSearchParams({ bvid: bvid, csrf: credential.bili_jct });
        const response = await axios.post(BILI_API.VIDEO_TRIPLE, tripleData.toString(), {
            headers: { ...getHeaders(credential, videoUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        if (response.data.code === 0) {
            const data = response.data.data;
            console.log("[Bilibili] 一键三连成功！");
            let resultText = `✅ 一键三连成功！\n\n🎬 视频: ${videoInfo.title}\n`;
            resultText += `👍 点赞: ${data.like ? '成功' : '已点赞'}\n`;
            resultText += `🪙 投币: ${data.coin ? '成功' : '已投满'}\n`;
            resultText += `⭐ 收藏: ${data.fav ? '成功' : '已收藏'}`;
            return resultText;
        } else {
            console.warn("[Bilibili] 一键三连API失败，尝试分别执行...");
            const results = [];
            try {
                const likeResult = await doLike(bvid, videoInfo, videoUrl);
                results.push(`👍 ${likeResult.includes('成功') || likeResult.includes('已经') ? '✓' : '✗'}`);
            } catch (e) { results.push('👍 ✗'); }
            await sleep(getRandomDelay(500, 1000));
            try {
                const coinResult = await doCoin(bvid, videoInfo, videoUrl, 2, false);
                results.push(`🪙 ${coinResult.includes('成功') || coinResult.includes('上限') ? '✓' : '✗'}`);
            } catch (e) { results.push('🪙 ✗'); }
            await sleep(getRandomDelay(500, 1000));
            try {
                const favResult = await doFavorite(bvid, videoInfo, videoUrl);
                results.push(`⭐ ${favResult.includes('成功') || favResult.includes('已经') ? '✓' : '✗'}`);
            } catch (e) { results.push('⭐ ✗'); }
            return `一键三连结果（分步执行）\n\n🎬 视频: ${videoInfo.title}\n${results.join('\n')}`;
        }
    } catch (error) {
        console.error("[Bilibili] 一键三连失败:", error);
        return `一键三连失败: ${error.message}`;
    }
}

// --- 互动入口 ---

async function doInteract(parameters) {
    const valid = await isCredentialValid();
    if (!valid) {
        return "互动失败：B站身份凭证无效或已过期。请使用 `login_bilibili_by_qrcode` 工具重新登录。";
    }
    const credential = getCredential();
    const { bvid, action, coin_num = 1, like_with_coin = true } = parameters;

    if (!bvid || !bvid.startsWith('BV') || bvid.length < 12) return `互动失败：无效的BV号格式 "${bvid}"`;
    const validActions = ['like', 'coin', 'favorite', 'triple'];
    if (!validActions.includes(action)) return `互动失败：无效的操作类型 "${action}"，有效值为：like, coin, favorite, triple`;

    try {
        console.log(`[Bilibili] 准备对视频 ${bvid} 执行 ${action} 操作...`);
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
        await sleep(getRandomDelay(500, 1500));

        switch (action) {
            case 'like': return await doLike(bvid, videoInfo, videoUrl);
            case 'coin': return await doCoin(bvid, videoInfo, videoUrl, coin_num, like_with_coin);
            case 'favorite': return await doFavorite(bvid, videoInfo, videoUrl);
            case 'triple': return await doTriple(bvid, videoInfo, videoUrl);
            default: return `互动失败：不支持的操作类型 "${action}"`;
        }
    } catch (error) {
        console.error("[Bilibili] 视频互动时发生错误:", error);
        return `互动失败: ${error.message}`;
    }
}

module.exports = {
    doSendComment,
    doSendDanmaku,
    doInteract
};
