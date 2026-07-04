import {
    faBookOpen,
    faBoxArchive,
    faBuilding,
    faChild,
    faDownload,
    faFileLines,
    faLayerGroup,
    faLink,
    faStar,
    faUser,
    faUsers,
} from '@fortawesome/free-solid-svg-icons';

function fontAwesomeIconData(iconDefinition) {
    const pathData = iconDefinition.icon[4];
    return {
        width: iconDefinition.icon[0],
        height: iconDefinition.icon[1],
        paths: Array.isArray(pathData) ? pathData : [pathData],
    };
}

const DOWNLOAD_ICON_WIDTH = faDownload.icon[0];
const DOWNLOAD_ICON_HEIGHT = faDownload.icon[1];
const DOWNLOAD_ICON_PATH = faDownload.icon[4];
const DETAIL_ICON_DATA = {
    archive: fontAwesomeIconData(faBoxArchive),
    bookOpen: fontAwesomeIconData(faBookOpen),
    building: fontAwesomeIconData(faBuilding),
    child: fontAwesomeIconData(faChild),
    fileLines: fontAwesomeIconData(faFileLines),
    layers: fontAwesomeIconData(faLayerGroup),
    link: fontAwesomeIconData(faLink),
    star: fontAwesomeIconData(faStar),
    user: fontAwesomeIconData(faUser),
    users: fontAwesomeIconData(faUsers),
};

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
    color-scheme: dark;
    --bg: #151515;
    --surface: #202020;
    --surface-subtle: #2b2b2b;
    --surface-raised: #252525;
    --border: #3a3a3a;
    --border-strong: #555555;
    --text: #f2f2f2;
    --muted: #a6a6a6;
    --primary: #4f89aa;
    --primary-hover: #61a1c5;
    --success: #2d7d57;
    --danger: #ff6b5f;
    --warn: #f0b54d;
    --orange: #f97316;
    --orange-hover: #fb923c;
    --shadow: 0 14px 28px rgba(0, 0, 0, 0.36);
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(circle at top left, rgba(79, 137, 170, 0.12), transparent 28rem), var(--bg);
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
    transition: filter 0.16s ease;
}

body.modal-open .app-shell {
    filter: blur(2px);
}

.app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 16px;
    padding: 14px 16px;
    background: rgba(32, 32, 32, 0.84);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
}

h1 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    letter-spacing: 0;
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
    background: #181818;
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
    background: #242424;
    color: var(--text);
    border-color: var(--border-strong);
    font-weight: 600;
}

.text-button:hover {
    background: #303030;
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
    position: relative;
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
    position: relative;
    aspect-ratio: 2 / 3;
    height: auto;
    background: #111111;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.thumb-box::before {
    position: absolute;
    inset: 0 0 auto;
    z-index: 1;
    height: 76px;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.48), rgba(0, 0, 0, 0));
    content: "";
    pointer-events: none;
}

.thumb-box img {
    width: 100%;
    height: 100%;
    object-fit: cover;
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
    background: #242424;
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
    background: #242424;
    color: var(--text);
    border-color: var(--border-strong);
}

.action-button.secondary:hover {
    background: #303030;
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

.load-more-row {
    grid-column: 1 / -1;
    display: flex;
    justify-content: center;
    min-height: 42px;
    padding: 10px 0 2px;
}

.load-more-sentinel {
    min-height: 24px;
    color: var(--muted);
    font-weight: 700;
}

.modal-overlay,
.loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.56);
    backdrop-filter: blur(4px);
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

.card-download-button {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    color: #ffffff;
    background: var(--orange);
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 6px;
    padding: 0 8px;
    text-decoration: none;
    font-size: 18px;
    font-weight: 800;
    line-height: 1;
    overflow: hidden;
    white-space: nowrap;
    transition: width 0.16s ease, background 0.16s ease, border-color 0.16s ease;
    box-shadow: 0px 0px 6px rgba(0, 0, 0, 0.5);
}

.card-download-button::before {
    width: 0;
    overflow: hidden;
    content: "Download";
    font-size: 12px;
    font-weight: 800;
    opacity: 0;
    transition: width 0.16s ease, opacity 0.16s ease;
}

.card-download-button:hover {
    width: 112px;
    background: var(--orange-hover);
    border-color: rgba(255, 255, 255, 0.34);
}

.card-download-button:hover::before {
    width: 68px;
    opacity: 1;
}

.card-count-tag {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 2;
    min-height: 22px;
    display: inline-flex;
    align-items: center;
    max-width: calc(100% - 54px);
    padding: 3px 8px;
    color: #ffffff;
    background: var(--orange);
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    box-shadow: 0px 0px 6px rgba(0, 0, 0, 0.5);
}

.download-icon {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    fill: currentColor;
}

.modal-panel {
    width: min(980px, 100%);
    max-height: min(760px, calc(100vh - 40px));
    overflow: auto;
    background: #111111;
    color: #f7f7f7;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
    padding: 0;
    position: relative;
}

.modal-close {
    position: absolute;
    z-index: 3;
    top: 12px;
    right: 12px;
    width: 32px;
    height: 32px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 6px;
    background: rgba(32, 32, 32, 0.92);
    color: #ffffff;
    font-size: 20px;
    line-height: 1;
}

.web-detail-panel {
    position: relative;
    min-height: 520px;
    overflow: hidden;
    background: #111111;
}

.web-detail-bg {
    position: absolute;
    inset: -42px;
    background-position: center;
    background-size: cover;
    filter: blur(8px);
    opacity: 0.55;
    transform: scale(1.08);
}

.web-detail-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(8, 8, 8, 0.94), rgba(22, 22, 22, 0.76) 44%, rgba(20, 20, 20, 0.96));
}

.web-detail-scroll {
    position: relative;
    z-index: 1;
    max-height: min(760px, calc(100vh - 40px));
    overflow: auto;
}

.web-detail-content {
    display: flex;
    gap: 22px;
    padding: 22px 24px;
}

.web-detail-cover-section {
    flex: 0 0 220px;
    display: flex;
    justify-content: center;
}

.web-detail-cover-stack {
    width: 220px;
}

.web-detail-cover {
    width: 220px;
    aspect-ratio: 2 / 3;
    height: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: #777777;
    background: #303030;
    border: 1px solid #555555;
    border-radius: 5px;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.55);
    font-size: 12px;
    font-weight: 700;
}

.web-detail-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.web-detail-cover-caption {
    padding-top: 8px;
    color: #dedede;
    font-size: 11px;
    line-height: 1.55;
    text-align: center;
    overflow-wrap: anywhere;
}

.web-detail-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding-top: 4px;
}

.web-detail-heading {
    margin: 0 42px 8px 0;
}

.web-detail-series {
    margin-bottom: 8px;
    color: #f0b54d;
    font-size: 14px;
}

.web-detail-title {
    margin-bottom: 11px;
    color: #ffffff;
    font-size: 28px;
    line-height: 1.15;
    overflow-wrap: anywhere;
}

.web-detail-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.web-detail-tags > span {
    min-height: 16px;
    padding: 2px 7px;
    color: #e8e8e8;
    background: #41454a;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 400;
}

.web-detail-info-card {
    display: grid;
    grid-template-columns: minmax(260px, 0.9fr) minmax(300px, 1.1fr);
    min-height: 0;
    overflow: hidden;
    background: rgba(36, 36, 36, 0.84);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
}

.web-metadata-grid {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    align-content: start;
    padding: 12px 16px;
}

.web-metadata-label,
.web-metadata-value {
    min-height: 28px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 12px;
}

.web-metadata-label {
    gap: 6px;
    color: #dddddd;
}

.web-metadata-label.link-label {
    color: #f0b54d;
}

.web-metadata-value {
    min-width: 0;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.8);
    font-weight: 400;
    text-overflow: ellipsis;
    text-indent: 10px;
    white-space: nowrap;
}

.web-metadata-link-value {
    min-width: 0;
    overflow: hidden;
    color: #69bfff;
    text-overflow: ellipsis;
    text-decoration: underline;
    text-indent: 0;
    white-space: nowrap;
    cursor: pointer;
}

.web-detail-extra {
    padding: 12px 16px;
    overflow: auto;
    color: #f2f2f2;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 12px;
}

.web-detail-line {
    display: block;
    min-height: 28px;
    padding: 6px 0;
}

.web-detail-line strong {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
    color: #dddddd;
}

.web-detail-line:first-child strong {
    color: #f0b54d;
}

.web-detail-line > span {
    color: rgba(255, 255, 255, 0.8);
    font-weight: 400;
    overflow-wrap: anywhere;
}

.web-detail-line.plain > span {
    display: block;
    line-height: 1.4;
    white-space: pre-wrap;
}

.web-detail-line.inline {
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
}

.web-detail-line.inline strong {
    margin-bottom: 0;
    white-space: nowrap;
}

.web-fa-icon {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    fill: currentColor;
}

.web-detail-line.inline > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
        height: auto;
    }

    .modal-panel {
        width: min(100%, calc(100vw - 20px));
    }

    .web-detail-content {
        flex-direction: column;
        padding: 18px;
    }

    .web-detail-cover-section {
        flex-basis: auto;
    }

    .web-detail-heading {
        margin-right: 40px;
    }

    .web-detail-title {
        font-size: 22px;
    }

    .web-detail-info-card {
        grid-template-columns: 1fr;
    }

    .web-detail-extra {
        border-left: none;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
}
`;

export const WEB_LIBRARY_JS = `
const SVG_TAGS = new Set(["svg", "path"]);
const DOWNLOAD_ICON = {
    width: ${DOWNLOAD_ICON_WIDTH},
    height: ${DOWNLOAD_ICON_HEIGHT},
    path: ${JSON.stringify(DOWNLOAD_ICON_PATH)},
};
const DETAIL_ICONS = ${JSON.stringify(DETAIL_ICON_DATA)};

const state = {
    currentDir: "",
    query: "",
    canZip: false,
    mode: "list",
    nextOffset: null,
    pageLimit: 80,
    isLoadingMore: false,
    autoLoadFrame: 0,
};
const responseCache = new Map();

const elements = {
    breadcrumbs: document.getElementById("breadcrumbs"),
    grid: document.getElementById("libraryGrid"),
    modalClose: document.getElementById("modalClose"),
    modalContent: document.getElementById("modalContent"),
    modalOverlay: document.getElementById("modalOverlay"),
    searchForm: document.getElementById("searchForm"),
    searchInput: document.getElementById("searchInput"),
    statusLine: document.getElementById("statusLine"),
    loadingOverlay: document.getElementById("loadingOverlay"),
    loadingText: document.getElementById("loadingText"),
};

if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
}

function createElement(tag, options = {}, children = []) {
    const isSvg = SVG_TAGS.has(tag);
    const node = isSvg
        ? document.createElementNS("http://www.w3.org/2000/svg", tag)
        : document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
        if (value === undefined || value === null) continue;
        if (key === "className") {
            if (isSvg) {
                node.setAttribute("class", value);
            } else {
                node.className = value;
            }
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

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

async function fetchJson(url, options = {}) {
    const useCache = options.useCache !== false;
    if (useCache && responseCache.has(url)) return cloneJson(responseCache.get(url));
    const response = await fetch(url);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "HTTP " + response.status);
    }
    const data = await response.json();
    if (useCache) responseCache.set(url, data);
    return cloneJson(data);
}

function renderedCardCount() {
    return elements.grid.querySelectorAll(".library-card").length;
}

function createListHistoryState(overrides = {}) {
    const mode = overrides.mode || (overrides.q ? "search" : state.mode) || "list";
    const q = overrides.q !== undefined
        ? String(overrides.q || "")
        : (mode === "search" ? state.query : "");
    const dir = overrides.dir !== undefined ? String(overrides.dir || "") : state.currentDir;
    return {
        view: "list",
        mode,
        dir,
        q,
        loadedCount: Number(overrides.loadedCount) || renderedCardCount(),
        scrollX: Number(overrides.scrollX ?? window.scrollX) || 0,
        scrollY: Number(overrides.scrollY ?? window.scrollY) || 0,
    };
}

function saveCurrentScrollState() {
    const current = history.state || {};
    if (current.view === "detail") return;
    history.replaceState(createListHistoryState({
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
    }), "", location.href);
}

function updateHistory(nextState, replace = false) {
    const url = queryString({ dir: nextState.dir, q: nextState.q });
    const historyState = createListHistoryState(nextState);
    if (replace) {
        history.replaceState(historyState, "", url || location.pathname);
    } else {
        history.pushState(historyState, "", url || location.pathname);
    }
}

function restoreScrollPosition(scrollX = 0, scrollY = 0) {
    window.requestAnimationFrame(() => window.scrollTo({
        top: Number(scrollY) || 0,
        left: Number(scrollX) || 0,
        behavior: "auto",
    }));
}

async function restoreLoadedItems(mode, loadedCount) {
    const targetCount = Number(loadedCount) || 0;
    while (
        targetCount > renderedCardCount()
        && state.nextOffset !== null
        && state.nextOffset !== undefined
    ) {
        const loaded = await loadMore(mode, { updateHistory: false });
        if (!loaded) break;
    }
}

function thumbSource(item) {
    const file = item.thumb_path || item.path || "";
    return file ? "/api/thumbnail?file=" + encodeURIComponent(file) : "";
}

function makeButton(label, className = "text-button") {
    return createElement("button", { type: "button", className, text: label });
}

function createDownloadIcon() {
    return createElement("svg", {
        className: "download-icon",
        viewBox: "0 0 " + DOWNLOAD_ICON.width + " " + DOWNLOAD_ICON.height,
        "aria-hidden": "true",
        focusable: "false",
    }, createElement("path", { d: DOWNLOAD_ICON.path }));
}

function createDetailIcon(name) {
    const icon = DETAIL_ICONS[name];
    if (!icon) return null;
    const svg = createElement("svg", {
        className: "web-fa-icon",
        viewBox: "0 0 " + icon.width + " " + icon.height,
        "aria-hidden": "true",
        focusable: "false",
    });
    for (const pathData of icon.paths) {
        svg.appendChild(createElement("path", { d: pathData }));
    }
    return svg;
}

function makeDownloadIconLink(href, downloadName) {
    return createElement("a", {
        className: "card-download-button",
        href,
        download: downloadName,
        "aria-label": "다운로드",
        title: "다운로드",
    }, createDownloadIcon());
}

function makeDownloadIconButton(label = "다운로드") {
    return createElement("button", {
        type: "button",
        className: "card-download-button",
        "aria-label": label,
        title: label,
    }, createDownloadIcon());
}

function makeViewerLink(file) {
    const href = file.viewer_url || ("/viewer?viewer=1&webViewer=1&file=" + encodeURIComponent(file.path));
    return createElement("a", {
        className: "action-button",
        href,
        target: "_blank",
        rel: "noopener noreferrer",
        title: "뷰어로 보기",
        text: "보기",
    });
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
    const count = Number(folder.count) || 0;
    return count + (folder.count_limited ? "+ items" : " items");
}

function createCardInfoTag(value) {
    return createElement("div", {
        className: "card-count-tag",
        title: value,
        text: value,
    });
}

function createFolderCard(folder) {
    const card = createElement("article", {
        className: "library-card",
        dataset: { clickable: "true" },
    });
    card.addEventListener("click", () => loadList(folder.path, true));
    card.appendChild(createCardInfoTag(folderMetaText(folder)));

    const actions = createElement("div", { className: "card-actions" });

    if (!folder.is_library && folder.has_metadata) {
        const infoButton = makeButton("상세정보", "action-button secondary");
        infoButton.addEventListener("click", event => {
            event.stopPropagation();
            showMetadata({ dir: folder.path });
        });
        actions.appendChild(infoButton);
    }

    if (!folder.is_library && state.canZip && !folder.has_subfolders && Number(folder.count) > 0) {
        const zipButton = makeDownloadIconButton("ZIP 다운로드");
        zipButton.addEventListener("click", event => {
            event.stopPropagation();
            downloadFolderZip(folder);
        });
        card.appendChild(zipButton);
    }

    const bodyChildren = [
        createElement("div", { className: "card-title", text: folder.name || basename(folder.path) }),
    ];
    if (actions.childNodes.length) bodyChildren.push(actions);
    const body = createElement("div", { className: "card-body" }, bodyChildren);
    card.append(createThumbnail("folder", folder), body);
    return card;
}

function createFileCard(file) {
    const title = file.title || file.name || basename(file.path);
    const card = createElement("article", { className: "library-card" });
    const actions = createElement("div", { className: "card-actions" });
    card.appendChild(createCardInfoTag(formatSize(file.size)));
    card.appendChild(makeDownloadIconLink(
        "/api/download?file=" + encodeURIComponent(file.path),
        file.name || basename(file.path),
    ));

    if (file.viewable) {
        actions.appendChild(makeViewerLink(file));
    }

    if (file.has_metadata) {
        const infoButton = makeButton("상세정보", "action-button secondary");
        infoButton.addEventListener("click", () => showMetadata({ file: file.path }));
        actions.appendChild(infoButton);
    }

    const bodyChildren = [
        createElement("div", { className: "card-title", text: title }),
    ];
    if (actions.childNodes.length) bodyChildren.push(actions);
    const body = createElement("div", { className: "card-body" }, bodyChildren);
    card.append(createThumbnail("file", file), body);
    return card;
}

function removeLoadMoreRow() {
    elements.grid.querySelector(".load-more-row")?.remove();
}

function appendLoadMoreRow() {
    if (state.nextOffset === null || state.nextOffset === undefined) return;
    const sentinel = createElement("div", {
        className: "load-more-sentinel",
        role: "status",
        "aria-live": "polite",
        text: state.isLoadingMore ? "불러오는 중..." : "",
    });
    elements.grid.appendChild(createElement("div", { className: "load-more-row" }, sentinel));
}

function renderList(data, mode = "list", options = {}) {
    state.canZip = Boolean(data.can_zip);
    state.currentDir = data.current_dir || "";
    state.mode = mode;
    state.nextOffset = data.page?.has_more ? data.page.next_offset : null;
    const cards = [];
    for (const folder of data.folders || []) cards.push(createFolderCard(folder));
    for (const file of data.files || []) cards.push(createFileCard(file));

    if (!cards.length && !options.append) {
        cards.push(createElement("div", { className: "empty-state", text: "표시할 항목이 없습니다." }));
    }

    if (options.append) {
        removeLoadMoreRow();
        elements.grid.append(...cards);
    } else {
        renderBreadcrumb(data, mode);
        elements.grid.replaceChildren(...cards);
    }
    appendLoadMoreRow();
    const folderCount = (data.folders || []).length;
    const fileCount = (data.files || []).length;
    const pageTotal = Number(data.page?.total) || folderCount + fileCount;
    const shownCount = Math.min(pageTotal, renderedCardCount());
    const totalText = data.page
        ? shownCount + " / " + pageTotal + " items"
        : folderCount + " folders, " + fileCount + " files";
    setStatus(totalText);
    queueAutoLoadMoreCheck();
    if (!options.append && !options.deferScrollRestore) restoreScrollPosition(options.scrollX, options.scrollY);
}

function isNearPageBottom() {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const viewportHeight = window.innerHeight || doc.clientHeight || 0;
    const scrollHeight = Math.max(doc.scrollHeight || 0, document.body.scrollHeight || 0);
    return scrollTop + viewportHeight >= scrollHeight - 520;
}

function shouldAutoLoadMore() {
    return !document.body.classList.contains("modal-open")
        && !state.isLoadingMore
        && state.nextOffset !== null
        && state.nextOffset !== undefined
        && isNearPageBottom();
}

function queueAutoLoadMoreCheck() {
    if (state.autoLoadFrame) return;
    state.autoLoadFrame = window.requestAnimationFrame(() => {
        state.autoLoadFrame = 0;
        if (shouldAutoLoadMore()) loadMore(state.mode);
    });
}

async function loadList(dir = "", pushHistory = true, options = {}) {
    if (pushHistory) saveCurrentScrollState();
    const url = "/api/list" + queryString({ dir, limit: state.pageLimit, offset: 0 });
    if (!responseCache.has(url)) setLoading("목록을 불러오는 중...");
    try {
        state.query = "";
        elements.searchInput.value = "";
        const data = await fetchJson(url);
        const shouldRestoreLoadedItems = options.restoreLoadedCount !== undefined;
        renderList(data, "list", {
            scrollX: options.scrollX,
            scrollY: options.scrollY,
            deferScrollRestore: shouldRestoreLoadedItems,
        });
        if (shouldRestoreLoadedItems) {
            await restoreLoadedItems("list", options.restoreLoadedCount);
            restoreScrollPosition(options.scrollX, options.scrollY);
        }
        if (pushHistory) updateHistory({ dir: data.current_dir || "" });
        else if (options.replaceHistory) updateHistory({ dir: data.current_dir || "" }, true);
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        setLoading("");
    }
}

async function runSearch(query, pushHistory = true, options = {}) {
    const q = String(query || "").trim();
    if (!q) {
        loadList(state.currentDir, pushHistory);
        return;
    }
    if (pushHistory) saveCurrentScrollState();
    const url = "/api/search" + queryString({ q, limit: state.pageLimit, offset: 0 });
    if (!responseCache.has(url)) setLoading("검색 중...");
    try {
        state.query = q;
        const data = await fetchJson(url);
        data.current_dir = state.currentDir;
        const shouldRestoreLoadedItems = options.restoreLoadedCount !== undefined;
        renderList(data, "search", {
            scrollX: options.scrollX,
            scrollY: options.scrollY,
            deferScrollRestore: shouldRestoreLoadedItems,
        });
        if (shouldRestoreLoadedItems) {
            await restoreLoadedItems("search", options.restoreLoadedCount);
            restoreScrollPosition(options.scrollX, options.scrollY);
        }
        if (pushHistory) updateHistory({ dir: state.currentDir, q, mode: "search" });
        else if (options.replaceHistory) updateHistory({ dir: state.currentDir, q, mode: "search" }, true);
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        setLoading("");
    }
}

async function loadMore(mode = state.mode, options = {}) {
    if (state.isLoadingMore) return false;
    if (state.nextOffset === null || state.nextOffset === undefined) return false;
    const offset = state.nextOffset;
    const url = mode === "search"
        ? "/api/search" + queryString({ q: state.query, limit: state.pageLimit, offset })
        : "/api/list" + queryString({ dir: state.currentDir, limit: state.pageLimit, offset });
    const row = elements.grid.querySelector(".load-more-row");
    const sentinel = row?.querySelector(".load-more-sentinel");
    state.isLoadingMore = true;
    if (sentinel) sentinel.textContent = "불러오는 중...";
    try {
        const data = await fetchJson(url);
        if (mode === "search") data.current_dir = state.currentDir;
        renderList(data, mode, { append: true });
        if (options.updateHistory !== false) saveCurrentScrollState();
        return true;
    } catch (error) {
        setStatus(error.message, "error");
        if (sentinel) sentinel.textContent = "";
        return false;
    } finally {
        state.isLoadingMore = false;
        elements.grid.querySelector(".load-more-sentinel")?.replaceChildren();
        queueAutoLoadMoreCheck();
    }
}

function pushDetailHistory(target) {
    saveCurrentScrollState();
    const listState = history.state || createListHistoryState();
    history.pushState({
        ...listState,
        view: "detail",
        detailTarget: { ...target },
    }, "", location.href);
}

function hideModal() {
    elements.modalOverlay.hidden = true;
    document.body.classList.remove("modal-open");
    elements.modalContent.replaceChildren();
}

function closeModal() {
    if ((history.state || {}).view === "detail") {
        history.back();
        return;
    }
    hideModal();
}

function metadataValue(value, fallback = "-") {
    return String(value || "").trim() || fallback;
}

function splitMetadataValues() {
    const seen = new Set();
    const results = [];
    for (const value of arguments) {
        const values = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
        for (const item of values) {
            const text = String(item || "").trim();
            if (!text || seen.has(text)) continue;
            seen.add(text);
            results.push(text);
        }
    }
    return results;
}

function joinedMetadataValues() {
    return splitMetadataValues.apply(null, arguments).join(", ");
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function isExternalHttpLink(value = "") {
    return /^https?:\\/\\//i.test(String(value || "").trim());
}

function createDetailLabel(icon, label) {
    return [
        createDetailIcon(icon),
        createElement("span", { text: label }),
    ];
}

function appendMetadataRow(grid, icon, label, value, type = "") {
    const labelNode = createElement("div", {
        className: "web-metadata-label" + (type === "link" ? " link-label" : ""),
    }, createDetailLabel(icon, label));
    const valueNode = createElement("div", {
        className: "web-metadata-value",
        title: metadataValue(value),
    });
    if (type === "link" && isExternalHttpLink(value)) {
        valueNode.appendChild(createElement("a", {
            className: "web-metadata-link-value",
            href: String(value).trim(),
            target: "_blank",
            rel: "noopener noreferrer",
            text: metadataValue(value),
        }));
    } else {
        valueNode.textContent = metadataValue(value);
    }
    grid.append(labelNode, valueNode);
}

function createMetadataCover(meta) {
    const cover = createElement("div", { className: "web-detail-cover" });
    const src = thumbSource(meta);
    if (src) {
        const image = createElement("img", { src, alt: "" });
        image.addEventListener("error", () => cover.replaceChildren("No Image"));
        cover.appendChild(image);
    } else {
        cover.textContent = "No Image";
    }
    return cover;
}

function createMetadataTags(meta) {
    const tags = splitMetadataValues(meta.tags, meta.genre);
    return createElement("div", { className: "web-detail-tags" }, (
        tags.length ? tags : ["-"]
    ).map(tag => createElement("span", { text: tag })));
}

function buildMetadataPanel(meta) {
    const coverSrc = thumbSource(meta);
    const title = metadataValue(meta.title || meta.name || basename(meta.path));
    const series = metadataValue(meta.series === "-" ? "" : meta.series, "시리즈 없음");
    const creators = joinedMetadataValues(
        meta.writer,
        meta.penciller,
        meta.inker,
        meta.colorist,
        meta.letterer,
        meta.cover_artist,
        meta.creators,
    );
    const formatManga = [meta.format, meta.manga].filter(Boolean).join(" / ");
    const storyArc = joinedMetadataValues(meta.story_arc);

    const panel = createElement("div", { className: "web-detail-panel" });
    if (coverSrc) {
        const background = createElement("div", { className: "web-detail-bg" });
        background.style.backgroundImage = "url(" + coverSrc + ")";
        panel.appendChild(background);
    }
    panel.appendChild(createElement("div", { className: "web-detail-overlay" }));

    const grid = createElement("div", { className: "web-metadata-grid" });
    appendMetadataRow(grid, "user", "제작진", creators);
    appendMetadataRow(grid, "building", "출판사", meta.publisher);
    appendMetadataRow(grid, "fileLines", "페이지수", meta.page_count);
    appendMetadataRow(grid, "bookOpen", "전체권수", meta.total_volume || meta.volume_count);
    appendMetadataRow(grid, "archive", "포맷 / 망가(방향)", formatManga);
    appendMetadataRow(grid, "star", "평점", meta.rating);
    appendMetadataRow(grid, "child", "연령등급", meta.age_rating);
    appendMetadataRow(grid, "link", "링크", meta.web || meta.link, "link");

    const extra = createElement("section", { className: "web-detail-extra" }, [
        createElement("div", { className: "web-detail-line plain" }, [
            createElement("strong", {}, createDetailLabel("fileLines", "줄거리")),
            createElement("span", { text: metadataValue(meta.description || meta.summary, "줄거리 없음") }),
        ]),
        storyArc ? createElement("div", { className: "web-detail-line inline" }, [
            createElement("strong", {}, createDetailLabel("layers", "스토리 아크")),
            createElement("span", { text: metadataValue(storyArc) }),
        ]) : null,
        createElement("div", { className: "web-detail-line inline" }, [
            createElement("strong", {}, createDetailLabel("users", "등장인물")),
            createElement("span", { text: joinedMetadataValues(meta.characters) || "-" }),
        ]),
    ]);

    const content = createElement("div", { className: "web-detail-content" }, [
        createElement("div", { className: "web-detail-cover-section" }, [
            createElement("div", { className: "web-detail-cover-stack" }, [
                createMetadataCover(meta),
                createElement("div", { className: "web-detail-cover-caption" }, [
                    createElement("div", { text: "해상도: " + metadataValue(meta.resolution) + ", (" + formatSize(meta.size) + ")" }),
                    createElement("div", { text: formatDate(meta.created || meta.ctime) }),
                    createElement("div", { text: formatDate(meta.modified || meta.mtime) }),
                ]),
            ]),
        ]),
        createElement("div", { className: "web-detail-main" }, [
            createElement("div", { className: "web-detail-heading" }, [
                createElement("div", { className: "web-detail-series", text: series }),
                createElement("h2", { id: "modalTitle", className: "web-detail-title", text: title }),
                createMetadataTags(meta),
            ]),
            createElement("div", { className: "web-detail-info-card" }, [grid, extra]),
        ]),
    ]);

    panel.appendChild(createElement("div", { className: "web-detail-scroll" }, [content]));
    return panel;
}

async function showMetadata(target = {}, options = {}) {
    setLoading("정보를 불러오는 중...");
    try {
        const endpoint = target.file ? "/api/file-meta" : "/api/folder-meta";
        const meta = await fetchJson(endpoint + queryString(target.file ? { file: target.file } : { dir: target.dir }));
        if (!meta || Object.keys(meta).length === 0) {
            throw new Error("표시할 메타데이터가 없습니다.");
        }
        elements.modalContent.replaceChildren(buildMetadataPanel(meta));
        elements.modalOverlay.hidden = false;
        document.body.classList.add("modal-open");
        if (options.pushHistory !== false) pushDetailHistory(target);
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

async function restoreListFromHistory(next = {}) {
    const options = {
        scrollX: next.scrollX,
        scrollY: next.scrollY,
        restoreLoadedCount: next.loadedCount,
    };
    if (next.q) {
        elements.searchInput.value = next.q;
        state.currentDir = next.dir || "";
        await runSearch(next.q, false, options);
    } else {
        await loadList(next.dir || "", false, options);
    }
}

window.addEventListener("scroll", queueAutoLoadMoreCheck, { passive: true });
window.addEventListener("wheel", queueAutoLoadMoreCheck, { passive: true });
window.addEventListener("resize", queueAutoLoadMoreCheck);

window.addEventListener("popstate", event => {
    const next = event.state || {};
    hideModal();
    restoreListFromHistory(next).then(() => {
        if (next.view === "detail" && next.detailTarget) {
            showMetadata(next.detailTarget, { pushHistory: false });
        }
    });
});

window.addEventListener("beforeunload", () => {
    if ((history.state || {}).view !== "detail") {
        saveCurrentScrollState();
    }
});

const initialParams = new URLSearchParams(location.search);
const initialQuery = initialParams.get("q") || "";
const initialDir = initialParams.get("dir") || "";
updateHistory({ dir: initialDir, q: initialQuery }, true);
if (initialQuery) {
    elements.searchInput.value = initialQuery;
    runSearch(initialQuery, false, { replaceHistory: true });
} else {
    loadList(initialDir, false, { replaceHistory: true });
}
`;
