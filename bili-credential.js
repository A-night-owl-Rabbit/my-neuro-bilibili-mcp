/**
 * bili-credential.js - B站凭证管理
 * 包含：凭证加载/保存、凭证验证、QR码登录、Cookie状态检查
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { exec } = require('child_process');

const {
    BILI_API, getCredential, setCredential,
    getHeaders, sleep, getRandomDelay, parseErrorMessage,
    fetchBuvid, getBiliTicket
} = require('./bili-api.js');

const PLUGIN_DIR = __dirname;

function getConfigPath() {
    return path.join(PLUGIN_DIR, 'bili_config.json');
}

/** @returns {Promise<{ nav: 'ok', data: object }|{ nav: 'guest'|'other_response'|'network_error' }>} */
async function probeNavSession(credential) {
    try {
        const response = await axios.get(BILI_API.NAV, {
            headers: getHeaders(credential),
            timeout: 10000
        });
        if (response.data.code === 0) return { nav: 'ok', data: response.data.data };
        if (response.data.code === -101) return { nav: 'guest' };
        return { nav: 'other_response' };
    } catch (error) {
        console.error('[Bilibili] NAV 校验请求失败:', error.message);
        return { nav: 'network_error' };
    }
}

/** @returns {'logged_in'|'definitely_logged_out'|'ambiguous'|'inconclusive'} */
async function probeCookieLoginState(credential) {
    try {
        const infoResponse = await axios.get(BILI_API.COOKIE_INFO, {
            params: { csrf: credential.bili_jct },
            headers: getHeaders(credential),
            timeout: 10000
        });
        if (infoResponse.data.code === -101) return 'definitely_logged_out';
        if (infoResponse.data.code === 0) {
            const needRefresh = infoResponse.data.data?.refresh;
            if (needRefresh) {
                console.warn('[Bilibili] Cookie 需要刷新，建议重新登录');
            }
            return 'logged_in';
        }
        return 'ambiguous';
    } catch (error) {
        console.error('[Bilibili] 检查Cookie状态时发生错误:', error.message);
        if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
            console.warn('[Bilibili] 网络错误，无法确认 Cookie 状态');
        }
        return 'inconclusive';
    }
}

/**
 * 加载本地凭证并尽量校验。仅在服务端明确返回未登录时判定为「已失效」；
 * 网络异常或无法判定时保留本地凭证（outcome: limited），不在日志中宣称已失效。
 * @returns {Promise<{ outcome: 'ready'|'limited'|'missing_config'|'dead'|'load_error', error?: string }>}
 */
async function loadCredential() {
    try {
        const configPath = getConfigPath();
        if (!fs.existsSync(configPath)) {
            console.warn('[Bilibili] 未找到 bili_config.json 文件，发送功能未启用。');
            return { outcome: 'missing_config' };
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (!(config.SESSDATA && config.bili_jct && config.DedeUserID)) {
            console.warn('[Bilibili] bili_config.json 文件不完整，发送功能未启用。');
            return { outcome: 'missing_config' };
        }

        const cred = {
            SESSDATA: config.SESSDATA,
            bili_jct: config.bili_jct,
            DedeUserID: config.DedeUserID,
            refresh_token: config.refresh_token,
            buvid3: config.buvid3,
            buvid4: config.buvid4,
            b_nut: config.b_nut
        };

        if (!config.buvid3 || !config.buvid4) {
            console.log('[Bilibili] 检测到缺少 buvid，正在获取...');
            const buvidInfo = await fetchBuvid();
            cred.buvid3 = buvidInfo.buvid3;
            cred.buvid4 = buvidInfo.buvid4;
            cred.b_nut = buvidInfo.b_nut;
            config.buvid3 = buvidInfo.buvid3;
            config.buvid4 = buvidInfo.buvid4;
            config.b_nut = buvidInfo.b_nut;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
            console.log('[Bilibili] 已保存 buvid3/buvid4/b_nut');
        }

        setCredential(cred);
        console.log('[Bilibili] B站身份凭证已从本地加载。');

        const navResult = await probeNavSession(cred);
        if (navResult.nav === 'ok') {
            const userData = navResult.data;
            console.log(`[Bilibili] 凭证有效，用户: ${userData.uname || '未知'}，发送功能已启用。`);
            getBiliTicket(cred.bili_jct).catch(err => {
                console.warn('[Bilibili] bili_ticket 获取失败，继续运行:', err.message);
            });
            return { outcome: 'ready' };
        }

        if (navResult.nav === 'guest') {
            console.log('[Bilibili] NAV 为未登录态，正在通过 Cookie 接口确认是否仍有效...');
            const cookie = await probeCookieLoginState(cred);
            if (cookie === 'logged_in') {
                console.log('[Bilibili] Cookie 接口仍有效，发送功能已启用。');
                getBiliTicket(cred.bili_jct).catch(err => {
                    console.warn('[Bilibili] bili_ticket 获取失败，继续运行:', err.message);
                });
                return { outcome: 'ready' };
            }
            if (cookie === 'definitely_logged_out') {
                console.error('[Bilibili] 服务端确认未登录，已清除本地凭证。');
                setCredential(null);
                return { outcome: 'dead' };
            }
            console.warn('[Bilibili] 启动时无法确认登录状态（网络或接口未明确），已保留本地凭证。');
            return { outcome: 'limited' };
        }

        console.warn('[Bilibili] 启动时未能完成 NAV 校验（网络或异常响应），已保留本地凭证，不视为已失效。');
        return { outcome: 'limited' };
    } catch (e) {
        console.error('[Bilibili] 加载凭证失败:', e);
        return { outcome: 'load_error', error: e.message };
    }
}

async function isCredentialValid() {
    const credential = getCredential();
    if (!credential) {
        console.log("[Bilibili] 凭证不存在");
        return false;
    }
    try {
        const response = await axios.get(BILI_API.NAV, {
            headers: getHeaders(credential),
            timeout: 10000
        });
        if (response.data.code === 0) {
            const userData = response.data.data;
            console.log(`[Bilibili] 凭证有效，用户: ${userData.uname || '未知'}`);
            return true;
        }
        if (response.data.code === -101) {
            console.log("[Bilibili] 凭证可能已过期，检查状态...");
            const stillValid = await refreshCookie();
            return stillValid;
        }
        console.log(`[Bilibili] 凭证验证失败，返回码: ${response.data.code}（不据此认定已失效，仍允许尝试请求）`);
        return true;
    } catch (error) {
        console.error('[Bilibili] 验证凭证时网络错误:', error.message);
        return true;
    }
}

async function loginByQRCode() {
    try {
        console.log("[Bilibili] 开始二维码登录流程...");
        const genResponse = await axios.get(BILI_API.QR_GENERATE, {
            headers: getHeaders(),
            timeout: 10000
        });
        if (genResponse.data.code !== 0) {
            return `获取登录二维码失败: ${parseErrorMessage(genResponse.data.code, genResponse.data.message)}`;
        }
        const { url, qrcode_key } = genResponse.data.data;
        console.log("[Bilibili] 二维码 URL:", url);

        const qrCodePath = path.join(PLUGIN_DIR, 'bilibili_qrcode.png');
        await qrcode.toFile(qrCodePath, url, {
            width: 300,
            margin: 2,
            errorCorrectionLevel: 'M'
        });

        console.log("[Bilibili] 正在尝试打开二维码图片...");
        try {
            let openCommand;
            if (process.platform === 'win32') {
                openCommand = `start "" "${qrCodePath}"`;
            } else if (process.platform === 'darwin') {
                openCommand = `open "${qrCodePath}"`;
            } else {
                openCommand = `xdg-open "${qrCodePath}"`;
            }
            exec(openCommand, (error) => {
                if (error) {
                    console.warn("[Bilibili] 自动打开图片失败:", error.message);
                    console.log("[Bilibili] 请手动打开二维码图片:", qrCodePath);
                } else {
                    console.log("[Bilibili] 二维码图片已自动打开");
                }
            });
        } catch (openError) {
            console.warn("[Bilibili] 打开图片时出错:", openError.message);
        }

        console.log("[Bilibili] 二维码已生成，请在 180 秒内使用 Bilibili 手机客户端扫描登录。");

        const pollEndTime = Date.now() + 180000;
        let lastStatus = '';

        return new Promise((resolve) => {
            const pollInterval = setInterval(async () => {
                if (Date.now() > pollEndTime) {
                    clearInterval(pollInterval);
                    try { if (fs.existsSync(qrCodePath)) fs.unlinkSync(qrCodePath); } catch (e) { /* ignore */ }
                    resolve("登录失败：二维码已超时（180秒），请重新尝试登录。");
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

                    if (statusCode === 86101 && lastStatus !== '86101') {
                        console.log("[Bilibili] 等待用户扫描二维码...");
                        lastStatus = '86101';
                    } else if (statusCode === 86090 && lastStatus !== '86090') {
                        console.log("[Bilibili] 已扫描，等待用户在手机上确认登录...");
                        lastStatus = '86090';
                    }

                    switch (statusCode) {
                        case 0: {
                            clearInterval(pollInterval);
                            try { if (fs.existsSync(qrCodePath)) fs.unlinkSync(qrCodePath); } catch (e) { /* ignore */ }

                            let cookieUrl = pollData.url;
                            cookieUrl = cookieUrl.replace(/\\u0026/g, '&');
                            const urlParams = new URLSearchParams(cookieUrl.substring(cookieUrl.indexOf('?') + 1));
                            const sessdata = urlParams.get('SESSDATA');
                            const biliJct = urlParams.get('bili_jct');
                            const dedeUserID = urlParams.get('DedeUserID');

                            if (!sessdata || !biliJct || !dedeUserID) {
                                console.error("[Bilibili] 凭证解析失败，URL:", cookieUrl);
                                resolve("登录失败：无法从响应中解析凭证，请重试。");
                                break;
                            }

                            const buvidInfo = await fetchBuvid();
                            const newCred = {
                                SESSDATA: sessdata,
                                bili_jct: biliJct,
                                DedeUserID: dedeUserID,
                                refresh_token: pollData.refresh_token,
                                buvid3: buvidInfo.buvid3,
                                buvid4: buvidInfo.buvid4,
                                b_nut: buvidInfo.b_nut
                            };
                            setCredential(newCred);

                            const configPath = getConfigPath();
                            fs.writeFileSync(configPath, JSON.stringify(newCred, null, 2), 'utf-8');
                            console.log("[Bilibili] 登录成功！凭证已保存。");

                            getBiliTicket(newCred.bili_jct).catch(err => {
                                console.warn("[Bilibili] bili_ticket 获取失败:", err.message);
                            });

                            try {
                                const userInfo = await axios.get(BILI_API.NAV, {
                                    headers: getHeaders(newCred),
                                    timeout: 5000
                                });
                                if (userInfo.data.code === 0) {
                                    const uname = userInfo.data.data.uname;
                                    const level = userInfo.data.data.level_info?.current_level || 0;
                                    resolve(`✅ 登录成功！\n用户名: ${uname}\n等级: Lv${level}\n\n现在您可以使用发送评论和弹幕功能了！`);
                                } else {
                                    resolve("✅ 登录成功！现在您可以使用发送评论和弹幕功能了！");
                                }
                            } catch (e) {
                                resolve("✅ 登录成功！现在您可以使用发送评论和弹幕功能了！");
                            }
                            break;
                        }
                        case 86038:
                            clearInterval(pollInterval);
                            try { if (fs.existsSync(qrCodePath)) fs.unlinkSync(qrCodePath); } catch (e) { /* ignore */ }
                            resolve("登录失败：二维码已失效，请重新尝试登录。");
                            break;
                        case 86090:
                        case 86101:
                            break;
                        default:
                            console.warn(`[Bilibili] 未知状态码: ${statusCode}`);
                            break;
                    }
                } catch (pollError) {
                    console.error("[Bilibili] 轮询登录状态时网络错误:", pollError.message);
                }
            }, 2000);
        });
    } catch (error) {
        console.error("[Bilibili] 获取登录二维码失败:", error);
        return `获取登录二维码失败: ${error.message}`;
    }
}

async function refreshCookie() {
    const credential = getCredential();
    if (!credential) {
        console.error('[Bilibili] 无法检查Cookie：凭证不存在');
        return false;
    }
    console.log('[Bilibili] 正在检查Cookie状态...');
    const state = await probeCookieLoginState(credential);
    if (state === 'logged_in') {
        console.log('[Bilibili] Cookie 状态正常，无需刷新');
        return true;
    }
    if (state === 'definitely_logged_out') {
        console.error('[Bilibili] Cookie 已失效（账号未登录）');
        return false;
    }
    console.warn('[Bilibili] Cookie 状态未明确（网络或异常码），不视为已失效');
    return true;
}

module.exports = {
    loadCredential,
    isCredentialValid,
    loginByQRCode,
    refreshCookie
};
