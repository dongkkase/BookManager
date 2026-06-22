export const WEB_LIBRARY_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>BookManager Web Library</title>
    <link rel="stylesheet" href="/assets/web-library.css">
</head>
<body>
    <div class="app-shell">
        <header class="app-header">
            <div>
                <h1>BookManager Web Library</h1>
                <p id="locationLabel">Library Root</p>
            </div>
            <form id="searchForm" class="search-form">
                <input id="searchInput" type="search" placeholder="검색어 입력" autocomplete="off">
                <button type="submit">검색</button>
            </form>
        </header>

        <nav id="breadcrumbs" class="breadcrumbs" aria-label="breadcrumb"></nav>
        <div id="statusLine" class="status-line" role="status" aria-live="polite"></div>
        <main id="libraryGrid" class="library-grid" aria-live="polite"></main>
    </div>

    <div id="modalOverlay" class="modal-overlay" hidden>
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
            <button id="modalClose" type="button" class="modal-close" aria-label="닫기">×</button>
            <div id="modalContent"></div>
        </section>
    </div>

    <div id="loadingOverlay" class="loading-overlay" hidden>
        <div class="spinner" aria-hidden="true"></div>
        <div id="loadingText">처리 중...</div>
    </div>

    <script src="/assets/web-library.js" defer></script>
</body>
</html>`;

export const WEB_LIBRARY_CSS = `
:root {
    color-scheme: light;
    --bg: #f4f6f8;
    --surface: #ffffff;
    --surface-subtle: #eef2f6;
    --border: #d8dee7;
    --border-strong: #b8c2cf;
    --text: #18202a;
    --muted: #697586;
    --primary: #2368b8;
    --primary-hover: #1c5799;
    --success: #1f7a4d;
    --danger: #b42318;
    --shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
}

button,
input {
    font: inherit;
}

button {
    cursor: pointer;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.app-shell {
    width: min(1280px, calc(100% - 32px));
    margin: 0 auto;
    padding: 24px 0 40px;
}

.app-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 16px;
}

h1 {
    margin: 0 0 6px;
    font-size: 26px;
    line-height: 1.2;
    letter-spacing: 0;
}

#locationLabel {
    margin: 0;
    color: var(--muted);
    max-width: 680px;
    overflow-wrap: anywhere;
}

.search-form {
    display: flex;
    width: min(440px, 100%);
    gap: 8px;
}

.search-form input {
    flex: 1;
    min-width: 0;
    height: 38px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    padding: 0 12px;
}

.search-form input:focus {
    outline: 2px solid rgba(35, 104, 184, 0.18);
    border-color: var(--primary);
}

.search-form button,
.action-button,
.text-button {
    height: 38px;
    border: 1px solid var(--primary);
    border-radius: 6px;
    background: var(--primary);
    color: #ffffff;
    padding: 0 14px;
    font-weight: 700;
}

.search-form button:hover,
.action-button:hover,
.text-button:hover {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
}

.text-button {
    background: var(--surface);
    color: var(--text);
    border-color: var(--border-strong);
    font-weight: 600;
}

.text-button:hover {
    background: var(--surface-subtle);
    border-color: var(--border-strong);
}

.breadcrumbs {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.breadcrumb-path {
    color: var(--muted);
    overflow-wrap: anywhere;
}

.status-line {
    min-height: 22px;
    margin-bottom: 10px;
    color: var(--muted);
}

.status-line.error {
    color: var(--danger);
}

.library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
}

.library-card {
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.library-card[data-clickable="true"] {
    cursor: pointer;
}

.library-card[data-clickable="true"]:hover {
    border-color: var(--primary);
}

.thumb-box {
    height: 210px;
    background: var(--surface-subtle);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.thumb-box img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.thumb-placeholder {
    width: 86px;
    height: 116px;
    border: 2px solid var(--border-strong);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-weight: 800;
    letter-spacing: 0;
    background: #ffffff;
}

.thumb-placeholder.folder {
    border-top-width: 16px;
}

.card-body {
    padding: 12px;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
}

.card-title {
    min-height: 40px;
    font-weight: 800;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
}

.card-meta {
    color: var(--muted);
    font-size: 12px;
}

.card-actions {
    margin-top: auto;
    display: grid;
    gap: 7px;
}

.action-button {
    width: 100%;
    text-decoration: none;
    display: flex;
    align-items: center;
    justify-content: center;
}

.action-button.secondary {
    background: var(--surface);
    color: var(--text);
    border-color: var(--border-strong);
}

.action-button.secondary:hover {
    background: var(--surface-subtle);
}

.action-button.success {
    background: var(--success);
    border-color: var(--success);
}

.empty-state {
    grid-column: 1 / -1;
    min-height: 220px;
    border: 1px dashed var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-weight: 700;
}

.modal-overlay,
.loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.58);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    z-index: 10;
}

.modal-overlay[hidden],
.loading-overlay[hidden] {
    display: none;
}

.modal-panel {
    width: min(760px, 100%);
    max-height: min(760px, calc(100vh - 40px));
    overflow: auto;
    background: var(--surface);
    color: var(--text);
    border-radius: 8px;
    border: 1px solid var(--border);
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
    padding: 22px;
    position: relative;
}

.modal-close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 20px;
    line-height: 1;
}

.meta-layout {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    gap: 20px;
}

.meta-cover {
    width: 100%;
    aspect-ratio: 3 / 4;
    background: var(--surface-subtle);
    border: 1px solid var(--border);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: var(--muted);
    font-weight: 700;
}

.meta-cover img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.meta-title {
    margin: 0 36px 14px 0;
    font-size: 21px;
    line-height: 1.3;
    overflow-wrap: anywhere;
}

.meta-row {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr);
    gap: 8px;
    padding: 5px 0;
}

.meta-row dt {
    color: var(--muted);
    font-weight: 700;
}

.meta-row dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.meta-summary {
    margin-top: 18px;
    padding: 14px;
    background: var(--surface-subtle);
    border-radius: 6px;
    white-space: pre-wrap;
    line-height: 1.6;
}

.loading-overlay {
    color: #ffffff;
    flex-direction: column;
    gap: 12px;
    font-weight: 800;
}

.spinner {
    width: 42px;
    height: 42px;
    border: 4px solid rgba(255, 255, 255, 0.28);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

@media (max-width: 760px) {
    .app-shell {
        width: min(100% - 20px, 1280px);
        padding-top: 14px;
    }

    .app-header {
        align-items: stretch;
        flex-direction: column;
    }

    .search-form {
        width: 100%;
    }

    .library-grid {
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }

    .thumb-box {
        height: 180px;
    }

    .meta-layout {
        grid-template-columns: 1fr;
    }

    .meta-cover {
        max-width: 210px;
    }
}
`;

export const WEB_LIBRARY_JS = `
const state = {
    currentDir: "",
    query: "",
    canZip: false,
};

const elements = {
    breadcrumbs: document.getElementById("breadcrumbs"),
    grid: document.getElementById("libraryGrid"),
    locationLabel: document.getElementById("locationLabel"),
    modalClose: document.getElementById("modalClose"),
    modalContent: document.getElementById("modalContent"),
    modalOverlay: document.getElementById("modalOverlay"),
    searchForm: document.getElementById("searchForm"),
    searchInput: document.getElementById("searchInput"),
    statusLine: document.getElementById("statusLine"),
    loadingOverlay: document.getElementById("loadingOverlay"),
    loadingText: document.getElementById("loadingText"),
};

function createElement(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
        if (value === undefined || value === null) continue;
        if (key === "className") {
            node.className = value;
        } else if (key === "text") {
            node.textContent = value;
        } else if (key === "dataset") {
            for (const [dataKey, dataValue] of Object.entries(value)) node.dataset[dataKey] = dataValue;
        } else {
            node.setAttribute(key, value);
        }
    }
    for (const child of Array.isArray(children) ? children : [children]) {
        if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
}

function basename(value = "") {
    const parts = String(value).split(/[\\\\/]/).filter(Boolean);
    return parts.at(-1) || value || "Library Root";
}

function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024 * 1024) return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (value >= 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + " MB";
    if (value >= 1024) return (value / 1024).toFixed(1) + " KB";
    return value + " B";
}

function setLoading(message = "") {
    elements.loadingText.textContent = message || "처리 중...";
    elements.loadingOverlay.hidden = !message;
}

function setStatus(message = "", type = "info") {
    elements.statusLine.textContent = message;
    elements.statusLine.classList.toggle("error", type === "error");
}

function queryString(values) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null && value !== "") params.set(key, value);
    }
    const text = params.toString();
    return text ? "?" + text : "";
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "HTTP " + response.status);
    }
    return response.json();
}

function updateHistory(nextState, replace = false) {
    const url = queryString({ dir: nextState.dir, q: nextState.q });
    const historyState = { dir: nextState.dir || "", q: nextState.q || "" };
    if (replace) {
        history.replaceState(historyState, "", url || location.pathname);
    } else {
        history.pushState(historyState, "", url || location.pathname);
    }
}

function thumbSource(item) {
    const file = item.thumb_path || item.path || "";
    return file ? "/api/thumbnail?file=" + encodeURIComponent(file) : "";
}

function makeButton(label, className = "text-button") {
    return createElement("button", { type: "button", className, text: label });
}

function renderBreadcrumb(data, mode) {
    const nodes = [];
    const home = makeButton("Home");
    home.addEventListener("click", () => loadList("", true));
    nodes.push(home);

    if (mode === "search") {
        const back = makeButton("뒤로");
        back.addEventListener("click", () => history.back());
        nodes.unshift(back);
        nodes.push(createElement("span", { className: "breadcrumb-path", text: "Search: " + state.query }));
    } else if (data.current_dir) {
        if (data.parent_dir !== undefined) {
            const up = makeButton("상위 폴더");
            up.disabled = !data.parent_dir && !data.current_dir;
            up.addEventListener("click", () => loadList(data.parent_dir || "", true));
            nodes.push(up);
        }
        nodes.push(createElement("span", { className: "breadcrumb-path", text: data.current_dir }));
    } else {
        nodes.push(createElement("span", { className: "breadcrumb-path", text: "Library Root" }));
    }

    elements.breadcrumbs.replaceChildren(...nodes);
}

function createThumbnail(kind, item) {
    const box = createElement("div", { className: "thumb-box" });
    const src = thumbSource(item);
    if (src) {
        const image = createElement("img", { src, alt: "" });
        image.addEventListener("error", () => {
            box.replaceChildren(createElement("div", {
                className: "thumb-placeholder " + kind,
                text: kind === "folder" ? "Folder" : "File",
            }));
        });
        box.appendChild(image);
        return box;
    }
    box.appendChild(createElement("div", {
        className: "thumb-placeholder " + kind,
        text: kind === "folder" ? "Folder" : "File",
    }));
    return box;
}

function folderMetaText(folder) {
    if (folder.is_library) return "Library";
    const count = Number(folder.count) || 0;
    return count + " items";
}

function createFolderCard(folder) {
    const card = createElement("article", {
        className: "library-card",
        dataset: { clickable: "true" },
    });
    card.addEventListener("click", () => loadList(folder.path, true));

    const actions = createElement("div", { className: "card-actions" });
    const openButton = makeButton("열기", "action-button");
    openButton.addEventListener("click", event => {
        event.stopPropagation();
        loadList(folder.path, true);
    });
    actions.appendChild(openButton);

    if (!folder.is_library && folder.has_metadata) {
        const infoButton = makeButton("책 정보", "action-button secondary");
        infoButton.addEventListener("click", event => {
            event.stopPropagation();
            showMetadata(folder.path);
        });
        actions.appendChild(infoButton);
    }

    if (!folder.is_library && state.canZip && !folder.has_subfolders && Number(folder.count) > 0) {
        const zipButton = makeButton("ZIP 다운로드", "action-button success");
        zipButton.addEventListener("click", event => {
            event.stopPropagation();
            downloadFolderZip(folder);
        });
        actions.appendChild(zipButton);
    }

    const body = createElement("div", { className: "card-body" }, [
        createElement("div", { className: "card-title", text: folder.name || basename(folder.path) }),
        createElement("div", { className: "card-meta", text: folderMetaText(folder) }),
        actions,
    ]);
    card.append(createThumbnail("folder", folder), body);
    return card;
}

function createFileCard(file) {
    const title = file.title || file.name || basename(file.path);
    const card = createElement("article", { className: "library-card" });
    const actions = createElement("div", { className: "card-actions" });
    const link = createElement("a", {
        className: "action-button",
        href: "/api/download?file=" + encodeURIComponent(file.path),
        download: file.name || basename(file.path),
        text: "다운로드",
    });
    actions.appendChild(link);

    const body = createElement("div", { className: "card-body" }, [
        createElement("div", { className: "card-title", text: title }),
        createElement("div", { className: "card-meta", text: formatSize(file.size) }),
        actions,
    ]);
    card.append(createThumbnail("file", file), body);
    return card;
}

function renderList(data, mode = "list") {
    state.canZip = Boolean(data.can_zip);
    state.currentDir = data.current_dir || "";
    const cards = [];
    for (const folder of data.folders || []) cards.push(createFolderCard(folder));
    for (const file of data.files || []) cards.push(createFileCard(file));

    if (!cards.length) {
        cards.push(createElement("div", { className: "empty-state", text: "표시할 항목이 없습니다." }));
    }

    elements.locationLabel.textContent = mode === "search"
        ? "Search: " + state.query
        : (data.current_dir || "Library Root");
    renderBreadcrumb(data, mode);
    elements.grid.replaceChildren(...cards);
    const folderCount = (data.folders || []).length;
    const fileCount = (data.files || []).length;
    setStatus(folderCount + " folders, " + fileCount + " files");
}

async function loadList(dir = "", pushHistory = true) {
    setLoading("목록을 불러오는 중...");
    try {
        state.query = "";
        elements.searchInput.value = "";
        const data = await fetchJson("/api/list" + queryString({ dir }));
        renderList(data, "list");
        if (pushHistory) updateHistory({ dir: data.current_dir || "" });
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        setLoading("");
    }
}

async function runSearch(query, pushHistory = true) {
    const q = String(query || "").trim();
    if (!q) {
        loadList(state.currentDir, pushHistory);
        return;
    }
    setLoading("검색 중...");
    try {
        state.query = q;
        const data = await fetchJson("/api/search" + queryString({ q }));
        data.current_dir = state.currentDir;
        renderList(data, "search");
        if (pushHistory) updateHistory({ q });
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        setLoading("");
    }
}

function closeModal() {
    elements.modalOverlay.hidden = true;
    elements.modalContent.replaceChildren();
}

function metadataValue(value) {
    return String(value || "").trim() || "-";
}

function appendMetadataRow(list, label, value) {
    const term = createElement("dt", { text: label });
    const desc = createElement("dd", { text: metadataValue(value) });
    const row = createElement("div", { className: "meta-row" }, [term, desc]);
    list.appendChild(row);
}

async function showMetadata(dir) {
    setLoading("정보를 불러오는 중...");
    try {
        const meta = await fetchJson("/api/folder-meta" + queryString({ dir }));
        const title = metadataValue(meta.title === "-" ? "" : meta.title);
        const cover = createElement("div", { className: "meta-cover" });
        if (meta.thumb_path) {
            const image = createElement("img", {
                src: "/api/thumbnail?file=" + encodeURIComponent(meta.thumb_path),
                alt: "",
            });
            image.addEventListener("error", () => cover.replaceChildren("No Image"));
            cover.appendChild(image);
        } else {
            cover.textContent = "No Image";
        }

        const list = createElement("dl");
        appendMetadataRow(list, "시리즈", meta.series);
        appendMetadataRow(list, "작가", meta.writer);
        appendMetadataRow(list, "출판사", meta.publisher);
        appendMetadataRow(list, "장르", meta.genre);
        appendMetadataRow(list, "태그", meta.tags);
        appendMetadataRow(list, "평점", meta.rating);

        const content = createElement("div", { className: "meta-layout" }, [
            cover,
            createElement("div", {}, [
                createElement("h2", { id: "modalTitle", className: "meta-title", text: title }),
                list,
            ]),
        ]);
        const summary = createElement("div", {
            className: "meta-summary",
            text: metadataValue(meta.summary === "-" ? "" : meta.summary),
        });
        elements.modalContent.replaceChildren(content, summary);
        elements.modalOverlay.hidden = false;
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        setLoading("");
    }
}

function downloadFolderZip(folder) {
    setLoading("ZIP 파일을 생성하는 중...");
    const url = "/api/folder-zip" + queryString({
        dir: folder.path,
        name: folder.name || basename(folder.path),
    });
    window.location.href = url;
    window.setTimeout(() => setLoading(""), 1600);
}

elements.searchForm.addEventListener("submit", event => {
    event.preventDefault();
    runSearch(elements.searchInput.value, true);
});

elements.modalClose.addEventListener("click", closeModal);
elements.modalOverlay.addEventListener("click", event => {
    if (event.target === elements.modalOverlay) closeModal();
});

window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !elements.modalOverlay.hidden) closeModal();
});

window.addEventListener("popstate", event => {
    const next = event.state || {};
    if (next.q) {
        elements.searchInput.value = next.q;
        runSearch(next.q, false);
    } else {
        loadList(next.dir || "", false);
    }
});

const initialParams = new URLSearchParams(location.search);
const initialQuery = initialParams.get("q") || "";
const initialDir = initialParams.get("dir") || "";
updateHistory({ dir: initialDir, q: initialQuery }, true);
if (initialQuery) {
    elements.searchInput.value = initialQuery;
    runSearch(initialQuery, false);
} else {
    loadList(initialDir, false);
}
`;
