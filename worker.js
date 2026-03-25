/**
 * Cloudflare Worker - 台元健身中心會員查詢代理
 * 
 * 部署：Cloudflare Worker → Edit code → 貼上 → Deploy
 */

const GYM_BASE = 'https://www.tyht-fitness.com.tw';
const LOGIN_URL = `${GYM_BASE}/booking/login`;
const CAPTCHA_URL = `${GYM_BASE}/booking/login/captcha`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function jsonResp(data, origin, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
}

function getRawSetCookies(response) {
    if (typeof response.headers.getSetCookie === 'function') {
        return response.headers.getSetCookie();
    }
    const raw = response.headers.get('set-cookie');
    return raw ? [raw] : [];
}

function buildCookieString(setCookieHeaders) {
    const cookies = [];
    for (const header of setCookieHeaders) {
        const nameValue = header.split(';')[0].trim();
        if (nameValue && nameValue.includes('=')) {
            cookies.push(nameValue);
        }
    }
    return cookies.join('; ');
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }
        try {
            if (url.pathname === '/captcha') return await handleCaptcha(origin);
            if (url.pathname === '/login' && request.method === 'POST') return await handleLogin(await request.json(), origin);
            if (url.pathname === '/test') return await handleTest();

            // === 買球記帳 API ===
            if (url.pathname === '/ball-purchases' && request.method === 'GET') return await getBallPurchases(env, origin);
            if (url.pathname === '/ball-purchases' && request.method === 'POST') return await addBallPurchase(env, await request.json(), origin);
            if (url.pathname.startsWith('/ball-purchases/') && request.method === 'DELETE') {
                const id = url.pathname.replace('/ball-purchases/', '');
                return await deleteBallPurchase(env, id, origin);
            }

            // === 打球頻率分級 API ===
            if (url.pathname === '/frequency-tiers' && request.method === 'GET') return await getFrequencyTiers(env, origin);
            if (url.pathname === '/frequency-tiers' && request.method === 'POST') return await saveFrequencyTiers(env, await request.json(), origin);

            // === 付款狀態 API ===
            if (url.pathname === '/payment-status' && request.method === 'GET') return await getPaymentStatus(env, origin);
            if (url.pathname === '/payment-status' && request.method === 'POST') return await savePaymentStatus(env, await request.json(), origin);

            // === 公帳紀錄 API ===
            if (url.pathname === '/public-account' && request.method === 'GET') return await getPublicAccount(env, origin);
            if (url.pathname === '/public-account' && request.method === 'POST') return await addPublicAccountRecord(env, await request.json(), origin);
            if (url.pathname.startsWith('/public-account/') && request.method === 'DELETE') {
                const id = url.pathname.replace('/public-account/', '');
                return await deletePublicAccountRecord(env, id, origin);
            }

            return jsonResp({ message: 'API ready', endpoints: ['GET /captcha', 'POST /login', 'GET /test', 'GET /ball-purchases', 'POST /ball-purchases', 'DELETE /ball-purchases/:id', 'GET /frequency-tiers', 'POST /frequency-tiers', 'GET /payment-status', 'POST /payment-status', 'GET /public-account', 'POST /public-account', 'DELETE /public-account/:id'] }, origin);
        } catch (error) {
            return jsonResp({ success: false, error: error.message, stack: error.stack }, origin, 500);
        }
    }
};

// === /test 診斷端點 ===
async function handleTest() {
    const log = [];
    log.push('=== 步驟 1：取得登入頁面 ===');
    const pageResp = await fetch(LOGIN_URL, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    const rawPageCookies = getRawSetCookies(pageResp);
    const pageCookieStr = buildCookieString(rawPageCookies);
    log.push(`狀態碼: ${pageResp.status}`);
    log.push(`Set-Cookie: ${rawPageCookies.length} 個`);
    rawPageCookies.forEach((c, i) => log.push(`  [${i}]: ${c}`));
    log.push(`Cookie 字串: ${pageCookieStr}`);

    log.push('\n=== 步驟 2：取得 CAPTCHA ===');
    const imgResp = await fetch(CAPTCHA_URL, {
        headers: { 'Cookie': pageCookieStr, 'Referer': LOGIN_URL, 'User-Agent': UA }
    });
    log.push(`狀態碼: ${imgResp.status}, Content-Type: ${imgResp.headers.get('content-type')}`);
    const imgBuf = await imgResp.arrayBuffer();
    log.push(`圖片大小: ${imgBuf.byteLength} bytes`);
    const captchaCookies = getRawSetCookies(imgResp);
    const allCookies = buildCookieString([...rawPageCookies, ...captchaCookies]);
    log.push(`最終 Cookie: ${allCookies}`);

    log.push('\n=== 步驟 3：模擬登入（假資料） ===');
    const formBody = new URLSearchParams();
    formBody.append('account', 'TEST');
    formBody.append('password', '12345678');
    formBody.append('code', 'XXXX');
    const loginResp = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': allCookies, 'Referer': LOGIN_URL, 'User-Agent': UA, 'Origin': GYM_BASE,
        },
        body: formBody.toString(),
        redirect: 'manual',
    });
    log.push(`狀態碼: ${loginResp.status}`);
    const loginHtml = await loginResp.text();
    log.push(`回應: ${loginHtml}`);

    // 測試 JS redirect 解析
    const jsRedirect = loginHtml.match(/location\.href\s*=\s*["']([^"']+)["']/);
    log.push(`JS 重導向 URL: ${jsRedirect ? jsRedirect[1] : '(無)'}`);
    const alertMsg = loginHtml.match(/alert\s*\(\s*["']([^"']+)["']\s*\)/);
    log.push(`Alert 訊息: ${alertMsg ? alertMsg[1] : '(無)'}`);

    return new Response(log.join('\n'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// === GET /captcha ===
async function handleCaptcha(origin) {
    const pageResp = await fetch(LOGIN_URL, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        redirect: 'follow',
    });
    const rawPageCookies = getRawSetCookies(pageResp);
    const pageCookieStr = buildCookieString(rawPageCookies);

    const imgResp = await fetch(CAPTCHA_URL, {
        headers: { 'Cookie': pageCookieStr, 'Referer': LOGIN_URL, 'User-Agent': UA }
    });
    const captchaCookies = getRawSetCookies(imgResp);
    const allCookies = buildCookieString([...rawPageCookies, ...captchaCookies]);

    const imgBuffer = await imgResp.arrayBuffer();
    const bytes = new Uint8Array(imgBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const captchaImage = `data:${imgResp.headers.get('content-type') || 'image/png'};base64,${btoa(binary)}`;
    const sessionId = btoa(allCookies);

    return jsonResp({ sessionId, captchaImage }, origin);
}

// === POST /login ===
async function handleLogin(body, origin) {
    const { sessionId, account, password, captcha } = body;
    if (!sessionId || !account || !password || !captcha) {
        return jsonResp({ success: false, error: '缺少必要欄位' }, origin);
    }

    let cookies;
    try { cookies = atob(sessionId); } catch {
        return jsonResp({ success: false, error: '驗證碼已過期，請重新載入' }, origin);
    }

    const formBody = new URLSearchParams();
    formBody.append('account', account);
    formBody.append('password', password);
    formBody.append('code', captcha);

    // POST 登入
    const loginResp = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookies,
            'Referer': LOGIN_URL,
            'User-Agent': UA,
            'Origin': GYM_BASE,
        },
        body: formBody.toString(),
        redirect: 'manual',
    });

    // 取得登入後的新 cookies
    const loginCookies = getRawSetCookies(loginResp);
    const oldCookies = cookies.split('; ').filter(c => c.includes('=')).map(c => c + '; path=/');
    const mergedCookies = buildCookieString([...oldCookies, ...loginCookies]);

    let responseHtml = '';

    // 處理 HTTP 302 重導向
    if (loginResp.status >= 300 && loginResp.status < 400) {
        const loc = loginResp.headers.get('location') || '';
        const redirectUrl = loc.startsWith('http') ? loc : GYM_BASE + loc;
        const rResp = await fetch(redirectUrl, {
            headers: { 'Cookie': mergedCookies, 'User-Agent': UA, 'Referer': LOGIN_URL },
        });
        responseHtml = await rResp.text();
    } else {
        responseHtml = await loginResp.text();
    }

    // ★ 重點修正：健身房用 JavaScript 重導向，不是 HTTP 302
    // 回應格式：<script>alert("...");location.href="..."</script>
    // 或成功：<script>location.href="..."</script>

    // 先檢查是否有 alert 錯誤訊息
    const alertMatch = responseHtml.match(/alert\s*\(\s*["']([^"']+)["']\s*\)/);
    if (alertMatch) {
        const alertMsg = alertMatch[1];
        // ★ 「登入成功」不是錯誤，繼續往下處理 JS 重導向
        if (!alertMsg.includes('成功')) {
            if (alertMsg.includes('驗證碼')) {
                return jsonResp({ success: false, error: '驗證碼輸入錯誤，請重新載入驗證碼' }, origin);
            }
            return jsonResp({ success: false, error: alertMsg }, origin);
        }
    }

    // 檢查是否有 JS 重導向（登入成功的情況）
    const jsRedirect = responseHtml.match(/location\.href\s*=\s*["']([^"']+)["']/);
    if (jsRedirect) {
        const redirectUrl = jsRedirect[1];
        // 跟隨 JS 重導向到會員頁面
        const memberResp = await fetch(redirectUrl, {
            headers: { 'Cookie': mergedCookies, 'User-Agent': UA, 'Referer': LOGIN_URL },
        });
        const memberHtml = await memberResp.text();

        // 從會員頁面解析到期日
        const expireMatch = memberHtml.match(/到期日[：:]\s*(\d{4}[-/]\d{2}[-/]\d{2})/);
        if (expireMatch) {
            const mn = memberHtml.match(/姓名[：:]\s*([^・\s<]+)/);
            const mi = memberHtml.match(/會員編號[：:]\s*([^・\s<]+)/);
            return jsonResp({
                success: true,
                expireDate: expireMatch[1],
                memberName: mn ? mn[1] : '',
                memberId: mi ? mi[1] : account,
            }, origin);
        }

        // 有重導向但找不到到期日
        return jsonResp({
            success: false,
            error: '登入似乎成功但無法找到到期日',
            debug: memberHtml.substring(0, 1500),
        }, origin);
    }

    // 直接在回應中找到期日（以防伺服器直接回傳會員頁面）
    const directExpire = responseHtml.match(/到期日[：:]\s*(\d{4}[-/]\d{2}[-/]\d{2})/);
    if (directExpire) {
        const mn = responseHtml.match(/姓名[：:]\s*([^・\s<]+)/);
        const mi = responseHtml.match(/會員編號[：:]\s*([^・\s<]+)/);
        return jsonResp({
            success: true,
            expireDate: directExpire[1],
            memberName: mn ? mn[1] : '',
            memberId: mi ? mi[1] : account,
        }, origin);
    }

    // 未知回應
    return jsonResp({
        success: false,
        error: '無法解析回應',
        loginStatus: loginResp.status,
        debug: responseHtml.substring(0, 1500),
    }, origin);
}

// === 買球記帳 API 處理函數 ===
const BALL_KV_KEY = 'ball_purchases';

async function getBallPurchases(env, origin) {
    const raw = await env.BALL_KV.get(BALL_KV_KEY);
    const purchases = raw ? JSON.parse(raw) : [];
    return jsonResp({ success: true, purchases }, origin);
}

async function addBallPurchase(env, body, origin) {
    const { buyer, brand, qty, amount, date, note } = body;
    if (!buyer || !amount) {
        return jsonResp({ success: false, error: '缺少必要欄位（buyer, amount）' }, origin, 400);
    }
    const raw = await env.BALL_KV.get(BALL_KV_KEY);
    const purchases = raw ? JSON.parse(raw) : [];
    const newRecord = {
        id: Date.now().toString(),
        buyer,
        brand: brand || '',
        qty: qty || 1,
        amount: Number(amount),
        date: date || new Date().toISOString().slice(0, 10),
        note: note || '',
        createdAt: new Date().toISOString(),
    };
    purchases.unshift(newRecord); // 最新的放最前面
    await env.BALL_KV.put(BALL_KV_KEY, JSON.stringify(purchases));
    return jsonResp({ success: true, record: newRecord }, origin);
}

async function deleteBallPurchase(env, id, origin) {
    if (!id) return jsonResp({ success: false, error: '缺少 id' }, origin, 400);
    const raw = await env.BALL_KV.get(BALL_KV_KEY);
    const purchases = raw ? JSON.parse(raw) : [];
    const filtered = purchases.filter(p => p.id !== id);
    await env.BALL_KV.put(BALL_KV_KEY, JSON.stringify(filtered));
    return jsonResp({ success: true }, origin);
}

// === 打球頻率分級 API 處理函數 ===
const TIER_KV_KEY = 'frequency_tiers';

async function getFrequencyTiers(env, origin) {
    const raw = await env.BALL_KV.get(TIER_KV_KEY);
    const tiers = raw ? JSON.parse(raw) : { S: [], A: [], B: [], C: [], unassigned: [] };
    return jsonResp({ success: true, tiers }, origin);
}

async function saveFrequencyTiers(env, body, origin) {
    // body 格式：{ S: [...], A: [...], B: [...], C: [...], unassigned: [...] }
    if (!body || typeof body !== 'object') {
        return jsonResp({ success: false, error: '格式錯誤' }, origin, 400);
    }
    await env.BALL_KV.put(TIER_KV_KEY, JSON.stringify(body));
    return jsonResp({ success: true }, origin);
}

// === 付款狀態 API 處理函數 ===
const PAYMENT_KV_KEY = 'payment_status';

async function getPaymentStatus(env, origin) {
    const raw = await env.BALL_KV.get(PAYMENT_KV_KEY);
    const status = raw ? JSON.parse(raw) : {};
    return jsonResp({ success: true, status }, origin);
}

async function savePaymentStatus(env, body, origin) {
    // body 格式：{ '姓名': true/false, ... }
    if (!body || typeof body !== 'object') {
        return jsonResp({ success: false, error: '格式錯誤' }, origin, 400);
    }
    await env.BALL_KV.put(PAYMENT_KV_KEY, JSON.stringify(body));
    return jsonResp({ success: true }, origin);
}

// === 公帳紀錄 API 處理函數 ===
const PUBLIC_ACCOUNT_KV_KEY = 'public_account';

async function getPublicAccount(env, origin) {
    const raw = await env.BALL_KV.get(PUBLIC_ACCOUNT_KV_KEY);
    const records = raw ? JSON.parse(raw) : [];
    return jsonResp({ success: true, records }, origin);
}

async function addPublicAccountRecord(env, body, origin) {
    const { date, type, description, amount, note } = body;
    if (!type || !description || !amount) {
        return jsonResp({ success: false, error: '缺少必要欄位（type, description, amount）' }, origin, 400);
    }
    if (type !== 'income' && type !== 'expense') {
        return jsonResp({ success: false, error: 'type 必須為 income 或 expense' }, origin, 400);
    }
    const raw = await env.BALL_KV.get(PUBLIC_ACCOUNT_KV_KEY);
    const records = raw ? JSON.parse(raw) : [];
    const newRecord = {
        id: Date.now().toString(),
        date: date || new Date().toISOString().slice(0, 10),
        type,
        description,
        amount: Number(amount),
        note: note || '',
        createdAt: new Date().toISOString(),
    };
    records.unshift(newRecord);
    await env.BALL_KV.put(PUBLIC_ACCOUNT_KV_KEY, JSON.stringify(records));
    return jsonResp({ success: true, record: newRecord }, origin);
}

async function deletePublicAccountRecord(env, id, origin) {
    if (!id) return jsonResp({ success: false, error: '缺少 id' }, origin, 400);
    const raw = await env.BALL_KV.get(PUBLIC_ACCOUNT_KV_KEY);
    const records = raw ? JSON.parse(raw) : [];
    const filtered = records.filter(r => r.id !== id);
    await env.BALL_KV.put(PUBLIC_ACCOUNT_KV_KEY, JSON.stringify(filtered));
    return jsonResp({ success: true }, origin);
}
