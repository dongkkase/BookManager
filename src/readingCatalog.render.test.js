import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('저자와 주석은 리스트 패널에서 탐색·프로필 선택·필터·키보드 열기를 제공한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reading-catalog-render-')));
    const captureDirectory = process.env.BOOKMANAGER_CATALOG_CAPTURE_DIR;
    if (captureDirectory) await fs.mkdir(captureDirectory, { recursive: true });
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { TooltipLayer } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/TooltipLayer.jsx')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { HIGHLIGHT_COLORS } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/highlightColors.js')}`)};
import { authorKey } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/authorCatalog.js')}`)};
import { AUTOMATIC_AUTHOR_PROFILES_KEY } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/authorProfileStore.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const check = (condition, message) => { if (!condition) throw new Error(message); };
function measureResponsiveness(isProcessing = () => false) {
    const started = performance.now();
    let previous = started;
    let frameCount = 0;
    let processingFrames = 0;
    let maximumFrameGap = 0;
    let frameRequest = 0;
    const longTasks = [];
    const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
        ? new PerformanceObserver(list => longTasks.push(...list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });
    const sample = now => {
        maximumFrameGap = Math.max(maximumFrameGap, now - previous);
        previous = now;
        frameCount += 1;
        if (isProcessing()) processingFrames += 1;
        frameRequest = requestAnimationFrame(sample);
    };
    frameRequest = requestAnimationFrame(sample);
    return () => {
        cancelAnimationFrame(frameRequest);
        if (observer) longTasks.push(...observer.takeRecords());
        observer?.disconnect();
        return {
            elapsedMs: Math.round(performance.now() - started), frameCount, processingFrames,
            maximumFrameGapMs: Math.round(maximumFrameGap), longTaskCount: longTasks.length,
            longestTaskMs: Math.round(Math.max(0, ...longTasks.map(entry => entry.duration))),
        };
    };
}
async function until(predicate, message) {
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) { if (predicate()) return; await frame(); }
    throw new Error(message);
}
const longAuthorName = '가까운 서점과 도서관에서 만나는 아주 긴 이름의 작가 Alexandre de la Bibliothèque';
const names = ['김초엽', '김영하', '김금희', '김연수', '김애란', '박완서', '백수린', longAuthorName, '손원평', '양귀자', '장강명', '정세랑', '최은영', '한강', '황정은', 'Agatha Christie', 'Albert Camus', 'Bora Chung', 'Jane Austen', 'Jorge Luis Borges', 'Virginia Woolf'];
const titles = ['우리가 빛의 속도로 갈 수 없다면', '오직 두 사람', '경애의 마음', '파도가 바다의 일이라면', '바깥은 여름', '그 많던 싱아는 누가 다 먹었을까', '눈부신 안부', '여름의 문장', '아몬드', '모순', '한국이 싫어서', '보건교사 안은영', '내게 무해한 사람', '흰', '계속해보겠습니다', 'And Then There Were None', 'The Stranger', 'Cursed Bunny', 'Pride and Prejudice', 'Ficciones', 'A Room of One’s Own'];
let files = names.map((writer, index) => ({
    path: '/fixture/book-' + index + '.epub', full_path: '/fixture/book-' + index + '.epub', name: titles[index] + '.epub',
    title: titles[index], writer, author: writer, ext: '.epub', size: 3000, readingListAddedAt: new Date(2026, 9, 25 - index).toISOString(),
    cover: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="290"><rect width="200" height="290" fill="hsl(' + index * 37 + ',25%,35%)"/><path d="M-20 180Q80 30 220 150V300H0" fill="hsl(' + index * 37 + ',35%,60%)"/><text x="18" y="40" fill="white" font-size="14">' + writer + '</text><text x="18" y="75" fill="white" font-size="11">BOOKMANAGER LIBRARY</text></svg>'),
}));
const quote = '우리는 같은 문장을 읽고도 서로 다른 풍경을 떠올린다. 책을 덮은 뒤에도 오래 남는 것은, 정답보다 그 문장 곁에서 잠시 머물렀던 마음이다.';
const longQuote = '빛을 향해 떠나는 사람들의 이야기. ' + quote.repeat(12);
files[1] = { ...files[1], writer: '김영하, 김초엽', author: '김영하, 김초엽',
    title: '추방당한 공작 영애 빌헬미나가 행복해질 때까지 01권 — 아주 긴 도서 제목도 목록에서 읽을 수 있어야 합니다',
    series: '추방당한 공작 영애 빌헬미나가 행복해질 때까지',
    cover: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e4eae5"/><text x="100" y="135" text-anchor="middle" font-family="sans-serif" font-size="130" fill="#283e38">3</text><text x="100" y="180" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#283e38">BOOKMANAGER</text></svg>') };
files.slice(0, 10).forEach((file, index) => localStorage.setItem('bookmanager-viewer-highlights:' + file.path, JSON.stringify([
    { id: 'mark-' + index, text: index === 0 ? longQuote : quote, pageIndex: index * 4, color: ['blue', 'yellow', 'green', 'pink', 'purple'][index % 5], createdAt: (index < 3 ? new Date(2026, 9, 25, 23 - index * 11, 30) : new Date(2026, 9, 25 - index)).toISOString() },
])));
const opened = [];
const copiedQuotes = [];
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copiedQuotes.push(text); } } });
const apiQueries = [];
const profileOptions = [];
const profilePhotoSaves = [];
const profilePhotoConfirmations = [];
let failNextProfilePhotoSave = false;
let allowMissingProfilePhoto = false;
let releaseFirstProfile;
const firstProfileGate = new Promise(resolve => { releaseFirstProfile = resolve; });
const photoQueries = [];
const photoSelections = [];
let naverConfigured = false;
let releasedPhotoSearches = 0;
let photoSelectionGate = null;
const photoCanvas = document.createElement('canvas');
photoCanvas.width = 80; photoCanvas.height = 80;
const photoContext = photoCanvas.getContext('2d');
photoContext.fillStyle = '#577f80'; photoContext.fillRect(0, 0, 80, 80);
const previewPhotoDataUrl = photoCanvas.toDataURL('image/png');
const requests = [];
const previewQueries = [];
let highlightReads = 0;
const getStorageItem = Storage.prototype.getItem;
Storage.prototype.getItem = function(key) {
    if (String(key).startsWith('bookmanager-viewer-highlights:')) highlightReads += 1;
    return getStorageItem.call(this, key);
};
let changed;
let catalogResponseGate = null;
let catalogResponses = 0;
window.electronAPI = {
    showMessage: async options => { profilePhotoConfirmations.push(options); return 'yes'; },
    saveAuthorProfilePhoto: async profile => {
        profilePhotoSaves.push(profile);
        if (failNextProfilePhotoSave && profile.id === 'wikipedia:ko:12345' || profile.id === 'OL404A' && !allowMissingProfilePhoto) {
            if (profile.id === 'wikipedia:ko:12345') failNextProfilePhotoSave = false;
            return { success: false, code: 'AUTHOR_PHOTO_STORAGE_FAILED' };
        }
        return { success: true, dataUrl: previewPhotoDataUrl, photo: { id: (profile.provider === 'wikipedia' ? 'd' : 'c').repeat(64), sourceUrl: profile.photoUrl } };
    },
    searchAuthorPhotos: async request => {
        photoQueries.push(request);
        if (!naverConfigured) return { success: false, code: 'AUTHOR_PHOTO_MISSING_KEYS' };
        return { success: true, results: [{ id: request.start === 1 ? 'photo-1' : 'photo-2', title: '작가 인터뷰 사진', width: 480, height: 640 }], hasNext: request.start === 1, nextStart: 21 };
    },
    previewAuthorPhoto: async () => ({ success: true, dataUrl: previewPhotoDataUrl }),
    selectAuthorPhoto: async request => {
        photoSelections.push(request);
        if (photoSelectionGate) await photoSelectionGate;
        return { success: true, dataUrl: previewPhotoDataUrl, photo: { id: (request.candidateId === 'photo-1' ? 'a' : 'b').repeat(64), sourceUrl: 'https://example.org/author.jpg', query: photoQueries.at(-1).query } };
    },
    releaseAuthorPhotos: async () => { releasedPhotoSearches += 1; return { success: true }; },
    getRoots: async () => [], getSpecialPaths: async () => ({}), getReadingStates: async () => [],
    listRecentReading: async () => [], getLibraryScanStates: async () => ({}),
    getLibraryFolderChildren: async () => [], stat: async () => ({ isDirectory: true }), readDir: async () => [], scanFolder: async () => [],
    onReadingListsChanged: callback => { changed = callback; return () => {}; },
    readingLists: async request => {
        requests.push(request);
        if (request.operation === 'overview') return { success: true, collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0 };
        if (request.id !== 'library-catalog') return { success: true, files: [] };
        if (catalogResponseGate) await catalogResponseGate;
        const clonedFiles = structuredClone(files);
        catalogResponses += 1;
        return { success: true, files: clonedFiles };
    },
    openInternalViewer: async filePath => { opened.push(filePath); return { success: true }; },
    getFilePreview: async filePath => {
        previewQueries.push(filePath);
        const file = files.find(item => item.path === filePath);
        return { success: true, file: { ...file, publisher: '테스트 출판사', isbn: '9781234567890', description: '선택한 책의 상세 설명입니다.' } };
    },
    openInExplorer: async () => { throw new Error('Catalog Enter must not open the previous folder'); },
    searchAuthorProfiles: async (name, options) => {
        apiQueries.push(name);
        profileOptions.push(options);
        if (apiQueries.length === 1) await firstProfileGate;
        if (name === '김애란') return { success: true, profiles: [] };
        if (name === '김연수') return { success: false, profiles: [] };
        const wikimediaProfile = {
            provider: options?.allSources ? 'wikipedia' : 'wikidata',
            id: options?.allSources ? 'wikipedia:ko:12345' : 'Q12345', entityId: 'Q12345', name,
            topWork: '우리가 빛의 속도로 갈 수 없다면', description: '대한민국의 소설가',
            photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Author.jpg',
            imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Author.jpg', imageArtist: 'Test photographer', imageLicense: 'CC BY-SA 4.0',
        };
        if (name === '김초엽' && !options?.allSources) return { success: true, profiles: [wikimediaProfile] };
        if (name === longAuthorName) return { success: true, profiles: [{ ...wikimediaProfile, birthDate: '1987-03-11',
            description: '여러 나라의 도서관과 서점을 여행하며 사람들의 이야기를 기록하는 소설가. 긴 소개와 이름도 좁은 상세 패널 안에서 겹치거나 잘리지 않고 읽을 수 있어야 합니다.' }] };
        return { success: true, profiles: [
            { id: name === '김금희' ? 'OL404A' : 'OL123A', name, topWork: '우리가 빛의 속도로 갈 수 없다면', birthDate: '1993' },
            ...(options?.allSources ? [wikimediaProfile] : []),
        ] };
    },
};
const root = createRoot(document.getElementById('root'));
root.render(<><FolderTab config={{ libraries: ['/fixture'], folder_view_mode: 'table', language: 'ko' }} t={t} saveConfig={async () => {}} showToast={() => {}} /><TooltipLayer /></>);
const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text
    || item.getAttribute('aria-label') === text || item.querySelector('.recent-reading-list-main')?.textContent.trim() === text);
const badge = label => button(label, document.querySelector('.sidebar-container'))?.querySelector('.recent-reading-count')?.textContent;
const statusText = () => document.querySelector('.right-bottom-bar .status-info')?.textContent.trim();
function checkCatalogFooter(expected) {
    const footer = document.querySelector('.right-bottom-bar');
    check(footer && statusText() === expected, 'Catalog totals missing from the existing bottom bar: ' + statusText());
    check(!footer.querySelector('.view-controls > .view-icon-btn, .scale-label, .scale-slider, .view-controls-divider'), 'Catalog bottom bar must hide file view modes and item size');
    check(footer.querySelectorAll('.folder-detail-position-button').length === 2, 'Catalog bottom bar must preserve detail position controls');
}
function checkAnnotationToolbar() {
    const controls = document.querySelector('.right-toolbar-left .annotations-toolbar-controls');
    check(controls && document.querySelectorAll('.annotations-toolbar-controls').length === 1, 'Annotation controls must appear once in the existing top toolbar');
    check(controls.querySelector('button[aria-haspopup="menu"][aria-label="주석 묶기"]') && controls.querySelector('button[aria-haspopup="menu"][aria-label="주석 정렬"]') && controls.querySelector('.annotations-density'), 'Top toolbar must contain grouping, sorting and compact view controls');
    check(!document.querySelector('.annotations-feed .annotations-toolbar, .annotations-feed .annotations-toolbar-controls'), 'Annotation feed must not keep a separate toolbar row');
    return controls;
}
function checkAnnotationDates() {
    const dayFormatter = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' });
    for (const group of document.querySelectorAll('.annotations-month')) {
        let previousDay;
        for (const entry of group.querySelectorAll('article.annotation-entry')) {
            const date = entry.querySelector(':scope > .annotation-date');
            const card = entry.querySelector(':scope > .annotation-card');
            const bookTitle = (card.querySelector('.annotation-book-link strong') || group.querySelector('h3 .annotation-book-link strong'))?.textContent;
            const file = files.find(item => item.title === bookTitle);
            check(file, 'Annotation fixture book is missing: ' + bookTitle);
            const marks = JSON.parse(getStorageItem.call(localStorage, 'bookmanager-viewer-highlights:' + file.path));
            const mark = marks.find(item => item.text.trim() === card.querySelector('blockquote').textContent);
            check(mark, 'Annotation fixture text is missing');
            const timestamp = mark.createdAt ? new Date(mark.createdAt) : null;
            const calendarDay = timestamp ? [timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate()].join('/') : null;
            const repeated = previousDay !== undefined && calendarDay === previousDay;
            previousDay = calendarDay;
            check(date && !card.querySelector('.annotation-date'), 'Annotation dates must appear only in the left rail instead of the card footer');
            if (repeated) {
                check(date.classList.contains('is-repeated') && date.tagName === 'DIV' && date.textContent === '' && date.getAttribute('aria-hidden') === 'true', 'Consecutive annotations on the same calendar day must preserve an empty, hidden date rail');
            } else if (timestamp) {
                check(date.tagName === 'TIME' && date.dateTime === timestamp.toISOString(), 'The first annotation of each day and group must expose its stored timestamp');
                const day = date.querySelector('.annotation-date-day');
                const year = date.querySelector('.annotation-date-year');
                check(day?.textContent === dayFormatter.format(timestamp) && year?.textContent === String(timestamp.getFullYear()), 'Annotation date rail must preserve the Korean month/day and separate year');
                check(date.getAttribute('aria-label') && date.title, 'Annotation date rail must provide its full date and time for accessibility');
                check(year.getBoundingClientRect().top >= day.getBoundingClientRect().bottom, 'Annotation month/day and year must occupy separate lines');
            } else {
                check(date.classList.contains('is-unknown') && date.textContent === '날짜 정보 없음' && !date.hasAttribute('datetime'), 'Undated annotations must retain an explicit label without inventing a timestamp');
            }
            const bounds = entry.getBoundingClientRect();
            const dateBounds = date.getBoundingClientRect();
            const cardBounds = card.getBoundingClientRect();
            check(dateBounds.right <= cardBounds.left && Math.abs(dateBounds.top - cardBounds.top) <= 1, 'Annotation date rail must stay on the left and align with the top of its card');
            check(entry.scrollWidth <= entry.clientWidth + 1 && dateBounds.left >= bounds.left - 1 && cardBounds.right <= bounds.right + 1, 'Annotation date rail and card must not overflow their row');
        }
    }
}
function checkAnnotationActions(card) {
    const actions = card.querySelector(':scope > .annotation-entry-header > .annotation-entry-actions');
    check(actions && !card.querySelector('.annotation-card-footer button'), 'Annotation actions must appear in the top-right header instead of the footer');
    const expected = [['annotation-copy', '문장 복사'], ['annotation-open', '도서 열기'], ['annotation-delete', '주석 삭제']];
    const buttons = [...actions.querySelectorAll('button')];
    check(buttons.length === expected.length, 'Annotation header must provide copy, open and delete actions');
    buttons.forEach((control, index) => {
        const [className, label] = expected[index];
        check(control.classList.contains(className) && control.getAttribute('aria-label') === label && control.getAttribute('data-tooltip') === label,
            'Annotation icons must preserve action order, accessible names and tooltips: ' + label);
        check(control.querySelector('svg') && !control.textContent.trim() && !control.hasAttribute('title'), 'Annotation actions must use icons and a single custom tooltip: ' + label);
    });
    const headerBounds = actions.parentElement.getBoundingClientRect();
    const actionBounds = actions.getBoundingClientRect();
    check(Math.abs(actionBounds.right - headerBounds.right) <= 1 && Math.abs(actionBounds.top - headerBounds.top) <= 1, 'Annotation actions must align with the top right of their header');
    return actions;
}
async function click(text, scope = document) { await until(() => button(text, scope), 'Missing button: ' + text); button(text, scope).click(); await frame(); }
function setInput(element, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function openToolbarMenu(element) {
    check(element, 'Expected toolbar control is missing');
    const label = element.getAttribute('aria-label');
    const menu = () => document.querySelector('.folder-toolbar-menu[role="menu"][aria-label="' + label + '"]');
    element.click();
    await until(() => element.getAttribute('aria-expanded') === 'true' && menu()?.querySelector('[role="menuitemradio"]'), 'Toolbar menu did not open: ' + label);
    check(menu().querySelector('[aria-checked="true"]')?.dataset.value === element.dataset.value, 'Toolbar menu must mark its current selection: ' + label);
    return menu();
}
async function setSelect(element, value) {
    const menu = await openToolbarMenu(element);
    const choice = [...menu.querySelectorAll('[role="menuitemradio"]')].find(item => item.dataset.value === String(value));
    check(choice, 'Expected toolbar option is missing: ' + value);
    choice.click();
    await until(() => element.dataset.value === String(value) && element.getAttribute('aria-expanded') === 'false', 'Toolbar selection did not apply and close');
    await frame();
}
async function nativeEnter(element) {
    element.focus();
    await new Promise(resolve => { window.continueNative = resolve; console.log('CATALOG_ENTER'); });
    await frame();
}
async function nativeEscape() {
    await new Promise(resolve => { window.continueEscape = resolve; console.log('CATALOG_ESCAPE'); });
    await frame();
}
function checkProfileLayout(narrow = false) {
    const profile = document.querySelector('.author-profile');
    const bounds = profile.getBoundingClientRect();
    const portrait = profile.querySelector('.author-profile-portrait').getBoundingClientRect();
    const info = profile.querySelector('.author-profile-info').getBoundingClientRect();
    const stats = profile.querySelector('.author-profile-stats').getBoundingClientRect();
    check(document.querySelector('#author-profile-heading')?.tagName === 'H2', 'Author detail must expose its named heading');
    check(profile.querySelectorAll('.author-profile-stats dt').length === 2 && profile.querySelectorAll('.author-profile-stats dd').length === 2, 'Author stats must associate their labels with values');
    for (const element of profile.querySelectorAll('.author-profile-portrait, .author-profile-info, .author-profile-stats, .author-profile-hover-actions, h2, p, dt, dd, button, a')) {
        const rectangle = element.getBoundingClientRect();
        check(rectangle.left >= bounds.left - 1 && rectangle.right <= bounds.right + 1, 'Author profile content overflowed its horizontal bounds: ' + element.className);
    }
    check(info.left >= portrait.right - 1, 'Author identity overlaps its portrait');
    check(![...profile.querySelectorAll('.author-profile-info > p')].some(element => !element.textContent.trim()), 'Missing identity data must not leave an empty paragraph');
    if (narrow) check(stats.top >= Math.max(portrait.bottom, info.bottom) - 1, 'Narrow profile stats must move below the identity');
}
async function nativeHover(element) {
    element.scrollIntoView({ block: 'nearest' });
    const bounds = element.getBoundingClientRect();
    window.hoverPoint = { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + 15) };
    await new Promise(resolve => { window.continueHover = resolve; console.log('CATALOG_HOVER'); });
    await frame();
}
async function capture(name, narrow = false) {
    await document.fonts.ready;
    await new Promise(resolve => { window.captureRequest = { name, narrow }; window.continueCapture = resolve; console.log('CATALOG_CAPTURE'); });
    await frame();
}
window.catalogResult = (async () => {
    await until(() => document.querySelector('.sidebar-container'), 'Folder panel did not mount');
    await until(() => badge('저자') === String(names.length) && badge('주석') === '10', 'Catalog badges must load before opening either view');
    check(!document.querySelector('.authors-browser, .annotations-browser'), 'Badges should not require opening a catalog view');
    let backgroundRefreshes = 0;
    const backgroundRefreshTimer = setInterval(() => {
        backgroundRefreshes += 1;
        window.dispatchEvent(new Event('bookmanager:metadata-saved'));
    }, 750);
    try {
        await until(() => apiQueries.length === 1, 'Background profile lookup must start during repeated catalog refreshes without opening authors');
    } finally {
        clearInterval(backgroundRefreshTimer);
    }
    check(backgroundRefreshes >= 4, 'Background lookup must survive repeated catalog replacements');
    const initialCatalogRequests = requests.filter(request => request.id === 'library-catalog').length;
    check(initialCatalogRequests > 4, 'Metadata changes must refresh the background author catalog');
    check(!document.querySelector('.authors-browser'), 'Background profile lookup must not mount the author page');
    const backgroundAuthor = apiQueries[0];
    check(!profileOptions[0]?.allSources, 'Background lookup must use the automatic profile sources');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.author-card').length === names.length, 'Author cards did not load during background lookup');
    await new Promise(resolve => setTimeout(resolve, 300));
    check(apiQueries.length === 1, 'Opening authors must share the in-flight background lookup without starting another request');
    await click('대시보드', document.querySelector('.sidebar-container'));
    await until(() => !document.querySelector('.authors-browser') && document.querySelector('.reading-dashboard'), 'Could not return to the dashboard during background lookup');
    const backgroundCompletedAt = performance.now();
    releaseFirstProfile();
    const cachedProfiles = () => JSON.parse(localStorage.getItem(AUTOMATIC_AUTHOR_PROFILES_KEY) || '{}');
    await until(() => cachedProfiles()[authorKey(backgroundAuthor)]?.profile?.storedPhoto, 'Leaving authors must preserve the background photo as a local file');
    check(profilePhotoSaves.some(profile => profile.name === backgroundAuthor), 'Background photos must use the persistent photo storage API');
    check(apiQueries.length === 1, 'Background lookup must wait before requesting the next author');
    await until(() => apiQueries.length === 2, 'Background lookup must continue after leaving the author page');
    check(performance.now() - backgroundCompletedAt >= 4500, 'Background lookups must leave a quiet interval between requests');
    check(document.querySelector('.reading-dashboard') && !document.querySelector('.authors-browser'), 'The next background lookup must run while the dashboard is open');
    await until(() => Object.hasOwn(cachedProfiles(), authorKey(apiQueries[1])), 'Background lookup must cache subsequent results');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.author-card').length === names.length, 'Author cards did not load');
    const authorPreviewStart = previewQueries.length;
    check(!document.querySelector('.authors-heading'), 'Author intro header must be removed');
    check(!document.querySelector('.author-scroll-sentinel, .authors-browser > .author-load-more'), 'Complete author lists must not show a load-more control');
    checkCatalogFooter('저자 21명 · 도서 21권');
    check(requests.filter(request => request.id === 'library-catalog').length === initialCatalogRequests, 'Opening authors must reuse the badge catalog');
    check(!document.querySelector('tr[data-file-path]'), 'Catalog used the file table');
    const authorCard = name => [...document.querySelectorAll('.author-card')].find(node => node.textContent.includes(name));
    await until(() => authorCard('김초엽')?.querySelector('img')?.naturalWidth > 0, 'Author photos were not loaded automatically');
    check(authorCard('김초엽').querySelector('img').src.startsWith('bookmanager-thumbnail://author-photo/'), 'Automatic author cards must load saved local photos');
    await until(() => apiQueries.includes('김금희') && apiQueries.includes('김애란') && apiQueries.includes('김연수'), 'Visible authors were not searched');
    check(apiQueries.filter(name => name === backgroundAuthor).length === 1, 'Reopening authors must reuse the background profile cache');
    await until(() => !authorCard('김금희').querySelector('img'), 'Missing photo did not fall back to initials');
    check(authorCard('김금희').querySelector('.author-avatar > span').textContent === '김금', 'Photo fallback initials are incorrect');
    check(!authorCard('김애란').querySelector('img') && !authorCard('김연수').querySelector('img'), 'Empty or failed search must display initials');
    check(!apiQueries.includes('Virginia Woolf'), 'Visible authors should take priority over the remaining background queue');
    const rail = document.querySelector('.authors-browser-shell > .folder-character-index');
    check(rail && !document.querySelector('.author-index'), 'Authors must use the existing right-side character index');
    const railTop = rail.getBoundingClientRect().top;
    await capture('authors');
    await click('ㅅ', rail);
    check(document.querySelector('.authors-browser').scrollTop > 0, 'Character index did not scroll to the author group');
    check(Math.abs(rail.getBoundingClientRect().top - railTop) < 1, 'Right-side character index moved with the content');
    check(document.querySelectorAll('.author-card').length === names.length, 'Character navigation must preserve the author list');
    const toolbarBack = () => document.querySelector('.folder-goto-path-navigation button');
    const listScrollTop = document.querySelector('.authors-browser').scrollTop;
    check(toolbarBack().disabled, 'Author list must not expose a stale back action');
    await nativeEnter(authorCard('손원평'));
    await until(() => document.querySelector('.author-profile') && !toolbarBack().disabled, 'Author detail did not enable toolbar back');
    toolbarBack().click();
    await until(() => !document.querySelector('.author-profile') && toolbarBack().disabled, 'Toolbar back did not return to the author list');
    check(Math.abs(document.querySelector('.authors-browser').scrollTop - listScrollTop) < 1, 'Back did not restore the author list scroll position');
    check(document.activeElement === authorCard('손원평'), 'Back did not restore focus to the selected author');
    authorCard('손원평').click(); await frame();
    const modal = document.createElement('div'); modal.className = 'modal-overlay'; document.body.append(modal);
    window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true })); await frame();
    check(document.querySelector('.author-profile'), 'Mouse back must respect the existing modal guard');
    modal.remove();
    window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('.author-profile') && toolbarBack().disabled, 'Mouse back did not return to the author list');
    authorCard('손원평').click(); await frame();
    await new Promise(resolve => setTimeout(resolve, 510));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('.author-profile') && toolbarBack().disabled, 'Keyboard back did not return to the author list');
    await click('ㄱ', document.querySelector('.authors-browser-shell > .folder-character-index'));
    await nativeEnter([...document.querySelectorAll('.author-card')].find(node => node.textContent.includes('김초엽')));
    await until(() => document.querySelector('.author-profile h2')?.textContent === '김초엽', 'Keyboard author selection failed');
    check(!document.querySelector('.authors-browser-shell > .folder-character-index'), 'Author detail must hide the character index');
    check(document.querySelectorAll('.author-book').length === 2, 'Author books incorrect');
    check(document.querySelector('.author-profile a')?.href === 'https://www.wikidata.org/wiki/Q12345', 'Automatic Wikidata profile missing from details');
    check(document.querySelector('.author-image-credit')?.textContent.includes('CC BY-SA 4.0'), 'Image attribution is missing');
    await nativeEnter(button('프로필 변경'));
    const profileToggle = button('프로필 변경');
    const profileEditor = () => document.querySelector('dialog.author-editor-dialog');
    check(profileToggle.getAttribute('aria-haspopup') === 'dialog' && profileEditor()?.open, 'Profile control must open its dialog');
    check(profileEditor().querySelector('input[aria-label="저자 이름 또는 작품명"]') === document.activeElement, 'Opening profile search must focus its input');
    await nativeEscape();
    await until(() => !profileEditor(), 'Escape did not close the profile picker');
    check(document.activeElement === profileToggle, 'Closing profile search must restore focus to its toggle');
    check(document.querySelector('.author-profile h2')?.textContent === '김초엽', 'Closing profile search must stay in author detail');
    await nativeEnter(button('프로필 변경'));
    const form = profileEditor().querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => profileEditor().querySelector('.author-editor-result'), 'Profile candidates missing');
    check(apiQueries.at(-1) === '김초엽', 'Manual profile request name incorrect');
    check(profileOptions.at(-1)?.allSources === true && profileOptions.at(-1)?.source === 'all', 'Manual search must include all profile sources');
    check(profileEditor().querySelectorAll('.author-editor-result')[1].textContent.includes('Wikipedia'), 'Profile candidates must identify their source');
    const previousPhotoUrl = document.querySelector('.author-profile-portrait img').src;
    failNextProfilePhotoSave = true;
    await nativeEnter(profileEditor().querySelectorAll('.author-editor-result')[1]);
    await click('이 프로필 선택', profileEditor());
    await until(() => document.querySelector('.author-detail > [role="alert"]')?.textContent.includes('저장하지 못했습니다'), 'A failed disk write must report the save failure');
    check(profilePhotoConfirmations.length === 1 && profilePhotoConfirmations[0].buttons === 'yes-no-cancel'
        && profilePhotoConfirmations[0].defaultChoice === 'no', 'Replacing a profile that already has a photo must ask before saving');
    check(profileEditor(), 'A failed disk write must keep the profile picker available for retry');
    check(document.querySelector('.author-profile a')?.href === 'https://www.wikidata.org/wiki/Q12345'
        && document.querySelector('.author-profile-portrait img').src === previousPhotoUrl, 'A failed disk write must preserve the current author and photo');
    await click('이 프로필 선택', profileEditor());
    await until(() => !profileEditor(), 'Profile selection failed');
    check(profilePhotoConfirmations.length === 2, 'Retrying a failed profile save must confirm photo replacement again');
    check(JSON.parse(localStorage.getItem('bookmanager.authorProfiles'))['김초엽'].id === 'wikipedia:ko:12345', 'Selected Wikipedia profile was not saved');
    check(JSON.parse(localStorage.getItem('bookmanager.authorProfiles'))['김초엽'].storedPhoto?.id === 'd'.repeat(64), 'Manually selected profile photos must also retain their local file identity');
    check(profilePhotoSaves.filter(profile => profile.id === 'wikipedia:ko:12345').length >= 2, 'Manual photo saving must retry after a disk write failure');
    await until(() => document.querySelector('.author-profile a')?.href === 'https://ko.wikipedia.org/?curid=12345', 'Manual profile did not replace the automatic profile');
    await capture('author-detail');
    checkProfileLayout();
    const authorSort = document.querySelector('.author-book-controls button[aria-haspopup="menu"][aria-label="정렬 기준"]');
    const originalBookOrder = [...document.querySelectorAll('.author-book')].map(item => item.dataset.authorBookPath);
    await setSelect(authorSort, 'recent');
    check(document.querySelector('.author-book').dataset.authorBookPath === files[0].path, 'Author book sorting must use the most recently added book');
    await setSelect(authorSort, 'name');
    check(JSON.stringify([...document.querySelectorAll('.author-book')].map(item => item.dataset.authorBookPath)) === JSON.stringify(originalBookOrder), 'Author book title sorting must restore its original order');
    const gridBooks = [...document.querySelectorAll('.author-book-shelf.is-grid .author-book')];
    check(gridBooks.every(book => book.classList.contains('thumbnail-item')), 'Owned books must use the existing thumbnail cards');
    check(getComputedStyle(gridBooks[1].querySelector('.thumb-image img')).objectFit === 'cover', 'Owned books must use the existing thumbnail artwork style');
    check(getComputedStyle(gridBooks[1].querySelector('.thumb-label')).position === 'absolute', 'Thumbnail titles must overlay their covers');
    check(!document.querySelector('.author-book-format'), 'Owned books must not show file format badges');
    const ownedBook = document.querySelector('[data-author-book-path="' + files[0].path + '"]');
    const ownedCover = ownedBook.querySelector('.thumbnail-cover-card');
    check(previewQueries.length === authorPreviewStart, 'Owned books must load full metadata only after selection');
    applyMotionPreference('full');
    await nativeHover(ownedBook);
    await until(() => new DOMMatrix(getComputedStyle(ownedCover).transform).m42 < -1.5, 'Owned book hover did not lift its cover');
    check(getComputedStyle(ownedCover).filter.includes('brightness'), 'Owned book hover did not highlight its cover');
    applyMotionPreference('reduced');
    await until(() => Math.abs(new DOMMatrix(getComputedStyle(ownedCover).transform).m42) < 0.1, 'Reduced motion did not remove the hover movement');
    await nativeEnter(ownedBook);
    await until(() => document.querySelector('#folder-detail-panel')?.textContent.includes('선택한 책의 상세 설명입니다.'), 'Owned book did not load its full details');
    check(opened.length === 0, 'Single-click book selection must not open the viewer');
    check(previewQueries.length === authorPreviewStart + 1 && previewQueries[authorPreviewStart] === files[0].path, 'Details must load only the selected book');
    check(ownedBook.getAttribute('aria-pressed') === 'true', 'Selected owned book was not highlighted');
    check(document.querySelector('#folder-detail-panel').textContent.includes('9781234567890'), 'Detailed ISBN missing');
    check(document.querySelector('#folder-detail-panel').textContent.includes('테스트 출판사'), 'Detailed publisher missing');
    await capture('author-book-details');
    document.querySelector('.folder-detail-position-button[data-position="right"]').click(); await frame();
    check(document.querySelector('.folder-content-area.is-detail-right #folder-detail-panel'), 'Bottom bar could not move author book details to the right');
    document.querySelector('.folder-detail-position-button[data-position="bottom"]').click(); await frame();
    check(!document.querySelector('.folder-content-area.is-detail-right'), 'Bottom bar could not restore bottom book details');
    document.querySelector('.folder-detail-panel-toggle').click(); await frame();
    check(document.querySelector('.folder-detail-panel-toggle').getAttribute('aria-expanded') === 'false', 'Book details did not collapse');
    await nativeHover(document.querySelectorAll('.author-book-shelf.is-grid .author-book')[1]);
    document.activeElement?.blur();
    await capture('author-books-grid-selected');
    ownedBook.click(); await frame();
    check(document.querySelector('.folder-detail-panel-toggle').getAttribute('aria-expanded') === 'true', 'Selecting a book did not reopen its details');
    check(previewQueries.length === authorPreviewStart + 1, 'Reopening the same book must reuse its loaded details');
    await nativeEnter(document.querySelector('#folder-detail-panel .detail-open-button'));
    check(opened.at(-1) === files[0].path, 'Author book did not open from the detail panel');
    await click('목록 보기');
    check(document.querySelector('.author-book-shelf.is-list .author-book.is-selected'), 'List view lost the selected book');
    document.querySelector('.folder-detail-panel-toggle').click(); await frame();
    document.querySelector('.author-books').scrollIntoView({ block: 'start' });
    const listBooks = [...document.querySelectorAll('.author-book-shelf.is-list .author-book')];
    check(getComputedStyle(listBooks[0]).borderRadius === '0px', 'List dividers must not have rounded row borders');
    check(!listBooks[0].hasAttribute('title'), 'A whole-row tooltip must not obscure book information');
    await nativeHover(listBooks[1]);
    await capture('author-books-list');
    const ownedBookSearch = document.querySelector('.author-book-controls input');
    setInput(ownedBookSearch, '일치하지 않는 도서'); await frame();
    check(!document.querySelector('#folder-detail-panel'), 'Filtering out the selected book kept its details open');
    setInput(ownedBookSearch, ''); await frame();
    document.querySelector('.author-book').click();
    await until(() => document.querySelector('#folder-detail-panel'), 'Selecting a filtered book did not reopen its details');
    setInput(document.querySelector('.search-input'), 'Jane'); await frame();
    document.querySelector('.search-input').form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => document.querySelectorAll('.author-card').length === 1, 'Global author search did not return to matching list');
    check(!document.querySelector('#folder-detail-panel'), 'Leaving author detail kept the book information panel open');
    check(toolbarBack().disabled, 'Search did not clear the author detail back action');
    check(document.querySelector('.author-card').textContent.includes('Jane Austen'), 'Global author search result incorrect');
    check(badge('저자') === String(names.length), 'Author search changed the total sidebar badge');
    checkCatalogFooter('저자 21명 · 도서 21권');
    const readsBeforeFirstAnnotations = highlightReads;
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.annotation-card').length === 10, 'Annotations did not load');
    check(!document.querySelector('.annotations-heading'), 'Annotation intro header must be removed');
    const annotationToolbar = checkAnnotationToolbar();
    check(!document.querySelector('.annotations-export, button[aria-label="주석 내보내기"]'), 'Annotation export controls must not be displayed');
    const summary = document.querySelector('aside.annotations-summary');
    check(summary?.querySelector('.annotations-summary-content') && getComputedStyle(summary).display !== 'none', 'Statistics and filters must always be displayed');
    check(!summary.querySelector('button[aria-expanded], .annotations-summary-toggle'), 'Statistics must not have a collapse control');
    checkCatalogFooter('주석 10개');
    check(highlightReads === readsBeforeFirstAnnotations, 'Opening annotations must reuse the badge data');
    await capture('annotations');
    const longCard = [...document.querySelectorAll('.annotation-card')].find(card => card.textContent.includes('빛을 향해 떠나는'));
    check(longCard.querySelector('blockquote').textContent === longQuote && !longCard.querySelector('.annotation-expand'), 'Normal view must show the full quote');
    const densityToggle = annotationToolbar.querySelector('.annotations-density');
    check(densityToggle?.textContent.trim() === '간결하게 보기' && !densityToggle.querySelector('svg'), 'Compact view must use a visible text button without an icon');
    const annotationActions = checkAnnotationActions(longCard);
    const actionOpacity = () => Number(getComputedStyle(annotationActions).opacity);
    document.activeElement?.blur();
    await nativeHover(annotationToolbar);
    await until(() => actionOpacity() === 0, 'Annotation actions must stay hidden until hover or keyboard focus');
    applyMotionPreference('full'); await frame();
    await nativeHover(longCard);
    await until(() => actionOpacity() > 0 && actionOpacity() < 1, 'Annotation actions must fade in through an intermediate opacity with full motion');
    await until(() => actionOpacity() === 1, 'Hovering an annotation must finish revealing its actions');
    for (const control of annotationActions.querySelectorAll('button')) {
        await nativeHover(control);
        await until(() => document.querySelector('[role="tooltip"]')?.textContent === control.getAttribute('data-tooltip'), 'Annotation action hover did not show its tooltip');
        check(control.getAttribute('aria-describedby') === document.querySelector('[role="tooltip"]').id, 'Action tooltip must describe its trigger');
    }
    await capture('annotation-actions-hover');
    await nativeHover(annotationToolbar);
    await until(() => actionOpacity() > 0 && actionOpacity() < 1, 'Annotation actions must fade out through an intermediate opacity when hover ends');
    await until(() => actionOpacity() === 0, 'Annotation actions must finish hiding after hover ends');
    annotationActions.querySelector('.annotation-copy').focus(); await frame();
    await until(() => actionOpacity() === 1, 'Keyboard focus must reveal annotation actions without hovering');
    document.activeElement?.blur();
    await until(() => actionOpacity() === 0, 'Annotation actions must finish hiding after focus leaves');
    applyMotionPreference('reduced'); await frame();
    await nativeHover(longCard);
    await until(() => {
        const opacity = actionOpacity();
        check(opacity === 0 || opacity === 1, 'Reduced motion must not fade while showing annotation actions');
        return opacity === 1;
    }, 'Reduced motion must show annotation actions without a fade');
    await nativeHover(annotationToolbar);
    await until(() => {
        const opacity = actionOpacity();
        check(opacity === 0 || opacity === 1, 'Reduced motion must not fade while hiding annotation actions');
        return opacity === 0;
    }, 'Reduced motion must hide annotation actions without a fade');
    checkAnnotationDates();
    check(document.querySelectorAll('.annotation-date.is-repeated').length === 2, 'Different times on the same local day must share the first date label');
    check(longCard.parentElement.querySelector(':scope > time.annotation-date').dateTime === new Date(2026, 9, 25, 23, 30).toISOString(), 'Annotation date rail must preserve the stored creation timestamp');
    densityToggle.click(); await frame();
    check(document.querySelector('.annotations-browser.is-compact'), 'Compact view did not change the feed');
    check(document.querySelectorAll('.annotation-card').length === 10, 'Compact view must preserve all displayed annotations');
    await until(() => longCard.querySelector('.annotation-expand'), 'Compact view did not expose the overflowing quote control');
    const expandQuote = longCard?.querySelector('.annotation-expand');
    check(expandQuote?.getAttribute('aria-expanded') === 'false', 'Long quotes must start collapsed');
    expandQuote.click(); await frame();
    check(expandQuote.getAttribute('aria-expanded') === 'true', 'Long quote expansion failed');
    check(longCard.querySelector('blockquote').textContent === longQuote, 'Expanding a quote changed its text');
    longCard.querySelector('.annotation-copy').click();
    await until(() => copiedQuotes.length === 1, 'Annotation copy did not reach the clipboard');
    check(copiedQuotes[0] === longQuote, 'Annotation copy must include the full quote');
    await until(() => longCard.querySelector('.annotation-copy')?.getAttribute('aria-label') === '복사됨', 'Copying must provide an accessible success state');
    check(longCard.querySelector('.annotation-copy svg') && !longCard.querySelector('.annotation-copy').textContent.trim(), 'Copy feedback must preserve its icon button');
    check([...document.querySelectorAll('[aria-live="polite"]')].some(node => node.textContent.includes('복사됨')), 'Copy feedback must announce success to assistive technology');
    expandQuote.click(); await frame();
    await capture('annotations-compact');
    checkAnnotationDates();
    densityToggle.click(); await frame();
    await setSelect(document.querySelector('button[aria-haspopup="menu"][aria-label="주석 묶기"]'), 'book');
    check(document.querySelectorAll('.annotations-month.is-book-group').length === 10, 'Book grouping must include each annotated book');
    check(document.querySelectorAll('.annotation-card').length === 10, 'Book grouping lost annotations');
    check([...document.querySelectorAll('.annotations-month.is-book-group')].every(group => group.querySelectorAll('.annotation-book-link').length === 1 && !group.querySelector('.annotation-card .annotation-book-link')), 'Book grouping must show its book information once in the group header');
    checkAnnotationDates();
    await capture('annotations-by-book');
    await setSelect(document.querySelector('button[aria-haspopup="menu"][aria-label="주석 묶기"]'), 'date');
    check(!document.querySelector('.annotations-month.is-book-group'), 'Date grouping did not restore the timeline');
    await setSelect(annotationToolbar.querySelector('button[aria-haspopup="menu"][aria-label="주석 정렬"]'), 'oldest');
    check(document.querySelector('.annotation-book-link').textContent.includes(files[9].title), 'Top toolbar oldest-first sorting did not reorder annotations');
    checkAnnotationDates();
    await setSelect(annotationToolbar.querySelector('button[aria-haspopup="menu"][aria-label="주석 정렬"]'), 'newest');
    check(document.querySelector('.annotation-card blockquote').textContent === longQuote, 'Top toolbar newest-first sorting did not restore the latest annotation');
    const yellow = document.querySelector('.annotations-color-filters .annotation-color.is-yellow').closest('button');
    yellow.click(); await frame();
    check(document.querySelector('.annotation-book-link').textContent.includes(files[1].title), 'Date filter fixture must hide the original first annotation');
    checkAnnotationDates();
    await click('필터 초기화', annotationToolbar);
    const blue = [...document.querySelectorAll('.annotations-color-filters button')].find(node => node.textContent.includes('파랑'));
    check(blue, 'Blue color filter missing'); blue.click(); await frame();
    check(document.querySelectorAll('.annotation-card').length === 2, 'Annotation color filter failed');
    check(badge('주석') === '10', 'Annotation filters changed the total sidebar badge');
    checkCatalogFooter('주석 10개');
    check(annotationToolbar.querySelector('.annotations-reset'), 'Filter reset must stay with the annotation toolbar controls');
    await click('필터 초기화', annotationToolbar);
    const shelfSearch = document.querySelector('input[aria-label="주석 도서 검색"]');
    check(shelfSearch, 'Shelf search is missing');
    setInput(shelfSearch, files[9].title); await frame();
    check(document.querySelectorAll('.annotations-shelf-book').length === 1 && document.querySelector('.annotations-shelf-book').textContent.includes(files[9].title), 'Shelf search must find books beyond the initial visible shelf');
    const shelf = document.querySelector('.annotations-shelf-book'); shelf.click(); await frame();
    check(document.querySelectorAll('.annotation-card').length === 1, 'Annotation book filter failed');
    check(document.querySelector('.annotation-book-link').textContent.includes(files[9].title), 'Shelf search selected the wrong book');
    setInput(shelfSearch, ''); await frame();
    await click('필터 초기화');
    const paletteStorageKey = 'bookmanager-viewer-highlights:' + files[0].path;
    const originalPaletteMarks = JSON.parse(localStorage.getItem(paletteStorageKey));
    const additionalColors = HIGHLIGHT_COLORS.slice(5);
    const paletteMarks = additionalColors.flatMap((color, colorIndex) => Array.from({ length: colorIndex + 1 }, (_, index) => ({
        id: 'palette-' + color.id + '-' + index,
        text: color.label + ' 저장 및 동기화 색상 확인 ' + index,
        pageIndex: index,
        color: color.id,
        createdAt: new Date().toISOString(),
    })));
    localStorage.setItem(paletteStorageKey, JSON.stringify([...originalPaletteMarks, ...paletteMarks]));
    window.dispatchEvent(new StorageEvent('storage', { key: paletteStorageKey }));
    await until(() => badge('주석') === '25' && document.querySelectorAll('.annotation-card').length === 25, 'New highlight colors did not load from storage');
    checkCatalogFooter('주석 25개');
    for (const color of HIGHLIGHT_COLORS) {
        const marker = document.querySelector('.annotations-color-filters .annotation-color.is-' + color.id);
        const filter = marker?.closest('button');
        const count = additionalColors.includes(color) ? additionalColors.indexOf(color) + 1 : 2;
        const rgb = 'rgb(' + color.hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ') + ')';
        check(filter?.textContent.includes(color.label) && filter.querySelector('small')?.textContent === String(count), 'Color count or label is wrong: ' + color.id);
        check(getComputedStyle(marker).backgroundColor === rgb, 'Summary marker must match the shared palette: ' + color.id);
        const card = document.querySelector('.annotation-entry.is-' + color.id + ' .annotation-card');
        check(card && getComputedStyle(card).borderLeftColor === rgb, 'Annotation marker must match its stored color: ' + color.id);
    }
    await capture('annotation-colors');
    for (const [index, color] of additionalColors.entries()) {
        document.querySelector('.annotations-color-filters .annotation-color.is-' + color.id).closest('button').click();
        await frame();
        check(document.querySelectorAll('.annotation-card').length === index + 1, 'New color filter returned the wrong count: ' + color.id);
        check([...document.querySelectorAll('.annotation-entry')].every(entry => entry.classList.contains('is-' + color.id)), 'New color filter mixed persisted colors: ' + color.id);
        check(badge('주석') === '25', 'Color filtering changed the full annotation count');
        await click('필터 초기화');
    }
    await openToolbarMenu(annotationToolbar.querySelector('button[aria-label="주석 정렬"]'));
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('.authors-browser'), 'Could not leave annotations for the palette revisit check');
    check(!document.querySelector('.folder-toolbar-menu[aria-label="주석 정렬"]'), 'Leaving annotations must remove its open toolbar menu');
    check(!document.querySelector('.annotations-toolbar-controls') && !annotationToolbar.isConnected, 'Leaving annotations must remove its toolbar controls');
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.annotation-card').length === 25, 'New highlight colors were lost when reopening annotations');
    check(checkAnnotationToolbar() !== annotationToolbar, 'Reopening annotations must attach the current toolbar controls');
    for (const [index, color] of additionalColors.entries()) {
        const filter = document.querySelector('.annotations-color-filters .annotation-color.is-' + color.id)?.closest('button');
        check(filter?.querySelector('small')?.textContent === String(index + 1), 'Persisted color counts changed when reopening annotations: ' + color.id);
    }
    localStorage.setItem(paletteStorageKey, JSON.stringify(originalPaletteMarks));
    window.dispatchEvent(new StorageEvent('storage', { key: paletteStorageKey }));
    await until(() => badge('주석') === '10' && document.querySelectorAll('.annotation-card').length === 10, 'Color fixtures did not restore before existing annotation checks');
    const strikeMarks = [
        { id: 'strike-first', text: '취소선 저장 및 다시 열기 확인', pageIndex: 1, color: 'strikethrough', createdAt: new Date().toISOString() },
        { id: 'strike-second', text: '취소선 삭제 후 남길 문장', pageIndex: 2, color: 'strikethrough', createdAt: new Date().toISOString() },
        { id: 'strike-underline', text: '취소선과 구분할 밑줄 문장', pageIndex: 3, color: 'underline', createdAt: new Date().toISOString() },
    ];
    localStorage.setItem(paletteStorageKey, JSON.stringify([...originalPaletteMarks, ...strikeMarks]));
    window.dispatchEvent(new StorageEvent('storage', { key: paletteStorageKey }));
    await until(() => badge('주석') === '13' && document.querySelectorAll('.annotation-card').length === 13, 'Strikethrough annotations did not load from viewer storage');
    checkCatalogFooter('주석 13개');
    const styleControl = label => [...document.querySelectorAll('.annotations-style-filters button')].find(control => control.textContent.includes(label));
    for (const [label, count] of [['하이라이트', '10'], ['밑줄', '1'], ['취소선', '2']]) {
        check(styleControl(label)?.querySelector('small')?.textContent === count, 'Annotation styles must count strikethroughs separately: ' + label);
    }
    const strikeColor = document.querySelector('.annotations-color-filters .annotation-color.is-strikethrough')?.closest('button');
    check(strikeColor?.textContent.includes('취소선') && strikeColor.querySelector('small')?.textContent === '2', 'Strikethrough summary marker and count are missing');
    check(document.querySelectorAll('.annotation-entry.is-strikethrough .annotation-card .annotation-color.is-strikethrough').length === 2, 'Stored strikethroughs must keep their marker instead of becoming highlights');
    const underlineColor = getComputedStyle(document.querySelector('.annotation-entry.is-underline .annotation-card')).borderLeftColor;
    for (const card of document.querySelectorAll('.annotation-entry.is-strikethrough .annotation-card')) {
        check(getComputedStyle(card.querySelector('blockquote')).textDecorationLine === 'line-through', 'Strikethrough annotation text must render its saved decoration');
        check(card.querySelector('.annotation-color.is-strikethrough svg') && getComputedStyle(card).borderLeftColor === underlineColor, 'Strikethroughs must use their own symbol with the neutral annotation color');
    }
    checkAnnotationDates();
    await capture('annotations-strikethrough');
    for (const [label, count] of [['하이라이트', 10], ['밑줄', 1], ['취소선', 2]]) {
        styleControl(label).click(); await frame();
        check(document.querySelectorAll('.annotation-card').length === count, 'Style filtering mixed strikethroughs with another annotation type: ' + label);
        if (label === '취소선') check([...document.querySelectorAll('.annotation-entry')].every(entry => entry.classList.contains('is-strikethrough')), 'Strikethrough style filter returned another annotation type');
        check(badge('주석') === '13', 'Strikethrough style filtering changed the total sidebar badge');
        await click('필터 초기화');
    }
    strikeColor.click(); await frame();
    check(document.querySelectorAll('.annotation-entry.is-strikethrough').length === 2 && document.querySelectorAll('.annotation-card').length === 2, 'Strikethrough color filter returned another annotation type');
    await click('필터 초기화');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('.authors-browser'), 'Could not leave annotations after storing strikethroughs');
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.annotation-card').length === 13 && document.querySelectorAll('.annotation-entry.is-strikethrough').length === 2, 'Persisted strikethroughs were lost when reopening annotations');
    check(styleControl('취소선')?.querySelector('small')?.textContent === '2', 'Reopening annotations changed the strikethrough count');
    styleControl('취소선').click(); await frame();
    const strikeCard = [...document.querySelectorAll('.annotation-card')].find(card => card.querySelector('blockquote').textContent === strikeMarks[0].text);
    checkAnnotationActions(strikeCard);
    const copiesBeforeStrike = copiedQuotes.length;
    strikeCard.querySelector('.annotation-copy').click();
    await until(() => copiedQuotes.length === copiesBeforeStrike + 1, 'Strikethrough copy did not reach the clipboard');
    check(copiedQuotes.at(-1) === strikeMarks[0].text, 'Strikethrough copy must preserve its plain text');
    const opensBeforeStrike = opened.length;
    await nativeEnter(strikeCard.querySelector('.annotation-open'));
    check(opened.length === opensBeforeStrike + 1 && opened.at(-1) === files[0].path, 'Strikethrough open action did not open its book');
    await nativeEnter(strikeCard.querySelector('.annotation-delete'));
    await until(() => badge('주석') === '12' && document.querySelectorAll('.annotation-card').length === 1, 'Deleting a filtered strikethrough must update the feed and total count');
    check(document.querySelector('.annotation-card blockquote').textContent === strikeMarks[1].text, 'Deleting a strikethrough removed the wrong mark');
    check(styleControl('취소선')?.querySelector('small')?.textContent === '1' && styleControl('밑줄')?.querySelector('small')?.textContent === '1' && styleControl('하이라이트')?.querySelector('small')?.textContent === '10', 'Deleting a strikethrough must update only its style count');
    check(document.querySelector('.annotations-color-filters .annotation-color.is-strikethrough').closest('button').querySelector('small').textContent === '1', 'Deleting a strikethrough must update its color count');
    check(JSON.stringify(JSON.parse(localStorage.getItem(paletteStorageKey))) === JSON.stringify([...originalPaletteMarks, ...strikeMarks.slice(1)]), 'Strikethrough deletion must persist its removal and preserve other annotation styles');
    check(opened.length === opensBeforeStrike + 1, 'Deleting a strikethrough must not open its book');
    checkCatalogFooter('주석 12개');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('.authors-browser'), 'Could not leave annotations after deleting a strikethrough');
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.annotation-card').length === 12 && document.querySelectorAll('.annotation-entry.is-strikethrough').length === 1, 'Deleting a strikethrough did not persist after reopening annotations');
    check(![...document.querySelectorAll('.annotation-card blockquote')].some(quote => quote.textContent === strikeMarks[0].text), 'Reopening annotations restored a deleted strikethrough');
    localStorage.setItem(paletteStorageKey, JSON.stringify(originalPaletteMarks));
    window.dispatchEvent(new StorageEvent('storage', { key: paletteStorageKey }));
    await until(() => badge('주석') === '10' && document.querySelectorAll('.annotation-card').length === 10, 'Strikethrough fixtures did not restore before existing annotation checks');
    const updated = JSON.parse(localStorage.getItem('bookmanager-viewer-highlights:' + files[0].path));
    updated.push({ id: 'new', text: '새로운 문장', pageIndex: 2, color: 'yellow', createdAt: new Date().toISOString() });
    localStorage.setItem('bookmanager-viewer-highlights:' + files[0].path, JSON.stringify(updated));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bookmanager-viewer-highlights:' + files[0].path }));
    await until(() => document.querySelectorAll('.annotation-card').length === 11, 'Viewer storage change did not refresh annotations');
    check(badge('주석') === '11', 'Annotation badge did not update after a viewer storage change');
    checkCatalogFooter('주석 11개');
    const otherBookMarks = localStorage.getItem('bookmanager-viewer-highlights:' + files[1].path);
    const deleteCard = [...document.querySelectorAll('.annotation-card')].find(card => card.querySelector('blockquote').textContent === longQuote);
    const opensBeforeDelete = opened.length;
    await nativeEnter(deleteCard.querySelector('.annotation-delete'));
    await until(() => badge('주석') === '10' && document.querySelectorAll('.annotation-card').length === 10, 'Deleting an annotation must immediately update its feed and sidebar count');
    check(opened.length === opensBeforeDelete, 'Deleting an annotation must not open its book');
    check(!deleteCard.isConnected && ![...document.querySelectorAll('.annotation-card blockquote')].some(quote => quote.textContent === longQuote), 'The deleted annotation remained in the feed');
    const remainingMarks = updated.filter(mark => mark.id !== 'mark-0');
    check(JSON.stringify(JSON.parse(localStorage.getItem(paletteStorageKey))) === JSON.stringify(remainingMarks), 'Deleting an annotation must persist only its removal and preserve other marks in the same book');
    check(localStorage.getItem('bookmanager-viewer-highlights:' + files[1].path) === otherBookMarks, 'Deleting an annotation modified another book');
    checkCatalogFooter('주석 10개');
    check([...document.querySelectorAll('.annotations-summary-total strong')].map(node => node.textContent).join(',') === '10,10', 'Deleting an annotation must update its totals while retaining books with other annotations');
    check(document.querySelector('.annotations-color-filters .annotation-color.is-blue').closest('button').querySelector('small').textContent === '1', 'Deleting an annotation must update its color count');
    check([...document.querySelectorAll('.annotations-shelf-book')].find(book => book.title === files[0].title)?.querySelector('b').textContent === '1', 'Deleting an annotation must update the annotated book count');
    checkAnnotationDates();
    const nextSameDayEntry = [...document.querySelectorAll('article.annotation-entry')].find(entry => entry.querySelector('.annotation-book-link strong')?.textContent === files[1].title);
    check(nextSameDayEntry?.querySelector(':scope > time.annotation-date'), 'Deleting the first annotation of a day must move its date label to the next annotation');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('.authors-browser'), 'Could not leave annotations after deleting a mark');
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.annotation-card').length === 10 && badge('주석') === '10', 'Deleted annotations must remain absent after reopening the catalog');
    check(![...document.querySelectorAll('.annotation-card blockquote')].some(quote => quote.textContent === longQuote), 'Reopening annotations restored a deleted mark');
    localStorage.setItem(paletteStorageKey, JSON.stringify(updated));
    window.dispatchEvent(new StorageEvent('storage', { key: paletteStorageKey }));
    await until(() => badge('주석') === '11' && document.querySelectorAll('.annotation-card').length === 11, 'Annotation fixtures did not restore after deletion checks');
    await nativeEnter(document.querySelector('.annotation-open'));
    check(opened.length === opensBeforeDelete + 1 && opened.at(-1) === files[0].path, 'Annotation open icon did not open its book');
    const currentMonth = new Date();
    const previousMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 15, 12);
    const paginationMarks = Array.from({ length: 130 }, (_, index) => ({
        id: 'pagination-' + index, text: '자동 스크롤 확인 문장 ' + index, color: 'underline', pageIndex: index,
        ...(index < 129 ? { createdAt: (index < 65 ? currentMonth : previousMonth).toISOString() } : {}),
    }));
    localStorage.setItem('bookmanager-viewer-highlights:' + files[0].path, JSON.stringify([...updated, ...paginationMarks]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bookmanager-viewer-highlights:' + files[0].path }));
    await until(() => badge('주석') === '141', 'Bulk annotation storage change did not update the catalog');
    const underlineFilter = [...document.querySelectorAll('.annotations-style-filters button')].find(node => node.textContent.includes('밑줄'));
    check(underlineFilter, 'Underline style filter is missing'); underlineFilter.click(); await frame();
    check(document.querySelectorAll('.annotation-card').length === 100, 'Large annotation results must initially render only one page');
    checkAnnotationDates();
    check(document.querySelectorAll('time.annotation-date').length === 2, 'Each paginated calendar day must have only one date label');
    check(!button('주석 더 보기'), 'Automatic pagination must not require a load-more button');
    checkCatalogFooter('주석 141개');
    const monthButtons = [...document.querySelectorAll('button.annotations-chart-column')];
    check(monthButtons.length === 12, 'Monthly activity must expose twelve filter buttons');
    monthButtons.at(-1).click(); await frame();
    check(monthButtons.at(-1).getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.annotation-card').length === 65, 'Current month filter must combine with the style filter');
    monthButtons.at(-2).click(); await frame();
    check(document.querySelectorAll('.annotation-card').length === 64, 'Changing the activity month must replace its previous filter');
    monthButtons.at(-2).click(); await frame();
    check(document.querySelectorAll('.annotation-card').length === 100, 'Toggling a month off must restore the paginated result');
    const annotationScroller = document.querySelector('.annotations-feed-scroll');
    check(annotationScroller && annotationScroller.scrollHeight > annotationScroller.clientHeight, 'Wide annotations must have a scrollable feed');
    annotationScroller.scrollTop = annotationScroller.scrollHeight;
    annotationScroller.dispatchEvent(new Event('scroll'));
    await until(() => document.querySelectorAll('.annotation-card').length === 130, 'Scrolling to the sentinel did not automatically load the next annotation page');
    checkAnnotationDates();
    check(document.querySelectorAll('time.annotation-date').length === 2, 'Appending another page must not repeat the preceding calendar day label');
    check([...document.querySelectorAll('.annotations-month')].some(group => group.textContent.includes('날짜 정보 없음')), 'Automatic pagination lost the undated annotation group');
    const unknownDate = document.querySelector('.annotation-entry > .annotation-date.is-unknown');
    check(unknownDate?.textContent === '날짜 정보 없음' && !unknownDate.hasAttribute('datetime'), 'Undated annotations must retain an explicit left-rail label without inventing a timestamp');
    await click('필터 초기화');
    const highlightFilter = [...document.querySelectorAll('.annotations-style-filters button')].find(node => node.textContent.includes('하이라이트'));
    highlightFilter.click(); await frame();
    check(document.querySelectorAll('.annotation-card').length === 11, 'Highlight style filter must exclude underlines');
    await click('필터 초기화');
    localStorage.setItem('bookmanager-viewer-highlights:' + files[0].path, JSON.stringify(updated));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bookmanager-viewer-highlights:' + files[0].path }));
    await until(() => badge('주석') === '11' && document.querySelectorAll('.annotation-card').length === 11, 'Annotation fixtures did not restore after pagination checks');
    await capture('annotations-narrow', true);
    const browser = document.querySelector('.annotations-browser');
    check(browser.scrollWidth <= browser.clientWidth + 1, 'Narrow annotations overflow horizontally');
    checkAnnotationDates();
    const narrowControls = checkAnnotationToolbar();
    const narrowSort = narrowControls.querySelector('button[aria-label="주석 정렬"]');
    const annotationSortMenu = await openToolbarMenu(narrowSort);
    const menuBounds = annotationSortMenu.getBoundingClientRect();
    check(menuBounds.left >= 0 && menuBounds.right <= innerWidth && menuBounds.top >= 0 && menuBounds.bottom <= innerHeight, 'Annotation sort menu must stay inside the narrow window');
    await until(() => !annotationSortMenu.getAnimations().some(animation => animation.playState === 'running')
        && Number(getComputedStyle(annotationSortMenu).opacity) === 1, 'Annotation sort menu must finish opening before capture');
    await capture('annotations-sort-menu');
    await nativeEscape();
    check(narrowSort.getAttribute('aria-expanded') === 'false' && document.activeElement === narrowSort, 'Closing the annotation menu must restore trigger focus');
    const topToolbar = narrowControls.closest('.right-toolbar');
    check(topToolbar.scrollWidth <= topToolbar.clientWidth + 1, 'Narrow annotation toolbar overflows horizontally');
    const topBounds = topToolbar.getBoundingClientRect();
    check([...narrowControls.querySelectorAll('button')].every(control => {
        const bounds = control.getBoundingClientRect();
        return bounds.left >= topBounds.left && bounds.right <= topBounds.right + 1;
    }), 'Narrow annotation controls must remain inside the toolbar');
    const narrowSummary = document.querySelector('.annotations-summary');
    check(narrowSummary.querySelector('.annotations-summary-content') && getComputedStyle(narrowSummary).display !== 'none' && !narrowSummary.querySelector('button[aria-expanded]'), 'Narrow statistics and filters must remain visible without a collapse control');
    check(document.querySelector('.annotations-feed').getBoundingClientRect().top >= document.querySelector('.annotations-summary').getBoundingClientRect().bottom,
        'Narrow annotation statistics overlap the feed');
    checkCatalogFooter('주석 11개');
    check(document.querySelector('.right-bottom-bar').getBoundingClientRect().bottom <= window.innerHeight, 'Narrow catalog bottom bar is outside the window');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.author-card').length === names.length, 'Returning to authors failed');
    localStorage.setItem('bookmanager-viewer-highlights:' + files[0].path, JSON.stringify(updated.slice(0, -1)));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bookmanager-viewer-highlights:' + files[0].path }));
    await until(() => badge('주석') === '10', 'Annotation badge did not refresh while its view was closed');
    localStorage.setItem('bookmanager-viewer-highlights:' + files[0].path, JSON.stringify(updated));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bookmanager-viewer-highlights:' + files[0].path }));
    await until(() => badge('주석') === '11', 'Annotation badge did not restore the saved count');
    await capture('authors-narrow', true);
    const authors = document.querySelector('.authors-browser');
    check(authors.scrollWidth <= authors.clientWidth + 1, 'Narrow authors overflow horizontally');
    const narrowRail = document.querySelector('.authors-browser-shell > .folder-character-index').getBoundingClientRect();
    check(narrowRail.right <= authors.getBoundingClientRect().right, 'Narrow character index is outside the panel');
    check([...document.querySelectorAll('.author-card')].every(card => card.getBoundingClientRect().right <= narrowRail.left), 'Narrow character index overlaps author cards');
    await nativeEnter([...document.querySelectorAll('.author-card')].find(node => node.textContent.includes('김초엽')));
    await until(() => document.querySelector('.author-profile'), 'Author detail unavailable after revisit');
    check(document.querySelector('.author-profile a')?.href === 'https://ko.wikipedia.org/?curid=12345', 'Manual profile did not persist across view changes');
    await nativeEnter(button('사진 변경'));
    const photoToggle = button('사진 변경');
    check(photoToggle.getAttribute('aria-haspopup') === 'dialog' && profileEditor()?.open, 'Photo control must open its dialog');
    check(profileEditor().querySelector('input[aria-label="저자 이름 또는 작품명"]') === document.activeElement, 'Opening photo search must focus its input');
    await nativeEscape();
    await until(() => !profileEditor(), 'Escape did not close the photo picker');
    check(document.activeElement === photoToggle, 'Closing photo search must restore focus to its toggle');
    check(document.querySelector('.author-profile h2')?.textContent === '김초엽', 'Closing photo search must stay in author detail');
    await nativeEnter(button('사진 변경'));
    const submitPhotos = async () => {
        const source = profileEditor().querySelector('select[aria-label="검색 소스"]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(source, 'naver');
        source.dispatchEvent(new Event('change', { bubbles: true }));
        await frame();
        profileEditor().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    const applyPhoto = async () => {
        await until(() => button('이 사진 사용', profileEditor()) && !button('이 사진 사용', profileEditor()).disabled, 'The selected photo should be ready for applying');
        await click('이 사진 사용', profileEditor());
    };
    await submitPhotos();
    await until(() => profileEditor()?.querySelector('[role="alert"]')?.textContent.includes('Client ID'), 'Missing Naver keys must explain how to configure them');
    check(!document.querySelector('.author-editor-result') && photoSelections.length === 0, 'Missing keys must not select a photo');
    naverConfigured = true;
    await submitPhotos();
    await until(() => document.querySelector('.author-editor-result:not(:disabled)'), 'Naver previews did not become selectable');
    await click('사진 더 보기', profileEditor());
    await until(() => document.querySelectorAll('.author-editor-result:not(:disabled)').length === 2, 'Naver pagination lost the existing candidates');
    check(photoQueries.at(-1).start === 21 && photoQueries.at(-1).query === '김초엽', 'Naver pagination changed the query');
    await capture('author-naver-photos', true);
    await nativeEnter(document.querySelectorAll('.author-editor-result')[1]);
    await applyPhoto();
    await until(() => !profileEditor(), 'Selecting a Naver photo did not close the picker');
    const selectedPhoto = JSON.parse(localStorage.getItem('bookmanager.authorProfiles'))['김초엽'];
    check(selectedPhoto.provider === 'wikipedia' && selectedPhoto.id === 'wikipedia:ko:12345' && selectedPhoto.description === '대한민국의 소설가', 'Changing a photo replaced author metadata');
    check(selectedPhoto.photoOverride.id === 'b'.repeat(64), 'Selected Naver photo was not persisted');
    await until(() => document.querySelector('.author-profile-portrait img')?.naturalWidth > 0 && document.querySelector('.author-profile-portrait img')?.src.startsWith('bookmanager-thumbnail://author-photo/'), 'Selected local photo was not displayed');
    check(document.querySelector('.author-image-credit a')?.href === 'https://example.org/author.jpg' && !document.querySelector('.author-image-credit').textContent.includes('CC BY-SA'), 'Photo replacement must update its source and clear old attribution');
    check(releasedPhotoSearches > 0, 'Closing the picker must release its search session');
    toolbarBack().click();
    await until(() => !document.querySelector('.author-profile'), 'Author navigation failed after selecting a photo');
    await nativeEnter(authorCard('김초엽'));
    await until(() => document.querySelector('.author-profile-portrait img')?.src.includes('b'.repeat(64)), 'Selected photo did not persist after navigating away');
    await nativeEnter(button('사진 변경')); await submitPhotos();
    await until(() => document.querySelector('.author-editor-result:not(:disabled)'), 'Pending photo test did not load candidates');
    let finishPhotoSelection;
    photoSelectionGate = new Promise(resolve => { finishPhotoSelection = resolve; });
    document.querySelector('.author-editor-result').click();
    await until(() => profileEditor()?.querySelector('[aria-busy="true"]'), 'Photo selection did not enter a pending state');
    const updatedProfiles = JSON.parse(localStorage.getItem('bookmanager.authorProfiles'));
    updatedProfiles['김초엽'] = { ...updatedProfiles['김초엽'], description: '갱신된 작가 소개' };
    localStorage.setItem('bookmanager.authorProfiles', JSON.stringify(updatedProfiles));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bookmanager.authorProfiles' }));
    await until(() => document.querySelector('.author-profile').textContent.includes('갱신된 작가 소개'), 'Profile refresh during photo download did not render');
    photoSelectionGate = null; finishPhotoSelection();
    await applyPhoto();
    await until(() => !profileEditor(), 'Pending photo selection did not finish');
    check(JSON.parse(localStorage.getItem('bookmanager.authorProfiles'))['김초엽'].description === '갱신된 작가 소개', 'A photo download overwrote newer author metadata');
    await nativeEnter(button('사진 변경')); await submitPhotos();
    await until(() => document.querySelector('.author-editor-result:not(:disabled)'), 'Cancellation photo test did not load candidates');
    photoSelectionGate = new Promise(resolve => { finishPhotoSelection = resolve; });
    document.querySelector('.author-editor-result').click();
    await until(() => profileEditor()?.querySelector('[aria-busy="true"]'), 'Cancellation photo test did not start downloading');
    await nativeEscape();
    await until(() => !profileEditor(), 'A pending photo preview should be cancellable');
    await click('자동으로 찾기');
    await until(() => !profileEditor() && document.querySelector('.author-profile a')?.href === 'https://www.wikidata.org/wiki/Q12345', 'Automatic selection did not dismiss a pending photo download');
    photoSelectionGate = null; finishPhotoSelection(); await frame(); await frame();
    check(!JSON.parse(localStorage.getItem('bookmanager.authorProfiles'))['김초엽'], 'A late photo download overwrote automatic selection');
    const manualQueries = apiQueries.filter(name => name === '김초엽').length;
    await click('이니셜로 표시');
    check(JSON.parse(localStorage.getItem('bookmanager.authorProfiles'))['김초엽'] === null, 'Initials override was not saved');
    toolbarBack().click();
    await until(() => !document.querySelector('.author-profile'), 'Toolbar back did not return to the author list');
    await nativeEnter(authorCard('김초엽'));
    await until(() => document.querySelector('.author-profile'), 'Author detail did not reopen');
    check(!document.querySelector('.author-profile-portrait img'), 'Automatic lookup overwrote initials override');
    check(apiQueries.filter(name => name === '김초엽').length === manualQueries, 'Manual overrides must skip automatic requests');
    await click('자동으로 찾기');
    await until(() => document.querySelector('.author-profile a')?.href === 'https://www.wikidata.org/wiki/Q12345', 'Automatic lookup could not be resumed');
    await capture('author-detail-narrow', true);
    checkProfileLayout(true);
    check(authors.scrollWidth <= authors.clientWidth + 1, 'Narrow author detail overflow horizontally');
    document.querySelector('.author-books').scrollIntoView({ block: 'end' });
    await capture('author-books-grid-narrow', true);
    await click('목록 보기');
    document.querySelector('.author-books').scrollIntoView({ block: 'start' });
    await capture('author-books-list-narrow', true);
    check(authors.scrollWidth <= authors.clientWidth + 1, 'Narrow owned book list overflow horizontally');
    toolbarBack().click();
    await until(() => !document.querySelector('.author-profile'), 'Toolbar back did not return to the author list');
    await nativeEnter(authorCard(longAuthorName));
    await until(() => document.querySelector('#author-profile-heading')?.textContent === longAuthorName && document.querySelector('.author-profile').textContent.includes('여러 나라의 도서관'), 'Long author profile did not load');
    await capture('author-detail-long-narrow', true);
    checkProfileLayout(true);
    check(authors.scrollWidth <= authors.clientWidth + 1, 'Long author identity overflowed the narrow panel');
    check(document.querySelector('#author-profile-heading').scrollHeight <= document.querySelector('#author-profile-heading').clientHeight + 1, 'Long author names must remain fully readable');
    toolbarBack().click();
    await until(() => !document.querySelector('.author-profile'), 'Long author back navigation failed');
    await nativeEnter(authorCard('김애란'));
    await until(() => document.querySelector('.author-profile h2')?.textContent === '김애란', 'Author without a profile did not open');
    for (const candidateIndex of [0, 1]) {
        await nativeEnter(button('사진 변경')); await submitPhotos();
        await until(() => document.querySelector('.author-editor-result:not(:disabled)'), 'Standalone photo search failed');
        if (candidateIndex) { await click('사진 더 보기', profileEditor()); await until(() => document.querySelectorAll('.author-editor-result:not(:disabled)').length === 2, 'Replacement photo results failed'); }
        document.querySelectorAll('.author-editor-result')[candidateIndex].click();
        await applyPhoto();
        await until(() => !profileEditor(), 'Standalone photo selection failed');
        const savedPhoto = JSON.parse(localStorage.getItem('bookmanager.authorProfiles'))['김애란'];
        check(savedPhoto.provider === 'local' && savedPhoto.id === (candidateIndex ? 'b' : 'a').repeat(64), 'Standalone Naver photos must support replacing the previous selection');
    }
    toolbarBack().click();
    await until(() => !document.querySelector('.author-profile'), 'Standalone photo back navigation failed');
    await nativeEnter(authorCard('김금희'));
    await until(() => document.querySelector('.author-profile') && !document.querySelector('.author-profile-portrait img'), 'Missing photo did not settle');
    await click('이니셜로 표시');
    await new Promise(resolve => { window.continuePhoto = resolve; console.log('CATALOG_ALLOW_PHOTO'); });
    allowMissingProfilePhoto = true;
    await click('자동으로 찾기');
    await until(() => document.querySelector('.author-profile-portrait img')?.naturalWidth > 0, 'Retrying the same failed photo URL must load it again');
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('.annotations-browser') && toolbarBack().disabled, 'Leaving author detail did not clear its back action');
    const largeBookTotal = 80000;
    const largeAuthorTotal = 4564;
    const expectedLargeStatus = '저자 4,564명 · 도서 80,000권';
    files = [...files, ...Array.from({ length: largeBookTotal - files.length }, (_, index) => ({
        path: '/fixture/large-' + index + '.epub', name: 'Large book ' + index + '.epub', title: 'Large book ' + index,
        writer: '작가 ' + index % (largeAuthorTotal - names.length), ext: '.epub', size: 3000,
    }))];
    let releaseCatalog;
    catalogResponseGate = new Promise(resolve => { releaseCatalog = resolve; });
    const responsesBeforeColdEntry = catalogResponses;
    const requestsBeforeColdEntry = requests.filter(request => request.id === 'library-catalog').length;
    const finishColdEntry = measureResponsiveness(() => catalogResponses > responsesBeforeColdEntry && statusText() !== expectedLargeStatus);
    root.render(<FolderTab key="cold-catalog" config={{ libraries: ['/fixture'], folder_view_mode: 'table', language: 'ko' }} t={t} saveConfig={async () => {}} showToast={() => {}} />);
    await until(() => requests.filter(request => request.id === 'library-catalog').length > requestsBeforeColdEntry, 'Cold catalog did not request fresh data');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('.recent-reading-state[role="status"]'), 'Cold author entry did not show a loading state while awaiting its catalog');
    releaseCatalog();
    catalogResponseGate = null;
    await until(() => statusText() === expectedLargeStatus && document.querySelectorAll('.author-card').length === 180, 'Large cold catalog totals incorrect');
    const coldEntry = finishColdEntry();
    check(coldEntry.processingFrames > 0, 'Large catalog preparation must return control to rendering before publishing its totals');
    check(document.querySelectorAll('.author-card').length === 180, 'Large author catalog rendered every card on entry');
    const requestsBeforeRepeatedSelection = requests.filter(request => request.id === 'library-catalog').length;
    const firstAuthorCard = document.querySelector('.author-card');
    await click('저자', document.querySelector('.sidebar-container'));
    check(requests.filter(request => request.id === 'library-catalog').length === requestsBeforeRepeatedSelection, 'Selecting the active catalog menu must not reload the entire library');
    check(document.querySelector('.author-card') === firstAuthorCard, 'Selecting the active catalog menu must retain its mounted cards');
    const largeAuthorList = document.querySelector('.authors-browser');
    check(!largeAuthorList.querySelector('.author-load-more'), 'Author list must load more by scrolling without a button');
    largeAuthorList.scrollTop = largeAuthorList.scrollHeight;
    await until(() => document.querySelectorAll('.author-card').length === 360, 'Scrolling to the end did not append the next author batch');
    for (let index = 0; index < 5; index += 1) await frame();
    check(document.querySelectorAll('.author-card').length === 360, 'Author scrolling eagerly loaded batches beyond the viewport');
    const appendedAuthor = document.querySelectorAll('.author-card')[200];
    appendedAuthor.scrollIntoView({ block: 'center' }); await frame();
    const appendedScrollTop = largeAuthorList.scrollTop;
    appendedAuthor.click();
    await until(() => document.querySelector('.author-profile'), 'Appended author did not open its profile');
    toolbarBack().click();
    await until(() => !document.querySelector('.author-profile'), 'Appended author did not return to its list');
    check(document.querySelectorAll('.author-card').length === 360, 'Back navigation lost the appended author batch');
    check(Math.abs(largeAuthorList.scrollTop - appendedScrollTop) < 1, 'Back navigation lost the appended author scroll position');
    check(document.activeElement.dataset.authorKey === appendedAuthor.dataset.authorKey, 'Back navigation lost appended author focus');
    largeAuthorList.scrollTop = largeAuthorList.scrollHeight;
    await until(() => document.querySelectorAll('.author-card').length === 540, 'Further scrolling did not append another author batch');
    const authorSearch = document.querySelector('.search-input');
    setInput(authorSearch, '작가 4542'); await frame();
    authorSearch.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => document.querySelectorAll('.author-card').length === 1, 'Search did not reset the appended author list');
    check(!document.querySelector('.author-scroll-sentinel'), 'A complete search result kept its load sentinel');
    setInput(authorSearch, ''); await frame();
    authorSearch.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => document.querySelectorAll('.author-card').length === 180, 'Clearing search did not restore the first author batch');
    check(largeAuthorList.scrollTop === 0, 'Clearing search did not reset author scroll position');
    const readsBeforeAnnotations = highlightReads;
    const annotationsStart = performance.now();
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => document.querySelectorAll('.annotation-card').length === 11, 'Sparse annotations in the large library were lost');
    const largeAnnotationsMs = Math.round(performance.now() - annotationsStart);
    check(highlightReads === readsBeforeAnnotations, 'Annotations must reuse the badge data without reading storage again');
    const annotationStorageReads = highlightReads - readsBeforeAnnotations;
    check(badge('저자') === String(largeAuthorTotal) && badge('주석') === '11', 'Library updates did not refresh both badges');
    const catalogRequests = requests.filter(request => request.id === 'library-catalog').length;
    [...document.querySelectorAll('.sidebar-container button')].find(item => item.textContent.includes('읽고 싶은 책')).click();
    await until(() => !document.querySelector('.annotations-browser'), 'Manual list did not open');
    check(badge('저자') === String(largeAuthorTotal) && badge('주석') === '11', 'Navigating to another list cleared the catalog badges');
    const revisitStart = performance.now();
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => statusText() === expectedLargeStatus, 'Cached catalog revisit lost totals');
    const revisitMs = Math.round(performance.now() - revisitStart);
    check(requests.filter(request => request.id === 'library-catalog').length === catalogRequests, 'Catalog revisit repeated the full library IPC');
    const responsesBeforeFocus = catalogResponses;
    const finishFocusEntry = measureResponsiveness(() => catalogResponses > responsesBeforeFocus
        && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'true');
    window.dispatchEvent(new Event('focus'));
    await click('주석', document.querySelector('.sidebar-container'));
    await until(() => catalogResponses > responsesBeforeFocus
        && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false'
        && document.querySelectorAll('.annotation-card').length === 11, 'Focus refresh interrupted annotation entry');
    const focusEntry = finishFocusEntry();
    check(badge('저자') === String(largeAuthorTotal) && badge('주석') === '11', 'Focus refresh lost catalog counts');
    await click('저자', document.querySelector('.sidebar-container'));
    await until(() => statusText() === expectedLargeStatus, 'Authors did not return after the focus refresh');
    const catalogBookCount = files.length;
    files = [];
    changed();
    await until(() => badge('저자') === '0' && badge('주석') === '0', 'Empty library must show zero badges');
    checkCatalogFooter('저자 0명 · 도서 0권');
    root.unmount();
    return { authorCount: names.length, annotationCount: 11, keyboardOpenedBooks: opened.length, profilePersisted: true, automaticPhotos: true, permanentPhotos: { automatic: true, manual: true, failedSavePreservesPhoto: true, retry: true }, backgroundPhotos: { beforeAuthorPage: true, repeatedCatalogRefreshes: backgroundRefreshes, sharedRequest: true, continuesAfterLeaving: true, cached: true }, initialsFallback: true, manualOverride: true, narrowLayout: true, authorBackNavigation: true,
        sidebarBadges: true, automaticAuthorScroll: true, annotationTools: { grouping: true, compact: true, copy: true, delete: true, hoverActions: true, actionFade: true, actionTooltips: true, alwaysVisibleFilters: true, monthlyFilters: true, automaticScroll: true },
        largeCatalog: { books: catalogBookCount, authors: largeAuthorTotal, coldEntry, focusEntry, largeAnnotationsMs, revisitMs, annotationStorageReads } };
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        await fs.writeFile(path.join(directory, 'profile.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#678"/><circle cx="40" cy="30" r="15" fill="#cde"/><path d="M10 80a30 30 0 0 1 60 0" fill="#cde"/></svg>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-thumbnail', privileges: { standard: true, secure: true } }]);
app.whenReady().then(async () => {
    protocol.handle('bookmanager-thumbnail', async () => new Response(await fs.readFile(${JSON.stringify(path.join(directory, 'profile.svg'))}), { headers: { 'Content-Type': 'image/svg+xml' } }));
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { backgroundThrottling: false } });
    let allowMissingPhoto = false;
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://covers.openlibrary.org/*', 'https://upload.wikimedia.org/*'] }, (request, callback) => callback(
        request.url.includes('OL404A') && !allowMissingPhoto ? { cancel: true } : { redirectURL: ${JSON.stringify(`${fixtureUrl}profile.svg`)} }
    ));
    window.webContents.on('console-message', async (_event, level, message) => {
        if (message === 'CATALOG_ALLOW_PHOTO') {
            allowMissingPhoto = true;
            await window.webContents.executeJavaScript('window.continuePhoto()');
        }
        if (message === 'CATALOG_ENTER') {
            window.webContents.focus();
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
            window.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
            await window.webContents.executeJavaScript('window.continueNative()');
        }
        if (message === 'CATALOG_ESCAPE') {
            window.webContents.focus();
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await window.webContents.executeJavaScript('window.continueEscape()');
        }
        if (message === 'CATALOG_HOVER') {
            const point = await window.webContents.executeJavaScript('window.hoverPoint');
            window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
            await window.webContents.executeJavaScript('window.continueHover()');
        }
        if (message === 'CATALOG_CAPTURE') {
            const request = await window.webContents.executeJavaScript('window.captureRequest');
            if (request.narrow) window.setSize(760, 850);
            await new Promise(resolve => setTimeout(resolve, 100));
            if (${JSON.stringify(captureDirectory || '')}) {
                const screenshot = await window.webContents.capturePage();
                await fs.writeFile(path.join(${JSON.stringify(captureDirectory || '')}, request.name + '.png'), screenshot.toPNG());
            }
            await window.webContents.executeJavaScript('window.continueCapture()');
        }
        if (level >= 2 && !message.includes('ERR_BLOCKED')) console.error(message);
    });
    try {
        await window.loadURL(${JSON.stringify(fixtureUrl)});
        const result = await window.webContents.executeJavaScript('window.catalogResult');
        console.log('CATALOG_RESULT=' + JSON.stringify(result));
        app.exit(0);
    } catch (error) { console.error(error.stack || error); app.exit(1); }
});
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error('Catalog renderer timed out: ' + output)); }, 45000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
        });
        assert.equal(result.code, 0, result.output);
        const report = JSON.parse(result.output.match(/CATALOG_RESULT=(.+)/)[1]);
        assert.equal(report.keyboardOpenedBooks, 3);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
