import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('오늘의 추천 슬라이드가 8권 탐색과 전체 재추천, 표지 모션, 자동 재생 중지 조건을 지킨다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'recommendation-carousel-render-')));
    const captureDirectory = process.env.BOOKMANAGER_CAROUSEL_CAPTURE_DIR;
    if (captureDirectory) await fs.mkdir(captureDirectory, { recursive: true });
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReadingDashboard } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/folder/ReadingDashboard.jsx')}`)};
import { DAILY_RECOMMENDATION_STORAGE_KEY, dailyRecommendationDay } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/dailyRecommendationState.js')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/FolderTab.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function frames(count = 3) { for (let index = 0; index < count; index += 1) await frame(); }
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) { if (predicate()) return; await frame(); }
    throw new Error(typeof message === 'function' ? message() : message);
}
const titles = ['오후의 책방', '낯선 도시를 걷다', '기억의 숲', '작은 정원의 계절', '어느 여행의 문장', '빛이 머무는 자리', '다시 읽는 이야기', '바다를 건너온 편지', '침묵의 도서관', '사라진 시간의 지도', '별과 밤의 기록', '푸른 새벽의 산책', '오래된 역의 풍경', '구름을 따라 걷다', '겨울 정원에서', '처음 만나는 마음', '다정한 오후', '여름 바람의 노래', '수요일의 창가', '우리 동네 도서관', '흐르는 강의 기억', '하늘을 읽는 사람', '노을이 머문 길', '밤의 작은 등불'];
const colors = ['#36586a', '#824c44', '#72724f', '#4f6554', '#635777', '#496d82'];
const files = titles.map((title, index) => {
    const filePath = '/fixture/entry-' + index + '.epub';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340"><rect width="240" height="340" fill="' + colors[index % colors.length] + '"/><circle cx="170" cy="115" r="65" fill="#edd7a5" opacity=".7"/><path d="M0 260L240 160V340H0Z" fill="#13252d" opacity=".8"/><text x="22" y="45" fill="#f8edd3" font-family="serif" font-size="15">READING JOURNAL</text><text x="22" y="302" fill="#f8edd3" font-family="sans-serif" font-size="24">BOOK ' + String(index + 1).padStart(2, '0') + '</text></svg>';
    return { path: filePath, full_path: filePath, name: 'entry-' + index + '.epub', title, writer: ['김서연', '박지우', '이하늘'][index % 3], ext: '.epub', size: 2048, exists: true, has_metadata: true, cover: 'data:image/svg+xml,' + encodeURIComponent(svg) };
});
const description = '기억에 남는 장면과 작은 발견을 담은 이야기. 책장을 넘길 때마다 조금씩 다른 풍경이 펼쳐집니다.';
const opened = [];
const coverRequests = [];
const telemetryEvents = [];
const refreshEvents = () => telemetryEvents.filter(event => event.event === 'feature_used' && event.feature === 'daily-recommendation-refresh');
const recentListeners = new Set();
window.electronAPI = {
    trackTelemetry: payload => { telemetryEvents.push(payload); },
    getReadingStates: async () => [],
    getFilePreview: async filePath => ({ success: true, file: { ...files.find(file => file.path === filePath), description } }),
    loadMetadataCover: async filePath => { coverRequests.push(filePath); return files.find(file => file.path === filePath)?.cover || ''; },
    onRecentReadingChanged: callback => { recentListeners.add(callback); return () => recentListeners.delete(callback); },
    readingLists: async request => ({ success: true, month: request.month, days: [], totals: { seconds: 0, readingDays: 0, completedBooks: 0 }, goal: { books: 0, minutes: 0 }, completedFiles: [], completedCount: 0 }),
};
const nativeTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
const slideTimers = new Map();
let nextSlideTimer = -1;
window.setTimeout = (callback, delay, ...args) => {
    if (delay !== 7000) return nativeTimeout(callback, delay, ...args);
    const id = nextSlideTimer--;
    slideTimers.set(id, () => callback(...args));
    return id;
};
window.clearTimeout = id => {
    if (!slideTimers.delete(id)) nativeClearTimeout(id);
};
let visibility = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const root = createRoot(document.getElementById('root'));
let mountKey = 0;
function render(catalog = files, reset = true) {
    if (reset) {
        localStorage.removeItem(DAILY_RECOMMENDATION_STORAGE_KEY);
        if (catalog.length) localStorage.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, JSON.stringify({ version: 1, day: dailyRecommendationDay(), path: catalog[0].path, previousPath: '', seed: 13 }));
    }
    mountKey += 1;
    root.render(<div className="folder-tab"><ReadingDashboard key={mountKey} t={t} files={catalog} libraries={['/fixture']}
        annotationCatalog={{ entries: [], errors: [] }} onOpenFile={file => opened.push(file.path || file.full_path)} /></div>);
}
const card = () => document.querySelector('.reading-dashboard-recommendation');
const select = suffix => card()?.querySelector('.reading-dashboard-recommendation-' + suffix);
const dots = () => [...card().querySelectorAll('.reading-dashboard-recommendation-dot')];
const selectedIndex = () => dots().findIndex(button => button.getAttribute('aria-current') === 'true');
const currentPath = () => card()?.dataset.filePath;
async function ready(count = 8) {
    await until(() => currentPath() && dots().length === count, 'Expected ' + count + ' recommendation slides');
    await frames();
}
async function go(index) {
    dots()[index].click();
    await until(() => selectedIndex() === index, 'Dot did not select slide ' + index);
    await frames();
}
async function moveMouse(element, horizontal = 0.5, vertical = 0.5) {
    const bounds = element?.getBoundingClientRect();
    await new Promise((resolve, reject) => {
        const timeout = nativeTimeout(() => reject(new Error('Native mouse input did not finish')), 8000);
        window.carouselInput = { type: 'mouseMove', x: bounds ? Math.round(bounds.left + bounds.width * horizontal) : 1, y: bounds ? Math.round(bounds.top + bounds.height * vertical) : 1 };
        window.continueCarouselInput = () => { nativeClearTimeout(timeout); resolve(); };
        console.log('CAROUSEL_INPUT');
    });
    await frames();
}
async function captureCover(name) {
    if (!${Boolean(captureDirectory)}) return;
    await until(() => {
        const image = select('cover')?.querySelector('img');
        if (!image?.complete || !image.naturalWidth) return false;
        const bounds = image.getBoundingClientRect();
        return image.src.startsWith('blob:') || Math.max(bounds.width * devicePixelRatio / image.naturalWidth,
            bounds.height * devicePixelRatio / image.naturalHeight) >= 1;
    }, 'Cover resampling did not settle before capture');
    await new Promise((resolve, reject) => {
        const timeout = nativeTimeout(() => reject(new Error('Cover capture did not finish')), 8000);
        window.carouselCaptureName = name;
        window.continueCarouselCapture = () => { nativeClearTimeout(timeout); resolve(); };
        console.log('CAROUSEL_CAPTURE');
    });
}
function coverMatrix() {
    const value = getComputedStyle(select('cover').querySelector('.reading-dashboard-cover')).transform;
    return new DOMMatrixReadOnly(value === 'none' ? undefined : value);
}
function verifyLayout() {
    const dashboard = document.querySelector('.reading-dashboard');
    check(dashboard.scrollWidth <= dashboard.clientWidth + 1, 'Dashboard overflows horizontally');
    const bounds = card().getBoundingClientRect();
    check(bounds.left >= -1 && bounds.right <= innerWidth + 1, 'Recommendation card escapes the viewport');
    for (const button of card().querySelectorAll('button')) {
        const rect = button.getBoundingClientRect();
        check(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, 'Recommendation control escapes its card: ' + button.className);
    }
}
window.runCarouselNavigationTests = async () => {
    applyMotionPreference('reduced');
    render();
    await ready();
    check(currentPath() === files[0].path, 'Existing same-day recommendation was not preserved');
    check(selectedIndex() === 0 && select('position').textContent.replace(/\\s/g, '') === '1/8', 'Initial slide position is incorrect');
    const order = [];
    for (let index = 0; index < 8; index += 1) {
        await go(index);
        order.push(currentPath());
        select('read').click();
        const openedCount = opened.length;
        select('cover-trigger').click();
        await until(() => document.querySelector('.detail-cover-preview-dialog')?.open && coverRequests.at(-1) === order[index], 'Cover did not preview the selected slide');
        check(opened.length === openedCount && opened.at(-1) === order[index], 'Cover must preview its image while Read opens the selected book');
        document.querySelector('.detail-cover-preview-close').click();
        await until(() => !document.querySelector('.detail-cover-preview-dialog'), 'Slide cover preview did not close');
        check(document.activeElement === select('cover-trigger'), 'Cover preview did not restore focus');
    }
    check(new Set(order).size === 8, 'Carousel repeats a book');
    check(getComputedStyle(select('cover-trigger')).cursor === 'zoom-in', 'Recommendation cover must use the detail-panel zoom cursor');
    const openedBeforePreviewNavigation = opened.length;
    select('cover-trigger').click();
    await until(() => document.querySelector('.detail-cover-preview-dialog')?.open, 'Navigation preview did not open');
    const previewDialog = document.querySelector('.detail-cover-preview-dialog');
    const expectPreview = async index => {
        await until(() => currentPath() === order[index] && coverRequests.at(-1) === order[index]
            && previewDialog.querySelector('.detail-cover-preview-image')?.alt === files.find(file => file.path === order[index]).title,
        'Preview navigation did not load the selected recommendation');
        check(document.querySelector('.detail-cover-preview-dialog') === previewDialog && previewDialog.open, 'Navigation replaced or closed the preview dialog');
        check(opened.length === openedBeforePreviewNavigation, 'Preview navigation opened the reader');
    };
    previewDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await expectPreview(0);
    previewDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await expectPreview(7);
    previewDialog.querySelector('.detail-cover-preview-prev').click();
    await expectPreview(6);
    previewDialog.querySelector('.detail-cover-preview-next').click();
    await expectPreview(7);
    previewDialog.querySelector('.detail-cover-preview-close').click();
    await until(() => !document.querySelector('.detail-cover-preview-dialog'), 'Navigated preview did not close');
    check(document.activeElement === select('cover-trigger'), 'Navigated preview did not restore the current cover focus');
    select('next').click();
    await until(() => selectedIndex() === 0 && currentPath() === order[0], 'Next did not wrap from the last slide');
    select('prev').click();
    await until(() => selectedIndex() === 7 && currentPath() === order[7], 'Previous did not wrap from the first slide');
    const readButton = select('read');
    readButton.focus();
    readButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await until(() => selectedIndex() === 0 && currentPath() === order[0], 'Arrow key did not move to the next slide');
    check(select('read') === readButton && document.activeElement === readButton, 'Keyboard navigation replaced or lost the focused read button');
    readButton.blur();
    render(files, false);
    await ready();
    for (let index = 0; index < 8; index += 1) {
        await go(index);
        check(currentPath() === order[index], 'Same-day remount reordered the recommendation list');
    }
    await go(0);
    check(slideTimers.size === 0, 'Reduced motion scheduled automatic slides');
    await moveMouse(select('cover-trigger'));
    const reduced = coverMatrix();
    check(Math.abs(reduced.m11 - 1) < 0.001 && Math.abs(reduced.m22 - 1) < 0.001 && Math.abs(reduced.m13) < 0.001, 'Reduced motion moved or rotated the cover');
    await moveMouse(null);
    verifyLayout();
    check(refreshEvents().length === 0, 'Loading, manual navigation or remounting tracked a recommendation refresh');
    return { eightUniqueBooks: true, navigation: true, keyboardFocusPreserved: true, correctBookOpened: true, stableDailyOrder: true, reducedMotion: true };
};
window.runCarouselMotionTests = async () => {
    applyMotionPreference('full');
    document.activeElement?.blur();
    await moveMouse(null);
    await until(() => slideTimers.size === 1, 'Full motion did not schedule automatic slides');
    const beforeAuto = currentPath();
    const [timerId, callback] = [...slideTimers.entries()][0];
    slideTimers.delete(timerId);
    callback();
    await until(() => currentPath() !== beforeAuto, 'Automatic advance did not change the book');
    await until(() => slideTimers.size === 1, 'Automatic advance did not schedule the next slide');
    select('playback').click();
    await until(() => slideTimers.size === 0, 'Pause did not clear automatic advance');
    check(select('playback').getAttribute('aria-pressed') === 'true', 'Pause state is not exposed accessibly');
    select('playback').click();
    await until(() => slideTimers.size === 1, 'Resume did not restore automatic advance');
    select('playback').focus();
    await until(() => slideTimers.size === 0, 'Playback button focus did not pause automatic advance');
    applyMotionPreference('reduced');
    await until(() => !select('playback'), 'Reduced motion did not remove the focused playback button');
    applyMotionPreference('full');
    await until(() => slideTimers.size === 1, 'Removing the focused playback button left automatic advance paused');
    select('read').focus();
    await until(() => slideTimers.size === 0, () => 'Keyboard focus did not pause automatic advance: ' + JSON.stringify({ active: document.activeElement?.className, documentFocused: document.hasFocus(), timers: slideTimers.size }));
    document.activeElement.blur();
    await until(() => slideTimers.size === 1, 'Leaving keyboard focus did not resume automatic advance');
    card().querySelector('.reading-dashboard-preferences-button').click();
    await until(() => document.querySelector('.recommendation-preferences')?.open && slideTimers.size === 0, 'Preferences did not pause automatic advance');
    check(document.querySelector('.recommendation-preferences-current strong')?.textContent === files.find(file => file.path === currentPath()).title, 'Preferences targeted a different slide');
    document.querySelector('.recommendation-preferences-close').click();
    await until(() => !document.querySelector('.recommendation-preferences'), 'Preferences did not close');
    await frames();
    document.activeElement?.blur();
    await until(() => slideTimers.size === 1, 'Closing preferences did not resume automatic advance');
    const previewedPath = currentPath();
    select('cover-trigger').click();
    await until(() => document.querySelector('.detail-cover-preview-dialog')?.dataset.phase === 'open' && slideTimers.size === 0, 'Cover preview did not pause automatic advance');
    check(currentPath() === previewedPath && coverRequests.at(-1) === previewedPath, 'Cover preview changed the active recommendation');
    document.querySelector('.detail-cover-preview-close').click();
    await until(() => !document.querySelector('.detail-cover-preview-dialog'), 'Animated cover preview did not close');
    check(document.activeElement === select('cover-trigger'), 'Animated preview did not restore cover focus');
    document.activeElement.blur();
    await until(() => slideTimers.size === 1, 'Closing cover preview did not resume automatic advance after focus left');
    const checkStableCoverTarget = () => {
        const button = select('cover-trigger');
        const artwork = select('cover').querySelector('.reading-dashboard-cover');
        check(button.parentElement === artwork.parentElement.parentElement && !button.contains(artwork), 'Cover artwork and preview button must be separate siblings');
        const buttonStyle = getComputedStyle(button);
        check(buttonStyle.transform === 'none' && buttonStyle.perspective === 'none', 'Cover motion must not transform the pointer target');
        check(getComputedStyle(artwork.parentElement).perspective === '700px', 'Cover artwork must retain its 3D perspective');
        check(getComputedStyle(artwork).pointerEvents === 'none', 'Animated artwork must not intercept pointer input');
    };
    const coverIsEngaged = () => {
        const matrix = coverMatrix();
        return Math.abs(matrix.m11 - 1.035) < 0.001 && Math.abs(matrix.m22 - 1.035) < 0.001 && Math.abs(matrix.m13) < 0.001;
    };
    await until(() => {
        const matrix = coverMatrix();
        const angle = 12 * Math.PI / 180;
        return Math.abs(matrix.m11 - Math.cos(angle)) < 0.001 && Math.abs(matrix.m22 - 1) < 0.001
            && Math.abs(matrix.m13 - Math.sin(angle)) < 0.001;
    }, 'Resting cover did not return to its 3D angle without scaling');
    checkStableCoverTarget();
    await captureCover('recommendation-cover-rest');
    await moveMouse(select('cover-trigger'));
    await until(() => slideTimers.size === 0, 'Hover did not pause automatic advance');
    await until(coverIsEngaged, 'Hovered cover did not face forward and enlarge');
    checkStableCoverTarget();
    const hoveredCover = select('cover-trigger');
    const hoveredBounds = hoveredCover.getBoundingClientRect();
    const hoveredTarget = document.elementFromPoint(hoveredBounds.left + hoveredBounds.width / 2, hoveredBounds.top + hoveredBounds.height / 2);
    check(hoveredTarget === hoveredCover, 'The preview button must receive pointer input instead of its transformed artwork');
    check(getComputedStyle(hoveredTarget).cursor === 'zoom-in', 'The actual hovered target must use the zoom cursor');
    await until(() => window.carouselCursor === 'zoom-in', () => 'Chromium cursor did not switch to zoom-in: ' + window.carouselCursor);
    check(!hoveredCover.hasAttribute('title') && !select('cover').querySelector('[title], [data-tooltip]'), 'Recommendation cover must not show a tooltip');
    check(getComputedStyle(hoveredCover).perspective === 'none', 'Perspective must belong to artwork rather than the hit target');
    for (let pass = 0; pass < 2; pass += 1) {
        await moveMouse(null);
        await until(() => window.carouselCursor !== 'zoom-in', 'Leaving the cover must restore the outside cursor');
        for (const [x, y] of [[0.05, 0.5], [0.5, 0.5], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.5, 0.1], [0.5, 0.5]]) {
            await moveMouse(hoveredCover, x, y);
            const point = window.carouselInput;
            check(document.elementFromPoint(point.x, point.y) === hoveredCover, 'Artwork intercepted pointer input at ' + x + ',' + y);
            check(window.carouselCursor === 'zoom-in', 'Chromium cursor changed inside the cover at ' + x + ',' + y + ': ' + window.carouselCursor);
            checkStableCoverTarget();
        }
        await until(coverIsEngaged, 'Moving inside the cover interrupted its hover motion');
    }
    await captureCover('recommendation-cover-hover');
    applyMotionPreference('reduced');
    await until(() => {
        const matrix = coverMatrix();
        return Math.abs(matrix.m11 - 1) < 0.001 && Math.abs(matrix.m22 - 1) < 0.001 && Math.abs(matrix.m13) < 0.001;
    }, 'Enabling reduced motion mid-hover left a transformed cover');
    check(slideTimers.size === 0, 'Reduced motion kept automatic advance running');
    await moveMouse(null);
    applyMotionPreference('full');
    await until(() => slideTimers.size === 1, 'Full motion did not resume after reduced motion');
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => slideTimers.size === 0, 'Hidden document kept automatic advance running');
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => slideTimers.size === 1, 'Visible document did not resume automatic advance');
    select('playback').click();
    await until(() => slideTimers.size === 0, 'Final pause did not clear the timer');
    await until(() => Number(getComputedStyle(select('slide')).opacity) > 0.999, 'Slide transition did not settle');
    verifyLayout();
    check(refreshEvents().length === 0, 'Automatic slides or playback controls tracked a recommendation refresh');
    return { automaticAdvance: true, playbackControl: true, hoverAndFocusPause: true, preferencesPause: true, coverHover: true, visibilityPause: true };
};
window.verifyCarouselLayout = async () => { await frames(5); verifyLayout(); };
window.runCarouselShuffleTests = async () => {
    applyMotionPreference('reduced');
    render();
    await ready();
    const previousOrder = [];
    for (let index = 0; index < 8; index += 1) {
        await go(index);
        previousOrder.push(currentPath());
    }
    await go(4);
    const previousPath = currentPath();
    const previousRecord = localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY);
    const trigger = select('shuffle');
    trigger.focus();
    trigger.click();
    const expectedRefreshEvents = [{ event: 'feature_used', feature: 'daily-recommendation-refresh', source: 'navigation' }];
    check(JSON.stringify(refreshEvents()) === JSON.stringify(expectedRefreshEvents), 'One shuffle click must track exactly one recommendation refresh');
    const overlay = () => document.querySelector('.recommendation-shuffle-overlay');
    await until(() => overlay()?.open, 'New recommendation did not open its shuffle overlay');
    check(currentPath() === previousPath && localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY) === previousRecord,
        'Shuffle changed the list before its confirmation animation');
    await until(() => !overlay() && selectedIndex() === 0 && currentPath() !== previousPath,
        'Shuffle did not finish on the first book of its new list');
    check(dots().length === 8 && select('position').textContent.replace(/\\s/g, '') === '1/8', 'Shuffle did not rebuild eight recommendation slides');
    check(document.activeElement === trigger, 'Shuffle did not restore focus to its trigger');
    const committed = JSON.parse(localStorage.getItem(DAILY_RECOMMENDATION_STORAGE_KEY));
    check(committed.paths.length === 8 && new Set(committed.paths).size === 8, 'Shuffle saved an incomplete or duplicated recommendation list');
    check(committed.paths.every(filePath => !previousOrder.includes(filePath)), 'Shuffle retained previous recommendations despite enough fresh candidates');
    check(committed.path === committed.paths[0] && currentPath() === committed.paths[0], 'Shuffle did not save the new first slide');
    for (let index = 0; index < 8; index += 1) {
        await go(index);
        check(currentPath() === committed.paths[index], 'Shuffled slides differ from the stored list');
    }
    await go(0);
    const previousCard = card();
    render(files, false);
    await until(() => card() && card() !== previousCard, 'Shuffled dashboard did not remount');
    await ready();
    check(selectedIndex() === 0 && currentPath() === committed.paths[0], 'Reopening lost the first shuffled slide');
    for (let index = 0; index < 8; index += 1) {
        await go(index);
        check(currentPath() === committed.paths[index], 'Reopening changed the shuffled recommendation list');
    }
    check(JSON.stringify(refreshEvents()) === JSON.stringify(expectedRefreshEvents), 'Shuffle completion, slide navigation or remounting tracked an extra recommendation refresh');
    return { entireListShuffled: true, shuffledFirstSlide: true, shuffledListRestored: true };
};
window.runCarouselSmallCatalogTests = async () => {
    applyMotionPreference('reduced');
    render(files.slice(0, 3));
    await ready(3);
    check(select('position').textContent.replace(/\\s/g, '') === '1/3', 'Small catalog used a misleading total');
    render(files.slice(0, 1));
    await until(() => currentPath() === files[0].path && (!select('next') || select('next').disabled), 'Single-book catalog retained active navigation');
    check(!select('prev') || select('prev').disabled, 'Single-book catalog kept previous navigation enabled');
    check(!select('playback') || select('playback').disabled, 'Single-book catalog kept autoplay enabled');
    select('cover-trigger').click();
    await until(() => document.querySelector('.detail-cover-preview-dialog')?.open, 'Single-book preview did not open');
    check(!document.querySelector('.detail-cover-preview-nav'), 'Single-book preview must not expose navigation');
    document.querySelector('.detail-cover-preview-close').click();
    await until(() => !document.querySelector('.detail-cover-preview-dialog'), 'Single-book preview did not close');
    check(slideTimers.size === 0, 'Single-book catalog scheduled automatic advance');
    render([]);
    await until(() => card() && !currentPath() && card().textContent.includes(t('reading_lists.dashboard_recommendation_empty')), 'Empty catalog retained a recommendation');
    check(!select('read') && !select('cover-trigger') && dots().length === 0, 'Empty catalog retained book actions');
    verifyLayout();
    return { smallCatalog: true, singleBook: true, emptyCatalog: true };
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>html,body,#root,.folder-tab{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
console.log('CAROUSEL_STAGE=bootstrap');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
if (${JSON.stringify(process.env.BOOKMANAGER_RENDERER_GPU !== '1')}) app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    console.log('CAROUSEL_STAGE=ready');
    const window = new BrowserWindow({ show: false, width: 1200, height: 900, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('cursor-changed', (_event, type) => {
        void window.webContents.executeJavaScript('window.carouselCursor = ' + JSON.stringify(type));
    });
    window.webContents.on('console-message', async (_event, level, message) => {
        if (level >= 2) console.error(message);
        if (message === 'CAROUSEL_INPUT') {
            const input = await window.webContents.executeJavaScript('window.carouselInput');
            window.webContents.sendInputEvent(input);
            await window.webContents.executeJavaScript('window.continueCarouselInput()');
        }
        if (message === 'CAROUSEL_CAPTURE') {
            const name = await window.webContents.executeJavaScript('window.carouselCaptureName');
            await capture(name, true);
            await window.webContents.executeJavaScript('window.continueCarouselCapture()');
        }
    });
    async function capture(name, coverOnly = false) {
        const captureDirectory = ${JSON.stringify(captureDirectory || null)};
        if (!captureDirectory) return;
        const bounds = coverOnly ? await window.webContents.executeJavaScript('(() => { const bounds = document.querySelector(".reading-dashboard-recommendation-cover").getBoundingClientRect(); return { x: Math.floor(bounds.x - 20), y: Math.floor(bounds.y - 20), width: Math.ceil(bounds.width + 40), height: Math.ceil(bounds.height + 40) }; })()') : undefined;
        await fs.writeFile(path.join(captureDirectory, name + '.png'), (await window.webContents.capturePage(bounds)).toPNG());
    }
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    window.webContents.focus();
    console.log('CAROUSEL_STAGE=loaded');
    const navigation = await window.webContents.executeJavaScript('window.runCarouselNavigationTests()');
    console.log('CAROUSEL_STAGE=navigation');
    const motion = await window.webContents.executeJavaScript('window.runCarouselMotionTests()');
    await capture('recommendation-carousel-wide');
    window.setContentSize(520, 900);
    await window.webContents.executeJavaScript('window.verifyCarouselLayout()');
    await capture('recommendation-carousel-narrow');
    window.setContentSize(320, 900);
    await window.webContents.executeJavaScript('window.verifyCarouselLayout()');
    window.setContentSize(1200, 900);
    const shuffle = await window.webContents.executeJavaScript('window.runCarouselShuffleTests()');
    window.setContentSize(320, 900);
    const small = await window.webContents.executeJavaScript('window.runCarouselSmallCatalogTests()');
    console.log('RECOMMENDATION_CAROUSEL_RESULT=' + JSON.stringify({ ...navigation, ...motion, ...shuffle, ...small, widths: [1200, 520, 320] }));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Recommendation carousel renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/RECOMMENDATION_CAROUSEL_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), {
            eightUniqueBooks: true, navigation: true, keyboardFocusPreserved: true, correctBookOpened: true, stableDailyOrder: true, reducedMotion: true,
            automaticAdvance: true, playbackControl: true, hoverAndFocusPause: true, preferencesPause: true, coverHover: true, visibilityPause: true,
            entireListShuffled: true, shuffledFirstSlide: true, shuffledListRestored: true,
            smallCatalog: true, singleBook: true, emptyCatalog: true, widths: [1200, 520, 320],
        });
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
