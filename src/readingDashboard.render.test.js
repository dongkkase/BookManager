import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('대시보드가 서재·최근 읽음을 연결하고 숨은 파일 작업을 차단하며 오류와 빈 상태에서 복구한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const telemetryOnly = process.env.BOOKMANAGER_DASHBOARD_TELEMETRY_ONLY === '1';
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reading-dashboard-render-')));
    const captureDirectory = process.env.BOOKMANAGER_DASHBOARD_CAPTURE_DIR;
    if (captureDirectory) await fs.mkdir(captureDirectory, { recursive: true });
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { DAILY_RECOMMENDATION_STORAGE_KEY, dailyRecommendationDay } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/dailyRecommendationState.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function frames(count = 3) { for (let index = 0; index < count; index += 1) await frame(); }
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(typeof message === 'function' ? message() : message);
}
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString();
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260"><rect width="180" height="260" fill="#36586a"/><path d="M0 180L180 30V100L0 250Z" fill="#dfb875"/><text x="18" y="45" fill="white" font-size="18">BOOK JOURNAL</text></svg>');
const makeBook = (name, title, ext, author) => ({
    path: '/fixture/' + name + ext, full_path: '/fixture/' + name + ext, name: name + ext,
    title, ext, author, writer: author, size: 2048, exists: true, has_metadata: true,
    readingListAddedAt: daysAgo(1), cover: cover.replace('BOOK%20JOURNAL', encodeURIComponent(title.slice(0, 10))),
});
const first = makeBook('reading', '도시를 읽는 시간', '.epub', '김서연');
const second = makeBook('completed', '오래된 책방에서 발견한 이야기', '.cbz', '박지우');
const third = { ...makeBook('new', '다음 여행을 위한 작은 기록', '.txt', '이하늘'), cover: '' };
const fourth = makeBook('notes', '독서 노트와 기억에 남은 문장들', '.pdf', '김서연');
const originalFiles = [first, second, third, fourth];
const firstVolume = { ...makeBook('모험일지 01권', '모험일지 1권', '.cbz', '박지우'), series: '모험일지', volume: '1' };
const metadataMiddleVolume = { ...makeBook('adventure-next', '모험일지 다음 이야기', '.cbz', '박지우'), series: '모험일지', volume: '2' };
const filenameMiddleVolume = makeBook('모험일지 03권', '모험일지 세 번째 이야기', '.cbz', '박지우');
const volumeScenarioFiles = [fourth, firstVolume, metadataMiddleVolume, filenameMiddleVolume];
const allFixtureFiles = [...originalFiles, firstVolume, metadataMiddleVolume, filenameMiddleVolume];
let catalogFiles = [...originalFiles];
const readingStates = new Map([
    [first.path, { status: 'reading', scrollPercent: 35, updatedAt: daysAgo(0.2) }],
    [second.path, { status: 'completed', scrollPercent: 100, updatedAt: daysAgo(90) }],
]);
let recentFiles = [
    { ...first, lastReadAt: daysAgo(0.2), readingState: readingStates.get(first.path) },
];
let failCatalog = false;
let failRecent = false;
let failReadingStates = false;
let holdReadingStates = false;
const pendingReadingStates = [];
let holdOverview = false;
let releaseOverview;
let recentLoads = 0;
const requests = [];
const savedConfig = [];
const viewerPaths = [];
const previewPaths = [];
const coverPreviewPaths = [];
const previewDescription = '일상에서 마주친 풍경과 오래 기억하고 싶은 순간을 담았습니다. 익숙한 장소를 새로운 시선으로 바라보며 천천히 읽어가는 이야기입니다. 작은 발견들이 모여 오늘의 시간을 조금 다르게 만듭니다.';
const physicalActions = [];
const navigations = [];
const settingsRequests = [];
const telemetryEvents = [];
const recentListeners = new Set();
window.addEventListener('bookmanager:navigate', event => navigations.push(event.detail));
window.addEventListener('bookmanager:open-settings', event => settingsRequests.push(event.detail));
window.electronAPI = {
    trackTelemetry: payload => { telemetryEvents.push(payload); },
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async paths => {
        if (failReadingStates) throw new Error('Reading states unavailable');
        const states = paths.filter(filePath => readingStates.has(filePath)).map(filePath => ({ filePath, ...readingStates.get(filePath) }));
        if (holdReadingStates) return await new Promise(resolve => pendingReadingStates.push(() => resolve(states)));
        return states;
    },
    listRecentReading: async () => {
        recentLoads += 1;
        if (failRecent) throw new Error('Recent reading unavailable');
        return [...recentFiles];
    },
    onRecentReadingChanged: callback => { recentListeners.add(callback); return () => recentListeners.delete(callback); },
    stat: async filePath => ({ isDirectory: filePath === '/fixture', isFile: originalFiles.some(file => file.path === filePath) }),
    readDir: async () => originalFiles.map(file => ({ ...file, isFile: true })),
    scanFolder: async () => [...originalFiles],
    getFilePreview: async filePath => {
        previewPaths.push(filePath);
        const file = [third, fourth].find(entry => entry.path === filePath);
        return file ? { success: true, file: { ...file, cover: file.cover || cover.replace('BOOK%20JOURNAL', encodeURIComponent(file.title.slice(0, 10))), description: previewDescription } } : { success: false };
    },
    loadMetadataCover: async filePath => { coverPreviewPaths.push(filePath); return cover; },
    openInternalViewer: async filePath => { viewerPaths.push(filePath); return { success: true }; },
    showInFolder: async filePath => { physicalActions.push(['reveal', filePath]); return { success: true }; },
    deleteFiles: async paths => { physicalActions.push(['delete', paths]); return { success: true }; },
    renameFile: async (...args) => { physicalActions.push(['rename', args]); return { success: true }; },
    undoRename: async () => { physicalActions.push(['undo']); return { success: true, successCount: 1 }; },
    showMessage: async request => { physicalActions.push(['message', request]); return { response: 1 }; },
    readingLists: async request => {
        requests.push(request);
        if (request.operation === 'dashboard') return { success: true, month: request.month, days: [], totals: { seconds: 0, readingDays: 0, completedBooks: 0 }, goal: { books: 0, minutes: 0 }, completedFiles: [], completedCount: 0 };
        if (request.operation === 'overview') {
            const result = { success: true,
                collections: catalogFiles.length ? [{ id: 'collection-1', name: '주말 독서', count: 2 }] : [],
                wishlistCount: catalogFiles.length ? 2 : 0,
                recentAddedCount: catalogFiles.length, recentUpdatedCount: catalogFiles.length,
            };
            if (holdOverview) return await new Promise(resolve => { releaseOverview = () => resolve(result); });
            return result;
        }
        if (request.operation === 'list') {
            if (request.id === 'library-catalog' && failCatalog) return { success: false, error: 'offline' };
            return { success: true, files: request.id === 'want-to-read' ? catalogFiles.slice(0, 2) : [...catalogFiles] };
        }
        if (request.operation === 'membership') return { success: true, totalCount: request.paths.length, memberCount: 0 };
        return { success: true, files: [], changes: 0, errors: [] };
    },
};
applyMotionPreference('reduced');
const root = createRoot(document.getElementById('root'));
let mountKey = 0;
function mount(libraries = ['/fixture'], lastFolderPath = '/fixture', remount = true, lastSource) {
    if (remount) mountKey += 1;
    root.render(<FolderTab key={mountKey} config={{ libraries, language: 'ko', folder_view_mode: 'table', folder_last_path: lastFolderPath, folder_last_source: lastSource }}
        t={t} saveConfig={async patch => { savedConfig.push(patch); }} showToast={() => {}} />);
}
const dashboard = () => document.querySelector('.reading-dashboard');
const recommendation = () => dashboard()?.querySelector('.reading-dashboard-recommendation');
const recommendedFile = () => allFixtureFiles.find(file => recommendation()?.dataset.filePath === file.path);
const recommendationButton = () => recommendation()?.querySelector('.reading-dashboard-recommendation-read');
const readingChanged = filePath => { for (const listener of recentListeners) listener({ filePath }); };
const row = file => [...document.querySelectorAll('tr[data-file-path]')].find(element => element.dataset.filePath === file.path);
const sidebarButton = label => [...document.querySelectorAll('.sidebar-section-reading button')]
    .find(button => button.querySelector('.recent-reading-list-main')?.textContent.trim() === label);
const buttonByLabel = (label, scope = document) => [...scope.querySelectorAll('button')]
    .find(button => button.textContent.trim() === label || button.getAttribute('aria-label') === label);
async function openDashboard() {
    await until(() => sidebarButton(t('reading_lists.dashboard')), 'Dashboard navigation is missing');
    sidebarButton(t('reading_lists.dashboard')).click();
    await until(() => dashboard() && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', 'Dashboard did not load');
    await frames();
}
async function restartDashboard(clearSavedRecommendation = false) {
    if (clearSavedRecommendation) localStorage.removeItem(DAILY_RECOMMENDATION_STORAGE_KEY);
    mount();
    await until(() => !dashboard() && row(first), 'Dashboard fixture did not remount');
    await openDashboard();
}
async function nativeKey(keyCode, modifiers = []) {
    await new Promise(resolve => {
        window.dashboardInput = { keyCode, modifiers };
        window.continueDashboardInput = resolve;
        console.log('DASHBOARD_KEY');
    });
    await frames(2);
}
const primary = [/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? 'meta' : 'control'];
const countRequests = operation => requests.filter(request => request.operation === operation).length;
async function refresh() {
    document.activeElement?.blur();
    const before = countRequests('list');
    await nativeKey('F5');
    await until(() => countRequests('list') > before && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', 'Dashboard refresh did not finish');
    await frames();
}
async function verifyRecommendationBackgroundRefresh(trigger, label) {
    const refreshEvents = () => telemetryEvents.filter(event => event.event === 'feature_used' && event.feature === 'daily-recommendation-refresh');
    const beforeRefreshEvents = refreshEvents().length;
    const card = recommendation();
    const filePath = card.dataset.filePath;
    const readButton = recommendationButton();
    const description = card.querySelector('.reading-dashboard-recommendation-description');
    const coverButton = card.querySelector('.reading-dashboard-recommendation-cover-trigger');
    const coverImage = card.querySelector('.reading-dashboard-recommendation-cover img');
    check(readButton && description && coverImage, label + ': recommendation preview is incomplete');
    const sourceCover = new Image();
    sourceCover.src = cover;
    await sourceCover.decode();
    await until(() => {
        const bounds = coverImage.getBoundingClientRect();
        const scale = Math.max(bounds.width * devicePixelRatio / sourceCover.naturalWidth, bounds.height * devicePixelRatio / sourceCover.naturalHeight);
        return coverImage.complete && coverImage.naturalWidth > 0 && (scale >= 1 || coverImage.getAttribute('src')?.startsWith('blob:'));
    }, label + ': recommendation cover resampling did not settle');
    const coverSource = coverImage.getAttribute('src');
    const removedContent = [];
    const observer = new MutationObserver(records => {
        for (const record of records) {
            if ([...record.removedNodes].some(node => [readButton, description, coverButton].some(element => node === element || node.contains?.(element)))) {
                removedContent.push('removed recommendation content');
            }
            if (record.type === 'attributes' && record.target === coverImage && record.oldValue !== coverSource) {
                removedContent.push('replaced recommendation cover');
            }
            if (record.target === description || description.contains(record.target)) removedContent.push('replaced recommendation description');
        }
    });
    observer.observe(card, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src'], attributeOldValue: true });
    const assertPreserved = phase => {
        check(refreshEvents().length === beforeRefreshEvents, label + ': background validation tracked a recommendation refresh');
        check(recommendation() === card && card.dataset.filePath === filePath, label + ': ' + phase + ' replaced the current recommendation');
        check(recommendationButton() === readButton && !readButton.disabled && card.querySelector('.reading-dashboard-recommendation-cover-trigger') === coverButton,
            label + ': ' + phase + ' replaced reading controls with loading content');
        check(card.querySelector('.reading-dashboard-recommendation-description') === description && description.textContent === previewDescription,
            label + ': ' + phase + ' lost the loaded description');
        check(card.querySelector('.reading-dashboard-recommendation-cover img') === coverImage && coverImage.getAttribute('src') === coverSource,
            label + ': ' + phase + ' lost the loaded cover');
        check(!card.querySelector('.reading-dashboard-recommendation-message[role="status"]'), label + ': ' + phase + ' displayed a loading placeholder');
        check(removedContent.length === 0, label + ': transient recommendation content replacement: ' + removedContent.join(', '));
    };
    try {
        holdReadingStates = true;
        trigger();
        await until(() => pendingReadingStates.length > 0, label + ': reading-state validation did not start');
        await frames(4);
        assertPreserved('pending validation');
        holdReadingStates = false;
        pendingReadingStates.splice(0).forEach(release => release());
        await frames(5);
        assertPreserved('completed validation');
    } finally {
        holdReadingStates = false;
        pendingReadingStates.splice(0).forEach(release => release());
        observer.disconnect();
    }
}
function verifyLayout() {
    const panel = document.querySelector('.folder-right-panel');
    check(dashboard(), 'Dashboard is missing during layout verification');
    const bounds = dashboard().getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    check(bounds.width > 250 && bounds.left >= panelBounds.left - 1 && bounds.right <= panelBounds.right + 1,
        'Dashboard must stay inside the content panel');
    check(dashboard().scrollWidth <= dashboard().clientWidth + 1, 'Dashboard must not overflow horizontally');
    check(panel.scrollWidth <= panel.clientWidth + 1, 'Content panel must not overflow horizontally');
    if (dashboard().querySelector('.dashboard-onboarding')) {
        check(dashboard().querySelectorAll('.dashboard-onboarding-steps li').length === 3, 'Setup must explain all three steps');
        check(dashboard().querySelectorAll('button').length === 1, 'Setup must offer one clear primary action');
        check(!dashboard().querySelector('.reading-dashboard-summary, .reading-dashboard-main'), 'Setup must not distract with empty statistics or reading cards');
        const hero = dashboard().querySelector('.dashboard-onboarding-hero');
        check(hero.scrollWidth <= hero.clientWidth + 1, 'Setup content overflows its card');
        check(parseFloat(getComputedStyle(document.getElementById('dashboard-setup-title')).fontSize) >= 24, 'Setup title must retain its visual hierarchy');
        check(Math.abs(hero.getBoundingClientRect().left - dashboard().querySelector('.reading-dashboard-header').getBoundingClientRect().left) <= 1,
            'Setup heading and card must align');
    } else if (innerWidth >= 1600) {
        const main = dashboard().querySelector('.reading-dashboard-main').getBoundingClientRect();
        const summary = dashboard().querySelector('.reading-dashboard-summary').getBoundingClientRect();
        check(Math.abs(main.left - summary.left) <= 1 && Math.abs(main.right - summary.right) <= 1,
            'Wide dashboard book sections must use the full available content width');
        const pick = recommendation().getBoundingClientRect();
        const owned = dashboard().querySelector('.reading-dashboard-stat').getBoundingClientRect();
        check(pick.right <= owned.left && pick.top <= owned.bottom, 'Daily recommendation must sit to the left of owned-book statistics');
    } else if (innerWidth <= 800) {
        const pick = recommendation().getBoundingClientRect();
        const owned = dashboard().querySelector('.reading-dashboard-stat').getBoundingClientRect();
        check(pick.bottom <= owned.top + 1, 'Narrow dashboard must place the daily recommendation above statistics');
    }
    for (const button of dashboard().querySelectorAll('button')) {
        check(button.textContent.trim() || button.getAttribute('aria-label'), 'Dashboard controls need accessible names');
        const control = button.getBoundingClientRect();
        check(control.left >= bounds.left - 1 && control.right <= bounds.right + 1, 'Dashboard control escapes the content width');
    }
}
window.verifyDashboardLayout = async () => { await frames(5); verifyLayout(); return { width: innerWidth }; };
window.previewDashboardSetupTheme = async theme => {
    const panel = document.querySelector('.folder-tab');
    const light = { '--folder-bg': '#eff0f1', '--panel-bg': '#faf9f6', '--panel-bg-2': '#ffffff', '--panel-bg-3': '#f0eee8', '--line': '#d6d4ce', '--line-dark': '#e5e2dc', '--text': '#24282b', '--muted': '#626c70', '--accent': '#267394' };
    for (const key of Object.keys(light)) theme === 'light' ? panel.style.setProperty(key, light[key]) : panel.style.removeProperty(key);
    await frames(5);
    verifyLayout();
};
window.runDashboardTelemetryTests = async () => {
    const beforeTelemetry = telemetryEvents.length;
    const menuEvents = () => telemetryEvents.slice(beforeTelemetry).filter(event => event.event === 'menu_opened');
    const selected = kind => sidebarButton(t('reading_lists.' + kind))?.getAttribute('aria-current') === 'page';
    const expected = [];
    const initialPanel = document.querySelector('.folder-tab');
    mount();
    await until(() => document.querySelector('.folder-tab') !== initialPanel && row(first)
        && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', 'Telemetry fixture did not load');
    check(menuEvents().length === 0, 'Initial folder restore tracked a menu opening');
    for (const kind of ['dashboard', 'authors', 'annotations']) {
        sidebarButton(t('reading_lists.' + kind)).click();
        await until(() => selected(kind) && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', kind + ': navigation did not settle');
        expected.push({ event: 'menu_opened', menu: kind, source: 'navigation' });
        check(JSON.stringify(menuEvents()) === JSON.stringify(expected), kind + ': navigation must track exactly one menu opening');
        sidebarButton(t('reading_lists.' + kind)).click();
        await frames();
        check(JSON.stringify(menuEvents()) === JSON.stringify(expected), kind + ': reselecting the active menu tracked a duplicate');
    }
    for (const kind of ['dashboard', 'authors', 'annotations']) {
        const previousPanel = document.querySelector('.folder-tab');
        mount(['/fixture'], '/fixture', true, kind);
        await until(() => document.querySelector('.folder-tab') !== previousPanel && selected(kind)
            && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', kind + ': saved menu did not restore');
        await frames();
        check(JSON.stringify(menuEvents()) === JSON.stringify(expected), kind + ': saved menu restoration tracked a menu opening');
    }
    const previousPanel = document.querySelector('.folder-tab');
    mount([], '');
    await until(() => document.querySelector('.folder-tab') !== previousPanel && dashboard()
        && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', 'Default dashboard did not load');
    await frames();
    check(JSON.stringify(menuEvents()) === JSON.stringify(expected), 'Default dashboard startup tracked a menu opening');
};
window.runDashboardTests = async () => {
    mount();
    await until(() => row(first) && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', 'Initial folder did not load');
    row(first).click();
    await until(() => document.querySelector('#folder-detail-panel'), 'Initial file selection did not open details');
    await frames();
    const beforeRecommendationPreview = previewPaths.length;
    await openDashboard();
    check(!document.querySelector('tr[data-file-path], #folder-detail-panel, .folder-character-index'), 'Dashboard retained hidden list selection or detail navigation');
    check(!document.querySelector('.folder-right-panel .folder-search-control, .folder-right-panel .view-controls'), 'Dashboard exposes controls for the hidden file list');
    check(document.querySelector('.goto-path-input')?.value === t('reading_lists.dashboard')
        && document.querySelector('.goto-path-input').readOnly, 'Dashboard location must be virtual');
    check(sidebarButton(t('reading_lists.dashboard')).getAttribute('aria-current') === 'page', 'Dashboard navigation must expose its selected state');
    check(dashboard().textContent.includes(first.title), 'Recently read book is missing');
    check(JSON.stringify([...dashboard().querySelectorAll('.reading-dashboard-stat strong')].map(element => element.textContent)) === JSON.stringify(['4', '4', '1', '2']),
        'Dashboard summary does not reflect the catalog, recently added books, collections and wishlist');
    check(dashboard().querySelector('.reading-dashboard-continue')?.textContent.includes('35%'), 'Recent reading progress was not attached to the dashboard');
    await until(() => recommendedFile(), 'Daily recommendation did not resolve');
    const initialRecommendation = recommendedFile();
    check([third.path, fourth.path].includes(initialRecommendation.path), 'Recommendation must exclude both in-progress and older completed books outside recent history');
    await until(() => recommendation()?.querySelector('.reading-dashboard-recommendation-description')?.textContent === previewDescription,
        'Recommended-book preview did not supply its description');
    check(JSON.stringify(previewPaths.slice(beforeRecommendationPreview).filter(filePath => [third.path, fourth.path].includes(filePath))) === JSON.stringify([initialRecommendation.path]),
        'Dashboard must preview only its selected recommendation');
    await verifyRecommendationBackgroundRefresh(() => window.dispatchEvent(new Event('focus')), 'Window focus');
    await verifyRecommendationBackgroundRefresh(() => readingChanged(first.path), 'Another book reading update');

    document.activeElement?.blur();
    const beforeActions = physicalActions.length;
    const beforeViewers = viewerPaths.length;
    const beforeNavigations = navigations.length;
    const beforeConfig = savedConfig.length;
    for (const [keyCode, modifiers] of [['A', primary], ['I', primary], ['Z', primary], ['Delete', []], ['Enter', []], ['F1', []], ['F2', []], ['F3', []], ['1', []], ['2', []], ['3', []]]) {
        await nativeKey(keyCode, modifiers);
    }
    for (const action of ['toggle-all', 'invert-selection', 'remove-selected']) {
        window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: { activeTab: 'folder', action } }));
    }
    await frames();
    check(physicalActions.length === beforeActions && viewerPaths.length === beforeViewers && navigations.length === beforeNavigations,
        'Dashboard shortcuts acted on a previous folder selection');
    check(!savedConfig.slice(beforeConfig).some(patch => Object.hasOwn(patch, 'folder_view_mode') && patch.folder_view_mode !== 'table'), 'Dashboard shortcuts changed the hidden list view mode');
    check(!document.querySelector('.folder-dialog-backdrop, #folder-detail-panel'), 'Dashboard shortcuts opened a hidden file dialog');
    await nativeKey('L', primary);
    check(document.activeElement === document.querySelector('.goto-path-input'), 'Dashboard must retain keyboard access to its location');

    const initialSavedRecommendation = localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY);
    const coverButton = recommendation().querySelector('.reading-dashboard-recommendation-cover-trigger');
    coverButton.click();
    await until(() => document.querySelector('.detail-cover-preview-dialog')?.open, 'Clicking the recommendation cover did not open the shared image preview');
    await until(() => coverPreviewPaths.at(-1) === initialRecommendation.path, 'Cover preview did not request the recommended book original');
    check(viewerPaths.length === beforeViewers, 'Cover preview must not open the book viewer');
    await nativeKey('Escape');
    await until(() => !document.querySelector('.detail-cover-preview-dialog'), 'Cover preview did not close with Escape');
    check(document.activeElement === coverButton, 'Closing the cover preview did not restore cover focus');
    await nativeKey('Enter');
    await until(() => document.querySelector('.detail-cover-preview-dialog')?.open, 'Keyboard activation did not open the cover preview');
    document.querySelector('.detail-cover-preview-close').click();
    await until(() => !document.querySelector('.detail-cover-preview-dialog'), 'Cover preview close button did not close');
    check(viewerPaths.length === beforeViewers, 'Keyboard cover preview must not open the book viewer');
    recommendationButton().click();
    await until(() => viewerPaths.length === beforeViewers + 1, 'Read button did not open the recommended book');
    readingStates.set(initialRecommendation.path, { status: 'reading', scrollPercent: 20, updatedAt: daysAgo(0) });
    await verifyRecommendationBackgroundRefresh(() => readingChanged(initialRecommendation.path), 'Opened recommendation reading update');
    await verifyRecommendationBackgroundRefresh(() => window.dispatchEvent(new Event('focus')), 'Return from recommendation viewer');
    check(recommendedFile()?.path === initialRecommendation.path && localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY) === initialSavedRecommendation,
        'Opening and reading the recommendation changed its same-day selection');
    recommendationButton().focus();
    await nativeKey('Enter');
    await until(() => viewerPaths.length === beforeViewers + 2, 'Keyboard activation did not open the daily recommendation');
    check(viewerPaths.at(-1) === initialRecommendation.path, 'Daily recommendation keyboard activation opened the wrong book');

    const recentButton = [...dashboard().querySelectorAll('.reading-dashboard-continue-book')].find(button => button.textContent.includes(first.title));
    check(recentButton, 'Recently read book is not actionable');
    recentButton.focus();
    await nativeKey('Enter');
    await until(() => viewerPaths.length === beforeViewers + 3, 'Keyboard activation did not open the recent book');
    check(viewerPaths.at(-1) === first.path, 'Recent book opened the wrong path');

    const recentViewAll = buttonByLabel(t('reading_lists.dashboard_view_all'), recentButton.closest('.reading-dashboard-section'));
    check(recentViewAll, 'Continue-reading section must offer a view-all button');
    recentViewAll.focus();
    await nativeKey('Enter');
    await until(() => !dashboard() && document.querySelector('.recent-list-toolbar') && row(first), 'Keyboard activation of view-all did not open the recent reading list');
    await openDashboard();
    await until(() => recommendedFile(), 'Daily recommendation did not restore after navigation');
    check(recommendedFile().path === initialRecommendation.path, 'Same-day navigation changed the daily recommendation');

    readingStates.set(initialRecommendation.path, { status: 'completed', scrollPercent: 100, updatedAt: daysAgo(0) });
    await verifyRecommendationBackgroundRefresh(() => readingChanged(initialRecommendation.path), 'Completed recommendation');
    await restartDashboard();
    await until(() => recommendedFile(), 'Completed same-day recommendation did not restore after restarting the dashboard');
    check(recommendedFile().path === initialRecommendation.path && localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY) === initialSavedRecommendation,
        'Restarting the dashboard changed a completed same-day recommendation');
    const remainingUnread = [third, fourth].find(file => file.path !== initialRecommendation.path);
    readingStates.set(remainingUnread.path, { status: 'completed', scrollPercent: 100, updatedAt: daysAgo(0) });
    await until(() => recommendation()?.querySelector('.reading-dashboard-recommendation-description')?.textContent === previewDescription,
        'Restored same-day recommendation did not load its preview');
    await verifyRecommendationBackgroundRefresh(() => readingChanged(remainingUnread.path), 'All books read with a saved recommendation');
    await restartDashboard(true);
    await until(() => recommendation()?.textContent.includes(t('reading_lists.dashboard_recommendation_empty')), 'A new selection in an all-read library must show an empty recommendation');
    check(!recommendedFile(), 'A new selection in an all-read library still offers a book');

    readingStates.delete(third.path);
    readingStates.delete(fourth.path);
    failReadingStates = true;
    await restartDashboard(true);
    await until(() => recommendation()?.querySelector('[role="alert"]'), 'Reading-state failure must not recommend an unverified book');
    check(!recommendedFile(), 'Failed reading-state request exposed a stale recommendation');
    failReadingStates = false;
    const recommendationRetry = buttonByLabel(t('reading_lists.dashboard_retry'), recommendation());
    check(recommendationRetry, 'Recommendation failure does not offer a retry');
    recommendationRetry.click();
    await until(() => recommendedFile() && !recommendation()?.querySelector('[role="alert"]'), 'Recommendation retry did not recover');
    const locallyRead = recommendedFile();
    const localReadingKey = 'bookmanager-viewer-state:' + locallyRead.path;
    localStorage.setItem(localReadingKey, JSON.stringify({ status: 'reading', scrollPercent: 20, updatedAt: daysAgo(0) }));
    await until(() => recommendation()?.querySelector('.reading-dashboard-recommendation-description')?.textContent === previewDescription,
        'Recovered recommendation did not load its preview');
    await verifyRecommendationBackgroundRefresh(() => window.dispatchEvent(new StorageEvent('storage', { key: localReadingKey })), 'Local progress on the saved recommendation');
    check(recommendedFile()?.path === locallyRead.path, 'Local viewer progress changed the saved same-day recommendation');
    await restartDashboard(true);
    await until(() => recommendedFile() && recommendedFile().path !== locallyRead.path, 'A new selection must exclude local viewer progress missing from database history');
    localStorage.removeItem(localReadingKey);
    window.dispatchEvent(new StorageEvent('storage', { key: localReadingKey }));
    await until(() => recommendedFile(), 'Removing local reading progress left the recommendation unresolved');

    const beforeOverview = countRequests('overview');
    const beforeRecent = recentLoads;
    recentFiles = [{ ...third, lastReadAt: daysAgo(0), readingState: { status: 'reading', scrollPercent: 65 } }, ...recentFiles];
    readingStates.set(third.path, recentFiles[0].readingState);
    await refresh();
    await until(() => dashboard()?.querySelector('.reading-dashboard-continue')?.textContent.includes(third.title), 'Refresh did not update recent reading');
    check(countRequests('overview') > beforeOverview && recentLoads > beforeRecent, 'Refresh must reload both overview and recent reading');

    holdOverview = true;
    releaseOverview = undefined;
    catalogFiles = originalFiles.map(file => file.path === first.path ? { ...file, title: '조회가 완료된 도서' } : file);
    const pathRefresh = buttonByLabel(t('action_refresh'), document.querySelector('.folder-goto-path-bar'));
    check(pathRefresh && !pathRefresh.disabled, 'Path-bar refresh should be available');
    pathRefresh.click();
    await until(() => releaseOverview && dashboard()?.querySelector('.reading-dashboard-latest')?.textContent.includes('조회가 완료된 도서')
        && dashboard()?.querySelector('.reading-dashboard-continue')?.getAttribute('aria-busy') === 'false', 'Catalog and recent reading did not finish while overview was pending');
    check(pathRefresh.disabled && document.querySelector('.view-container').getAttribute('aria-busy') === 'true',
        'Overview request must keep refresh disabled after catalog and recent reading finish');
    holdOverview = false;
    releaseOverview();
    await until(() => !pathRefresh.disabled && document.querySelector('.view-container').getAttribute('aria-busy') === 'false', 'Refresh did not unlock when overview completed');
    catalogFiles = [...originalFiles];

    recentFiles = [{ ...recentFiles[0], readingState: { status: 'reading', scrollPercent: 72 } }, ...recentFiles.slice(1)];
    readingStates.set(third.path, recentFiles[0].readingState);
    readingChanged(third.path);
    await until(() => dashboard()?.querySelector('.reading-dashboard-continue')?.textContent.includes('72%'), 'Viewer reading updates did not refresh dashboard progress');

    failRecent = true;
    await refresh();
    await until(() => dashboard()?.querySelector('[role="alert"]'), 'Recent-reading failure must remain visible beside the catalog');
    check(dashboard().querySelector('.reading-dashboard-stat strong')?.textContent === '4', 'Recent-reading failure removed the library summary');
    failRecent = false;
    buttonByLabel(t('reading_lists.dashboard_retry'), dashboard()).click();
    await until(() => !dashboard()?.querySelector('[role="alert"]') && dashboard()?.querySelector('.reading-dashboard-continue'), 'Recent-reading retry did not recover');

    failCatalog = true;
    await refresh();
    await until(() => document.querySelector('.view-container [role="alert"]'), 'Catalog failure was displayed as an empty library');
    failCatalog = false;
    const retry = buttonByLabel(t('action_refresh'), document.querySelector('.view-container'));
    check(retry, 'Catalog error must offer a retry');
    retry.click();
    await until(() => dashboard() && !document.querySelector('.view-container [role="alert"]'), 'Dashboard retry did not recover');
    await document.fonts.ready;
    await frames();
    verifyLayout();
    return { hiddenFileActionsBlocked: true, recentBookOpened: true, keyboardNavigation: true, refreshed: true, overviewWaited: true, liveProgress: true, errorRecovered: true,
        recommendationOpened: true, recommendationStable: true, recommendationReadingStable: true, recommendationBackgroundStable: true, recommendationEligibility: true, recommendationRetry: true, recommendationLocalState: true };
};
window.runDashboardShuffleTests = async () => {
    catalogFiles = [...originalFiles];
    readingStates.clear();
    readingStates.set(first.path, { status: 'reading', scrollPercent: 35, updatedAt: daysAgo(0.2) });
    readingStates.set(second.path, { status: 'completed', scrollPercent: 100, updatedAt: daysAgo(90) });
    recentFiles = [{ ...first, lastReadAt: daysAgo(0.2), readingState: readingStates.get(first.path) }];
    localStorage.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, JSON.stringify({ version: 1, day: dailyRecommendationDay(), path: fourth.path, previousPath: '', seed: 13 }));
    applyMotionPreference('full');
    mount();
    await until(() => !dashboard() && row(first), 'Shuffle fixture did not remount');
    await openDashboard();
    await until(() => recommendedFile()?.path === fourth.path && recommendation()?.querySelector('.reading-dashboard-recommendation-description')?.textContent === previewDescription,
        'Shuffle fixture did not restore its initial recommendation');
    const overlay = () => document.querySelector('.recommendation-shuffle-overlay');
    const shuffleButton = () => recommendation()?.querySelector('.reading-dashboard-recommendation-shuffle');
    const savedRecord = () => localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY);
    const selectedCover = () => overlay()?.querySelector('.recommendation-shuffle-selected');
    const transform = element => {
        const value = getComputedStyle(element).transform;
        return new DOMMatrixReadOnly(value === 'none' ? undefined : value);
    };
    const nearBounds = (actual, expected, tolerance = 6) => ['left', 'top', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) <= tolerance);
    const releaseStates = () => {
        holdReadingStates = false;
        pendingReadingStates.splice(0).forEach(release => release());
    };
    const captureStage = async name => {
        if (!${Boolean(captureDirectory)}) return;
        await new Promise(resolve => {
            window.dashboardCaptureName = name;
            window.continueDashboardCapture = resolve;
            console.log('DASHBOARD_SHUFFLE_CAPTURE');
        });
    };
    const verifyCurrent = (filePath, stored, label) => {
        check(recommendedFile()?.path === filePath && savedRecord() === stored, label + ': shuffle changed the current recommendation before commit');
        check(recommendation()?.querySelector('.reading-dashboard-recommendation-description')?.textContent === previewDescription
            && recommendationButton() && recommendation()?.querySelector('.reading-dashboard-recommendation-cover img'),
        label + ': shuffle replaced the loaded recommendation with loading content');
    };
    async function openHeld() {
        const button = shuffleButton();
        check(button && !button.disabled, 'Shuffle button must be available beside reading');
        holdReadingStates = true;
        button.focus();
        button.click();
        await until(() => overlay()?.open && pendingReadingStates.length > 0, 'Shuffle did not open and prepare a recommendation');
        check(overlay().parentElement === document.body && overlay().matches(':modal'), 'Shuffle must use a modal body portal');
        const bounds = overlay().getBoundingClientRect();
        check(Math.abs(bounds.left) <= 1 && Math.abs(bounds.top) <= 1 && Math.abs(bounds.width - innerWidth) <= 2 && Math.abs(bounds.height - innerHeight) <= 2,
            'Shuffle must cover the full viewport rather than the dashboard panel');
        check(overlay().contains(document.activeElement), 'Opening shuffle must move focus into the modal');
        check(overlay().dataset.phase === 'searching', 'Pending preparation must keep the searching phase');
        return button;
    }
    async function expectClosed(trigger, expectedPath) {
        await until(() => !overlay() && recommendedFile()?.path === expectedPath, 'Shuffle did not close with the expected recommendation');
        await frames();
        check(document.activeElement === trigger, 'Shuffle completion must restore focus to its trigger');
    }
    try {
        const originalPath = recommendedFile().path;
        const originalRecord = savedRecord();
        const originalReadButton = recommendationButton();
        const originalDescription = recommendation().querySelector('.reading-dashboard-recommendation-description');
        const cancelTrigger = await openHeld();
        verifyCurrent(originalPath, originalRecord, 'Pending cancelled shuffle');
        await nativeKey('Escape');
        await until(() => !overlay(), 'Escape did not cancel shuffle');
        releaseStates();
        await frames(6);
        verifyCurrent(originalPath, originalRecord, 'Late cancelled response');
        check(recommendationButton() === originalReadButton && recommendation().querySelector('.reading-dashboard-recommendation-description') === originalDescription,
            'Cancelling shuffle replaced the existing recommendation content');
        check(document.activeElement === cancelTrigger, 'Cancelling shuffle must restore trigger focus');

        const origins = [];
        for (let iteration = 0; iteration < 2; iteration += 1) {
            const currentPath = recommendedFile().path;
            const currentRecord = savedRecord();
            const beforePreviews = previewPaths.length;
            const fullTrigger = await openHeld();
            verifyCurrent(currentPath, currentRecord, 'Full-motion searching');
            const up = overlay().querySelector('.recommendation-shuffle-track[data-direction="up"]');
            const down = overlay().querySelector('.recommendation-shuffle-track[data-direction="down"]');
            check(up && down, 'Full-motion shuffle must include opposing cover tracks');
            const initialUp = transform(up).m42;
            const initialDown = transform(down).m42;
            await until(() => {
                const upDelta = transform(up).m42 - initialUp;
                const downDelta = transform(down).m42 - initialDown;
                return Math.abs(upDelta) > 0.5 && Math.abs(downDelta) > 0.5 && upDelta * downDelta < 0;
            }, 'Background cover tracks did not move in opposite directions');
            check(previewPaths.length === beforePreviews, 'Searching background must use cached covers without fetching book previews');
            const wall = overlay().querySelector('.recommendation-shuffle-wall');
            check(Number(getComputedStyle(wall).opacity) < 0.01, 'Preparing shuffle must keep its unfinished cover wall hidden');
            releaseStates();
            await until(() => overlay()?.dataset.phase === 'searching' && Number(getComputedStyle(wall).opacity) > 0.9,
                'Prepared shuffle did not display its cover wall while searching');
            const visibleCoverSources = [...wall.querySelectorAll('.recommendation-shuffle-tile')].map(tile => ({
                tile, source: tile.querySelector('img')?.getAttribute('src') || '',
            }));
            check(new Set(visibleCoverSources.map(item => item.source)).size > 1, 'Shuffle fixture must distinguish different book covers');
            let coversChanged = false;
            const inspectCovers = () => {
                coversChanged ||= visibleCoverSources.some(({ tile, source }) => !tile.isConnected || (tile.querySelector('img')?.getAttribute('src') || '') !== source);
            };
            const coverObserver = new MutationObserver(inspectCovers);
            coverObserver.observe(wall, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
            try {
                if (iteration === 0) await captureStage('dashboard-shuffle-searching');
                await until(() => {
                    inspectCovers();
                    return overlay()?.dataset.phase === 'revealing' && selectedCover()?.dataset.filePath;
                }, 'Shuffle did not reveal the selected cover');
                inspectCovers();
                check(!coversChanged, 'Visible background covers changed before the selected book lifted out');
            } finally {
                coverObserver.disconnect();
            }
            const selected = selectedCover();
            const fullSelectedPath = selected.dataset.filePath;
            check(fullSelectedPath === (currentPath === third.path ? fourth.path : third.path), 'Shuffle must select the other unread eligible book');
            const origin = {
                column: Number(selected.dataset.originColumn), row: Number(selected.dataset.originRow),
                x: Number(selected.dataset.originX), y: Number(selected.dataset.originY),
            };
            check(Number.isInteger(origin.column) && origin.column >= 0 && Number.isInteger(origin.row) && origin.row >= 0
                && Number.isFinite(origin.x) && Number.isFinite(origin.y), 'Selected cover must identify its background tile origin');
            check(innerWidth / 2 + origin.x >= 0 && innerWidth / 2 + origin.x <= innerWidth
                && innerHeight / 2 + origin.y >= 0 && innerHeight / 2 + origin.y <= innerHeight,
                'Selected cover must originate from a visible background tile');
            if (origins.length) check(origin.column !== origins.at(-1).column, 'Consecutive shuffles must use different background columns');
            origins.push(origin);
            verifyCurrent(currentPath, currentRecord, 'Selected-cover reveal');
            await until(() => {
                const bounds = selected.getBoundingClientRect();
                return overlay()?.dataset.phase === 'revealing' && Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) <= 6
                    && Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) <= 6;
            }, 'Selected cover did not expand into the viewport center');
            if (iteration === 0) await captureStage('dashboard-shuffle-revealing');
            if (iteration === 1) {
                const caption = overlay().querySelector('.recommendation-shuffle-caption');
                await until(() => overlay()?.dataset.phase === 'revealing' && Number(getComputedStyle(caption).opacity) > 0.99,
                    'Selected-book caption did not settle before resize');
                window.dispatchEvent(new Event('resize'));
                const centered = selected.getBoundingClientRect();
                check(Math.abs(centered.left + centered.width / 2 - innerWidth / 2) <= 6
                    && Math.abs(centered.top + centered.height / 2 - innerHeight / 2) <= 6, 'Resizing moved the revealed cover away from the viewport center');
                check(Number(getComputedStyle(overlay().querySelector('.recommendation-shuffle-message')).opacity) < 0.01
                    && Math.abs(Number(getComputedStyle(wall).opacity) - 0.22) < 0.02
                    && Number(getComputedStyle(caption).opacity) > 0.99, 'Resizing restored searching content or hid the selected-book caption');
            }
            await until(() => overlay()?.dataset.phase === 'landing', 'Selected cover did not begin moving into the dashboard');
            const target = recommendation().querySelector('.reading-dashboard-recommendation-cover .reading-dashboard-cover').getBoundingClientRect();
            const expanded = selected.getBoundingClientRect();
            check(expanded.width > target.width, 'Landing must shrink the expanded cover toward the dashboard cover');
            verifyCurrent(currentPath, currentRecord, 'Landing start');
            let reachedTarget = false;
            const landingDeadline = performance.now() + 8000;
            while (overlay() && performance.now() < landingDeadline) {
                const bounds = selected.getBoundingClientRect();
                reachedTarget ||= nearBounds(bounds, target);
                // The persisted selection can update before React paints the committing phase.
                if (overlay().dataset.phase === 'landing' && !reachedTarget) verifyCurrent(currentPath, currentRecord, 'Landing in progress');
                if (recommendedFile()?.path !== currentPath || savedRecord() !== currentRecord) {
                    check(reachedTarget, 'Recommendation was committed before its cover reached the dashboard target: ' + JSON.stringify({ actual: bounds.toJSON(), target: target.toJSON(), phase: overlay().dataset.phase }));
                }
                await frame();
            }
            check(reachedTarget, 'Selected cover did not reach the actual dashboard cover bounds');
            await expectClosed(fullTrigger, fullSelectedPath);
            check(JSON.parse(savedRecord()).path === fullSelectedPath, 'Shuffle completion did not persist the displayed book');
        }
        await until(() => recommendation()?.querySelector('.reading-dashboard-recommendation-description')?.textContent === previewDescription,
            'Committed shuffle lost its selected-book description');
        await verifyRecommendationBackgroundRefresh(() => window.dispatchEvent(new Event('focus')), 'Committed shuffle focus refresh');

        applyMotionPreference('reduced');
        await frames();
        const reducedOriginalPath = recommendedFile().path;
        const reducedRecord = savedRecord();
        const reducedTrigger = await openHeld();
        const tracks = [...overlay().querySelectorAll('.recommendation-shuffle-track')];
        const positions = tracks.map(track => getComputedStyle(track).transform);
        await frames(5);
        check(tracks.every((track, index) => getComputedStyle(track).transform === positions[index]), 'Reduced motion must keep cover tracks stationary');
        verifyCurrent(reducedOriginalPath, reducedRecord, 'Reduced-motion searching');
        releaseStates();
        await until(() => overlay()?.dataset.phase === 'revealing' && selectedCover()?.dataset.filePath, 'Reduced-motion shuffle did not show its selected book');
        const reducedSelectedPath = selectedCover().dataset.filePath;
        const staticCover = selectedCover();
        const initialTransform = transform(staticCover);
        verifyCurrent(reducedOriginalPath, reducedRecord, 'Reduced-motion selected cover');
        for (let index = 0; index < 2; index += 1) {
            await frame();
            if (overlay()?.dataset.phase !== 'revealing') break;
            const settledTransform = transform(staticCover);
            check(Math.abs(settledTransform.m11 - initialTransform.m11) < 0.001 && Math.abs(settledTransform.m22 - initialTransform.m22) < 0.001
                && Math.abs(settledTransform.m41 - initialTransform.m41) < 0.001 && Math.abs(settledTransform.m42 - initialTransform.m42) < 0.001,
                'Reduced motion must not move or enlarge the selected cover during reveal');
        }
        await expectClosed(reducedTrigger, reducedSelectedPath);
        check(reducedSelectedPath === (reducedOriginalPath === third.path ? fourth.path : third.path) && JSON.parse(savedRecord()).path === reducedSelectedPath,
            'Reduced-motion shuffle did not commit the next unread book');
        return { shuffleCancelled: true, shuffleCommitted: true, shuffleLanding: true, shuffleVariedOrigins: true, shuffleCoversStable: true, shuffleResizeStable: true, shuffleReducedMotion: true };
    } finally {
        releaseStates();
        applyMotionPreference('reduced');
    }
};
window.verifyDashboardShuffleCoverage = async () => {
    applyMotionPreference('full');
    await frames();
    const overlay = () => document.querySelector('.recommendation-shuffle-overlay');
    const button = recommendation()?.querySelector('.reading-dashboard-recommendation-shuffle');
    check(button && !button.disabled, 'Coverage fixture must offer a new recommendation');
    holdReadingStates = true;
    button.click();
    try {
        await until(() => overlay()?.open && pendingReadingStates.length > 0, 'Coverage fixture did not open its cover wall');
        const plane = overlay().querySelector('.recommendation-shuffle-plane');
        const tracks = [...plane.querySelectorAll('.recommendation-shuffle-track')];
        const animations = tracks.flatMap(track => track.getAnimations());
        check(animations.length >= tracks.length, 'Coverage fixture must exercise moving cover tracks');
        animations.forEach(animation => animation.pause());
        const verifyCoverage = phase => {
            const bounds = plane.getBoundingClientRect();
            const style = getComputedStyle(plane);
            const matrix = new DOMMatrixReadOnly(style.transform);
            const determinant = matrix.m11 * matrix.m22 - matrix.m12 * matrix.m21;
            const width = parseFloat(style.width);
            const height = parseFloat(style.height);
            const gap = parseFloat(style.columnGap) || 0;
            const rows = tracks.map(track => {
                const column = track.parentElement;
                const first = track.firstElementChild;
                const last = track.lastElementChild;
                const transform = getComputedStyle(track).transform;
                const shift = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
                return {
                    left: column.offsetLeft, right: column.offsetLeft + column.offsetWidth,
                    top: first.offsetTop + shift, bottom: last.offsetTop + last.offsetHeight + shift,
                };
            });
            for (const x of [1, innerWidth / 2, innerWidth - 1]) {
                for (const y of [1, innerHeight / 2, innerHeight - 1]) {
                    const dx = x - bounds.left - bounds.width / 2;
                    const dy = y - bounds.top - bounds.height / 2;
                    const localX = width / 2 + (matrix.m22 * dx - matrix.m21 * dy) / determinant;
                    const localY = height / 2 + (matrix.m11 * dy - matrix.m12 * dx) / determinant;
                    check(rows.some(row => localX >= row.left - gap / 2 - 1 && localX <= row.right + gap / 2 + 1
                        && localY >= row.top - 1 && localY <= row.bottom + 1),
                    'Cover wall leaves an empty outer edge at ' + innerWidth + 'x' + innerHeight + ', phase ' + phase + ', point ' + x + ',' + y);
                }
            }
        };
        for (const progress of [0, 0.5, 0.999]) {
            animations.forEach(animation => { animation.currentTime = animation.effect.getTiming().duration * progress; });
            await frames();
            verifyCoverage(progress);
        }
        applyMotionPreference('reduced');
        await frames();
        verifyCoverage('reduced');
    } finally {
        if (overlay()) await nativeKey('Escape');
        await until(() => !overlay(), 'Coverage fixture did not close');
        holdReadingStates = false;
        pendingReadingStates.splice(0).forEach(release => release());
        applyMotionPreference('reduced');
        await frames();
    }
};
window.runDashboardVolumeTests = async () => {
    catalogFiles = [...volumeScenarioFiles];
    recentFiles = [];
    for (const file of volumeScenarioFiles) readingStates.delete(file.path);
    const savedRecommendation = { version: 1, day: dailyRecommendationDay(), path: metadataMiddleVolume.path, previousPath: '', seed: 13 };
    localStorage.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, JSON.stringify(savedRecommendation));
    const beforePreviews = previewPaths.length;
    mount();
    await until(() => !dashboard() && row(first), 'Volume fixture did not remount');
    await openDashboard();
    const eligiblePaths = [fourth.path, firstVolume.path];
    const savedPath = () => JSON.parse(localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY))?.path;
    await until(() => eligiblePaths.includes(recommendedFile()?.path) && savedPath() !== metadataMiddleVolume.path,
        'A saved unread metadata volume 2 must be replaced by a standalone book or volume 1');

    localStorage.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, JSON.stringify({ ...savedRecommendation, path: filenameMiddleVolume.path }));
    window.dispatchEvent(new StorageEvent('storage', { key: DAILY_RECOMMENDATION_STORAGE_KEY }));
    await until(() => eligiblePaths.includes(recommendedFile()?.path) && savedPath() !== filenameMiddleVolume.path,
        'A saved unread filename volume 3 must be replaced by a standalone book or volume 1');
    const selected = recommendedFile();
    readingStates.set(selected.path, { status: 'completed', scrollPercent: 100, updatedAt: daysAgo(0) });
    const remaining = volumeScenarioFiles.find(file => eligiblePaths.includes(file.path) && file.path !== selected.path);
    await restartDashboard(true);
    await until(() => recommendedFile()?.path === remaining.path, 'Both standalone books and explicit first volumes must be eligible');
    readingStates.set(remaining.path, { status: 'completed', scrollPercent: 100, updatedAt: daysAgo(0) });
    await restartDashboard(true);
    await until(() => recommendation()?.textContent.includes(t('reading_lists.dashboard_recommendation_empty')),
        'Unread middle volumes must not be recommended after all standalone and first-volume books are read');
    check(!recommendedFile() && !readingStates.has(metadataMiddleVolume.path) && !readingStates.has(filenameMiddleVolume.path),
        'Middle-volume exclusion must not depend on those books already being read');
    check(!previewPaths.slice(beforePreviews).some(filePath => [metadataMiddleVolume.path, filenameMiddleVolume.path].includes(filePath)),
        'Excluded middle volumes must not load recommendation previews');
    return { recommendationFirstVolumeOnly: true, recommendationSavedMiddleVolumeReplaced: true };
};
window.runDashboardEmptyTests = async () => {
    catalogFiles = [];
    recentFiles = [];
    mount();
    await until(() => !dashboard() && row(first), 'Registered empty-library fixture did not remount');
    await openDashboard();
    check(!dashboard().querySelector('.reading-dashboard-setup-glow'), 'An already registered library must not pulse its settings button');
    check(!dashboard().querySelector('.dashboard-onboarding'), 'An empty registered library must retain its regular dashboard');
    mount([]);
    await until(() => !dashboard() && row(first), 'Empty fixture did not remount');
    await openDashboard();
    check(!dashboard().textContent.includes(first.title), 'Empty dashboard retained a book from the previous library');
    check(dashboard().querySelector('.reading-dashboard-welcome button') && dashboard().textContent.includes(t('reading_lists.dashboard_setup_title')),
        'Unconfigured dashboard must explain library setup and offer a next action');
    const setupGlow = dashboard().querySelector('.reading-dashboard-setup-glow');
    check(setupGlow?.getAttribute('aria-hidden') === 'true', 'Library setup attention must be decorative');
    applyMotionPreference('full');
    await frames();
    const initialGlowOpacity = Number(getComputedStyle(setupGlow).opacity);
    await until(() => Math.abs(Number(getComputedStyle(setupGlow).opacity) - initialGlowOpacity) > 0.08, 'Library setup attention did not gently pulse');
    applyMotionPreference('reduced');
    await until(() => Math.abs(Number(getComputedStyle(setupGlow).opacity) - 0.45) < 0.01, 'Reduced motion did not replace the pulse with a static highlight');
    await frames(12);
    check(Math.abs(Number(getComputedStyle(setupGlow).opacity) - 0.45) < 0.01, 'Library setup kept pulsing after motion was reduced');
    verifyLayout();
    const beforeSettings = settingsRequests.length;
    dashboard().querySelector('.reading-dashboard-welcome button').click();
    await until(() => settingsRequests.length > beforeSettings, 'Empty-state action did not open library settings');
    check(settingsRequests.at(-1).tab === 'folder', 'Empty-state action opened the wrong settings tab');
    check(settingsRequests.at(-1).focus === 'library-setup', 'Setup action must open the guided library flow');
    const previousOnboarding = dashboard().querySelector('.dashboard-onboarding');
    mount([], '');
    await until(() => dashboard()?.querySelector('.dashboard-onboarding') && dashboard().querySelector('.dashboard-onboarding') !== previousOnboarding,
        'A fresh install must open the setup dashboard without sidebar navigation');
    await frames();
    verifyLayout();
    return { emptyState: true, librarySettingsOpened: true, firstRunOnboarding: true };
};
window.runDashboardSetupCompleteTest = async () => {
    catalogFiles = [...originalFiles];
    mount(['/fixture'], '', false);
    await until(() => dashboard()?.querySelector('.reading-dashboard-stat[data-stat="books"] strong')?.textContent === '4',
        'Saving the first library must load its catalog on the current dashboard');
    check(!dashboard().querySelector('.dashboard-onboarding, .reading-dashboard-setup-glow'), 'Setup must disappear after the first library is saved');
    verifyLayout();
    return { librarySetupCompleted: true };
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1600, height: 900, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', async (_event, level, message) => {
        if (level >= 2) console.error(message);
        if (message === 'DASHBOARD_KEY') {
            const input = await window.webContents.executeJavaScript('window.dashboardInput');
            window.webContents.focus();
            window.webContents.sendInputEvent({ type: 'keyDown', ...input });
            if (!input.modifiers?.length && input.keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', ...input });
            window.webContents.sendInputEvent({ type: 'keyUp', ...input });
            await window.webContents.executeJavaScript('window.continueDashboardInput()');
        }
        if (message === 'DASHBOARD_SHUFFLE_CAPTURE') {
            const name = await window.webContents.executeJavaScript('window.dashboardCaptureName');
            await capture(name);
            await window.webContents.executeJavaScript('window.continueDashboardCapture()');
        }
    });
    const captureDirectory = ${JSON.stringify(captureDirectory || null)};
    async function capture(name) {
        if (captureDirectory) await fs.writeFile(path.join(captureDirectory, name + '.png'), (await window.webContents.capturePage()).toPNG());
    }
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runDashboardTests()');
    if (${JSON.stringify(telemetryOnly)}) {
        await window.webContents.executeJavaScript('window.runDashboardTelemetryTests()');
        console.log('READING_DASHBOARD_RESULT=' + JSON.stringify({ menuTelemetry: true, recommendationBackgroundTelemetry: true }));
        app.exit(0);
        return;
    }
    await capture('dashboard-full-width-dark');
    window.setContentSize(1280, 900);
    await window.webContents.executeJavaScript('window.verifyDashboardLayout()');
    await capture('dashboard-wide-dark');
    window.setContentSize(800, 900);
    await window.webContents.executeJavaScript('window.verifyDashboardLayout()');
    await capture('dashboard-narrow-dark');
    window.setContentSize(1600, 900);
    const shuffle = await window.webContents.executeJavaScript('window.runDashboardShuffleTests()');
    for (const [width, height] of [[1600, 900], [800, 1200], [2400, 800]]) {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript('window.verifyDashboardShuffleCoverage()');
    }
    window.setContentSize(800, 900);
    const volumes = await window.webContents.executeJavaScript('window.runDashboardVolumeTests()');
    const empty = await window.webContents.executeJavaScript('window.runDashboardEmptyTests()');
    await capture('dashboard-empty-dark');
    window.setContentSize(1600, 900);
    await window.webContents.executeJavaScript('window.verifyDashboardLayout()');
    await capture('dashboard-setup-wide-dark');
    await window.webContents.executeJavaScript('window.previewDashboardSetupTheme("light")');
    await capture('dashboard-setup-wide-light');
    window.setContentSize(800, 900);
    await window.webContents.executeJavaScript('window.verifyDashboardLayout()');
    await capture('dashboard-setup-narrow-light');
    await window.webContents.executeJavaScript('window.previewDashboardSetupTheme("dark")');
    const setupComplete = await window.webContents.executeJavaScript('window.runDashboardSetupCompleteTest()');
    await window.webContents.executeJavaScript('window.runDashboardTelemetryTests()');
    console.log('READING_DASHBOARD_RESULT=' + JSON.stringify({ ...result, ...shuffle, ...volumes, ...empty, ...setupComplete, widths: [1600, 1280, 800] }));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Reading dashboard renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/READING_DASHBOARD_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), telemetryOnly ? { menuTelemetry: true, recommendationBackgroundTelemetry: true } : {
            hiddenFileActionsBlocked: true, recentBookOpened: true, keyboardNavigation: true, refreshed: true, overviewWaited: true, liveProgress: true,
            errorRecovered: true, recommendationOpened: true, recommendationStable: true, recommendationReadingStable: true, recommendationBackgroundStable: true, recommendationEligibility: true, recommendationRetry: true, recommendationLocalState: true,
            shuffleCancelled: true, shuffleCommitted: true, shuffleLanding: true, shuffleVariedOrigins: true, shuffleCoversStable: true, shuffleResizeStable: true, shuffleReducedMotion: true,
            recommendationFirstVolumeOnly: true, recommendationSavedMiddleVolumeReplaced: true,
            emptyState: true, librarySettingsOpened: true, firstRunOnboarding: true, librarySetupCompleted: true, widths: [1600, 1280, 800],
        });
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
