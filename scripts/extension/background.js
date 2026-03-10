/**
 * background.js v3
 *
 * 改善点:
 * 1. 通知 → ページ内トースト注入（OS通知設定に依存しない）
 * 2. 全ファイル（HTML + 画像 + index.html）を Git Data API で1コミット
 *    → GitHub Pagesのデプロイが1回で済み "Canceling" エラーが消える
 *
 * ▼ここを自分の環境に合わせて書き換えてください
 */
const GITHUB_TOKEN = "ghp_xxxxxxxxxx";   // Personal Access Token
const GITHUB_OWNER = "xxxxxx";           // GitHubユーザー名
const GITHUB_REPO  = "my_evernote";          // リポジトリ名
const GITHUB_BRANCH = "main";
const SAVE_DIR = "html";                      // 保存先フォルダ

// ─── コンテキストメニュー登録 ────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "save-html",
        title: "HTMLを保存 📌",
        contexts: ["selection", "image", "link", "page"],
    });
});

// ─── 右クリック → 保存処理 ──────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "save-html") return;

    let result;
    try {
        const responses = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: getSelectedHTML,
        });
        result = responses[0]?.result;
    } catch (err) {
        await toast(tab.id, "error", "❌ エラー", "スクリプト実行に失敗しました");
        return;
    }

    if (!result || result.error) {
        await toast(tab.id, "warning", "⚠️ 選択なし", result?.error ?? "HTML取得に失敗しました");
        return;
    }

    await toast(tab.id, "info", "⏳ 保存中…", "GitHubにアップロードしています");

    try {
        const { filename, imageCount } = await saveToGitHub(result);
        await toast(tab.id, "success", "✅ 保存完了", `${filename}\n画像 ${imageCount} 件を保存`);
    } catch (err) {
        await toast(tab.id, "error", "❌ 保存失敗", err.message ?? String(err));
        console.error("[HTML Saver] 保存エラー:", err);
    }
});

// ─── ページ側で実行：選択HTMLを取得（スマート収縮アルゴリズム）──
function getSelectedHTML() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        return { error: "テキストまたは画像が選択されていません" };
    }

    const range = sel.getRangeAt(0);

    // ブロック要素タグセット（DIVも含む：Cookpad等のdiv多用サイト向け）
    const BLOCK_TAGS = new Set([
        'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV',
        'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
        'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
        'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'DETAILS', 'SUMMARY', 'FORM', 'FIELDSET'
    ]);

    // ノードから最近傍のブロック要素を探す
    function nearestBlock(node) {
        let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        while (el && el !== document.body) {
            if (BLOCK_TAGS.has(el.tagName)) return el;
            el = el.parentElement;
        }
        return document.body;
    }

    // HTML サイズの上限（これを超えるノードは「大きすぎる」とみなす）
    const SIZE_LIMIT = 50000; // 50KB

    const startBlock = nearestBlock(range.startContainer);
    const endBlock = nearestBlock(range.endContainer);

    // ── Stage 1: 選択がひとつのブロック要素内に収まる ────────────
    if (startBlock === endBlock) {
        return { html: startBlock.outerHTML, title: document.title, url: location.href };
    }

    // ── Stage 2: 共通祖先が SIZE_LIMIT 以内 ──────────────────────
    const ancestor = range.commonAncestorContainer;
    const ancestorEl = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;

    if (ancestorEl.outerHTML.length <= SIZE_LIMIT) {
        return { html: ancestorEl.outerHTML, title: document.title, url: location.href };
    }

    // ── Stage 3: startBlock の親を上にたどって最小フィットを探す ──
    let el = startBlock.parentElement;
    while (el && el !== document.body) {
        if (el.contains(endBlock) && el.outerHTML.length <= SIZE_LIMIT) {
            return { html: el.outerHTML, title: document.title, url: location.href };
        }
        el = el.parentElement;
    }

    // ── Stage 4: Fallback — 選択内容だけを cloneContents で取得 ──
    // ヘッダー・ナビ等の不要要素を除外しつつ選択分だけ保存
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-saved-fragment', 'true');
    wrapper.appendChild(range.cloneContents());
    return { html: wrapper.outerHTML, title: document.title, url: location.href };
}

// ─── メイン保存フロー ────────────────────────────────────────
async function saveToGitHub({ html, title, url }) {
    const timestamp = nowJST().replace(/[:.+]/g, "-").slice(0, 19); // JST ベースのファイル名
    const safeTitle = (title || "untitled").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
    const filename = `${timestamp}_${safeTitle}.html`;

    // 1. ボタン・フォーム等のノイズ除去
    const cleanedHtml = cleanHtml(html);
    const fixedHtml = cleanedHtml.replace(/\bbottom-\[[^\]]+\]/g, '');

    // 2. 画像をfetchしてbase64化・srcを書き換え（まだuploadしない）
    const { processedHtml, imageFiles } = await gatherImages(fixedHtml, url, timestamp);

    // 3. 保存HTMLを組み立て
    const mainHtml = compressBlankLines([
        `<!-- saved: ${nowJST()} -->`,
        `<!-- source: ${url} -->`,
        `<!DOCTYPE html>`,
        `<html lang="ja">`,
        `<head>`,
        `  <meta charset="UTF-8">`,
        `  <meta name="viewport" content="width=device-width, initial-scale=1.0">`,
        `  <title>${escHtml(title ?? "Saved Page")}</title>`,
        `</head>`,
        `<body>`,
        processedHtml,
        `</body>`,
        `</html>`,
    ].join("\n"));

    // 4. 既存ファイル一覧を取得 → index.html 生成
    const existing = await listDir(SAVE_DIR);
    const allNames = [...new Set([...existing, filename])].sort((a, b) => b.localeCompare(a));
    const indexHtml = buildIndex(allNames);

    // 5. push するファイルを集約
    const files = [
        { path: `${SAVE_DIR}/${filename}`, base64: textToBase64(mainHtml) },
        { path: `${SAVE_DIR}/index.html`, base64: textToBase64(indexHtml) },
        ...imageFiles, // { path, base64 }
    ];

    // 6. 全ファイルを1コミットで push（GitHub Pages デプロイ1回）
    await batchCommit(files, `[html-saver] ${safeTitle} (+${imageFiles.length} imgs)`);

    return { filename, imageCount: imageFiles.length };
}

// ─── 画像収集：fetch → base64 化（upload はしない）──────────
async function gatherImages(html, baseUrl, timestamp) {
    const imgRegex = /<img([^>]*?)src=(["'])([^"']+)\2/gi;
    const imgMap = new Map(); // src → { newPath, base64 } | null
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
        const src = m[3];
        if (!src.startsWith("data:")) imgMap.set(src, null);
    }

    const imageFiles = [];
    let idx = 0;
    for (const [src] of imgMap) {
        try {
            const resp = await fetch(new URL(src, baseUrl).href);
            if (!resp.ok) continue;
            const buf = await resp.arrayBuffer();
            const base64 = arrayBufferToBase64(buf);
            const ext = resolveExt(src, resp.headers.get("content-type") ?? "");
            const name = `${timestamp}_${String(idx++).padStart(3, "0")}.${ext}`;
            const path = `${SAVE_DIR}/img/${name}`;
            imgMap.set(src, { newPath: `./img/${name}`, base64 });
            imageFiles.push({ path, base64 });
        } catch (e) {
            console.warn("[HTML Saver] 画像スキップ:", src, e.message);
        }
    }

    let processedHtml = html;
    for (const [orig, data] of imgMap) {
        if (data) processedHtml = processedHtml.split(orig).join(data.newPath);
    }
    return { processedHtml, imageFiles };
}

// ─── index.html 生成 ─────────────────────────────────────────
function buildIndex(names) {
    const rows = names.map(name => {
        const rawDate = name.slice(0, 19);
        const dateStr = rawDate
            .replace("T", " ")
            .replace(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})$/, "$1/$2/$3 $4:$5:$6");
        const display = name.slice(20).replace(/\.html$/, "").replace(/_/g, " ");
        return `      <li>\n        <a href="./${name}">${escHtml(display)}</a>\n        <time>${escHtml(dateStr)}</time>\n      </li>`;
    }).join("\n");

    const updatedAt = nowJST().slice(0, 19).replace("T", " ") + " JST";

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Saved Pages</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    header { padding: 2rem 1.5rem 1.25rem; border-bottom: 1px solid #1e293b; background: #0f172a; position: sticky; top: 0; z-index: 10; }
    header h1 { font-size: 1.5rem; font-weight: 700; color: #f8fafc; letter-spacing: -.02em; }
    header p  { margin-top: .3rem; font-size: .85rem; color: #64748b; }
    main { max-width: 860px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
    ul { list-style: none; display: flex; flex-direction: column; gap: .5rem; }
    li { display: flex; align-items: center; justify-content: space-between; gap: 1rem;
         background: #1e293b; border-radius: .625rem; padding: .8rem 1.1rem;
         border: 1px solid #243047; transition: background .15s, border-color .15s; }
    li:hover { background: #243047; border-color: #334155; }
    a { color: #7dd3fc; text-decoration: none; font-weight: 500; font-size: .95rem;
        flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    a:hover { color: #38bdf8; text-decoration: underline; }
    time { font-size: .75rem; color: #475569; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .badge { display: inline-block; background: #1d4ed8; color: #bfdbfe;
             font-size: .7rem; font-weight: 600; padding: .15rem .5rem;
             border-radius: 999px; margin-left: .5rem; vertical-align: middle; }
  </style>
</head>
<body>
  <header>
    <h1>📄 Saved Pages <span class="badge">${names.length}</span></h1>
    <p>最終更新: ${escHtml(updatedAt)} UTC</p>
  </header>
  <main>
    <ul>
${rows}
    </ul>
  </main>
</body>
</html>`;
}

// ─── Git Data API：全ファイルを1コミットで push ───────────────
async function batchCommit(files, message) {
    const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git`;

    // Step1: 現在のブランチのコミット SHA を取得
    const refResp = await fetch(`${api}/ref/heads/${GITHUB_BRANCH}`, { headers: githubHeaders() });
    if (!refResp.ok) throw new Error(`ブランチ取得失敗: ${refResp.status}`);
    const { object: { sha: currentSha } } = await refResp.json();

    // Step2: コミットの tree SHA を取得
    const commitResp = await fetch(`${api}/commits/${currentSha}`, { headers: githubHeaders() });
    if (!commitResp.ok) throw new Error("コミット情報の取得失敗");
    const { tree: { sha: baseTree } } = await commitResp.json();

    // Step3: 各ファイルの blob を並列作成
    const treeItems = await Promise.all(files.map(async ({ path, base64 }) => {
        const blobResp = await fetch(`${api}/blobs`, {
            method: "POST",
            headers: githubHeaders(),
            body: JSON.stringify({ content: base64, encoding: "base64" }),
        });
        if (!blobResp.ok) throw new Error(`Blob作成失敗: ${path}`);
        const { sha } = await blobResp.json();
        return { path, mode: "100644", type: "blob", sha };
    }));

    // Step4: 新しい tree を作成
    const treeResp = await fetch(`${api}/trees`, {
        method: "POST",
        headers: githubHeaders(),
        body: JSON.stringify({ base_tree: baseTree, tree: treeItems }),
    });
    if (!treeResp.ok) throw new Error("Tree作成失敗");
    const { sha: newTree } = await treeResp.json();

    // Step5: 新しいコミットを作成
    const newCommitResp = await fetch(`${api}/commits`, {
        method: "POST",
        headers: githubHeaders(),
        body: JSON.stringify({ message, tree: newTree, parents: [currentSha] }),
    });
    if (!newCommitResp.ok) throw new Error("コミット作成失敗");
    const { sha: newSha } = await newCommitResp.json();

    // Step6: ブランチ ref を更新
    const patchResp = await fetch(`${api}/refs/heads/${GITHUB_BRANCH}`, {
        method: "PATCH",
        headers: githubHeaders(),
        body: JSON.stringify({ sha: newSha }),
    });
    if (!patchResp.ok) {
        const e = await patchResp.json().catch(() => ({}));
        throw new Error(`Ref更新失敗: ${e.message ?? patchResp.status}`);
    }

    console.log(`[HTML Saver] ✅ commit: ${newSha}`);
    return newSha;
}

// ─── GitHub API ──────────────────────────────────────────────
function githubHeaders() {
    return {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
    };
}

async function listDir(dir) {
    const resp = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${dir}`,
        { headers: githubHeaders() }
    );
    if (!resp.ok) return [];
    const files = await resp.json();
    return (Array.isArray(files) ? files : [])
        .filter(f => f.type === "file" && f.name.endsWith(".html") && f.name !== "index.html")
        .map(f => f.name);
}

// ─── ユーティリティ ──────────────────────────────────────────

/**
 * 現在時刻を JST (UTC+9) で ISO 8601 形式に変換
 * 例: "2026-03-09T23:15:00+09:00"
 */
function nowJST() {
    const d = new Date(Date.now() + 9 * 3600_000);
    return d.toISOString().replace(/\.\d{3}Z$/, "+09:00");
}

/**
 * HTMLからインタラクティブ要素を除去（正規表現ベース）
 * MV3 service worker では DOMParser が使えないため regex で処理する
 */
function cleanHtml(html) {
    let result = html;

    // ペア型タグ（開始〜終了タグまるごと除去）
    // form, button, select, textarea, script, noscript, style
    // ※ 同じタグのネストは HTML 仕様上 invalid なので非 greedy で十分
    const PAIRED = ['form', 'button', 'select', 'textarea', 'script', 'noscript', 'style'];
    for (const tag of PAIRED) {
        const re = new RegExp(`<${tag}(\\s[^>]*)?>(?:[\\s\\S]*?)<\\/${tag}>`, 'gi');
        result = result.replace(re, '');
    }

    // 自己終了型・単体タグ
    result = result.replace(/<input\b[^>]*>/gi, '');        // <input ...>
    result = result.replace(/<link\b[^>]*>/gi, '');         // <link ...>

    result = result.replace(/padding-top\s*:\s*[\d.]+%\s*;?/gi, '');

    return result;
}

/**
 * 3行以上連続する空行を最大1行に圧縮し、末尾の余白も除去
 */
function compressBlankLines(html) {
    return html
        .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n") // 連続空行を最大1行に
        .replace(/\n+$/g, "\n")                    // 末尾の複数改行を1つに
        .trim();
}

function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function textToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
}

function resolveExt(src, mime) {
    const urlExt = src.split("?")[0].split(".").pop().toLowerCase();
    if (/^(jpg|jpeg|png|gif|webp|svg|avif|ico)$/.test(urlExt)) return urlExt;
    return ({
        "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
        "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif"
    }
    )[(mime.split(";")[0]).trim()] ?? "jpg";
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── ページ内トースト注入 ─────────────────────────────────────
async function toast(tabId, type, title, message) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: _injectToast,       // serialize可能な名前付き関数
            args: [type, title, message],
        });
    } catch {
        // chrome:// などでは inject 不可 → コンソールにフォールバック
        console.log(`[HTML Saver][${type}] ${title}: ${message}`);
    }
}

// この関数はページに inject されるため外部変数を参照してはいけない
function _injectToast(type, title, message) {
    document.getElementById("__hs_t__")?.remove();

    const clr = {
        info: ["rgba(30,64,175,.95)", "#3b82f6"],
        success: ["rgba(6,78,59,.95)", "#10b981"],
        error: ["rgba(127,29,29,.95)", "#ef4444"],
        warning: ["rgba(120,53,15,.95)", "#f59e0b"],
    }[type] ?? ["rgba(30,64,175,.95)", "#3b82f6"];

    // キーフレーム（一度だけ挿入）
    if (!document.getElementById("__hs_s__")) {
        const s = document.createElement("style");
        s.id = "__hs_s__";
        s.textContent =
            "@keyframes __hsIn{from{opacity:0;transform:translateX(1.5rem)}to{opacity:1;transform:translateX(0)}}" +
            "@keyframes __hsOut{to{opacity:0;transform:translateX(1.5rem)}}";
        (document.head ?? document.documentElement).appendChild(s);
    }

    const t = document.createElement("div");
    t.id = "__hs_t__";
    Object.assign(t.style, {
        position: "fixed", top: "1.25rem", right: "1.25rem",
        zIndex: "2147483647",
        background: clr[0],
        border: `1.5px solid ${clr[1]}`,
        borderRadius: ".75rem",
        padding: ".8rem 1.1rem",
        color: "#f8fafc",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: ".875rem", lineHeight: "1.5",
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        minWidth: "260px", maxWidth: "380px",
        animation: "__hsIn .25s cubic-bezier(.16,1,.3,1)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        cursor: "default",
    });
    t.innerHTML =
        `<div style="font-weight:700;margin-bottom:.25rem">${title}</div>` +
        `<div style="opacity:.85;white-space:pre-line">${message}</div>`;

    // クリックで即閉じ
    t.addEventListener("click", () => t.remove());

    document.documentElement.appendChild(t);

    // 自動消去
    const ms = (type === "error" || type === "warning") ? 7000 : 3500;
    setTimeout(() => {
        t.style.animation = "__hsOut .25s ease forwards";
        setTimeout(() => t.remove(), 260);
    }, ms);
}
