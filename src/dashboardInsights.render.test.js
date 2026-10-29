import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('대시보드의 취향·문장·완독 책장과 독서 달력·월간 목표·시간 통계를 실제 화면에서 연결한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-insights-render-')));
    const captureDirectory = process.env.BOOKMANAGER_INSIGHTS_CAPTURE_DIR;
    if (captureDirectory) await fs.mkdir(captureDirectory, { recursive: true });
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReadingDashboard } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/folder/ReadingDashboard.jsx')}`)};
import { dashboardDate, dashboardMonth, dashboardMonthDays, readingDurationLabel, shiftDashboardMonth } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/dashboardActivityState.js')}`)};
import { RECOMMENDATION_PREFERENCES_STORAGE_KEY } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/recommendationPreferencesState.js')}`)};
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
const currentMonth = dashboardMonth();
const previousMonth = shiftDashboardMonth(currentMonth, -1);
const activeDate = currentMonth + '-01';
const colors = ['#3b5965', '#7c4844', '#797052', '#4e5c48', '#57516d', '#4d6881'];
const titles = ['오후의 책방', '낯선 도시를 걷다', '기억의 숲', '작은 정원의 계절', '어느 여행의 문장', '빛이 머무는 자리', '다시 읽는 이야기', '바다를 건너온 편지', '침묵의 도서관', '사라진 시간의 지도', '우리의 짧은 역사', '별과 밤의 기록', '첫 번째 모험', '느리게 읽는 하루'];
const files = titles.map((title, index) => {
    const filePath = '/fixture/' + (index % 2 ? 'essays' : 'books') + '/book-' + index + '.epub';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340"><rect width="240" height="340" fill="' + colors[index % colors.length] + '"/><circle cx="170" cy="115" r="65" fill="#edd7a5" opacity=".7"/><path d="M0 260L240 160V340H0Z" fill="#13252d" opacity=".8"/><text x="22" y="45" fill="#f8edd3" font-family="serif" font-size="15">READING JOURNAL</text><text x="22" y="302" fill="#f8edd3" font-family="sans-serif" font-size="24">BOOK ' + String(index + 1).padStart(2, '0') + '</text></svg>';
    return { path: filePath, full_path: filePath, name: 'book-' + index + '.epub', title, writer: ['김서연', '박지우', '이하늘'][index % 3], genre: index % 2 ? 'Essay' : 'Fantasy', ext: '.epub', size: 2048, exists: true, has_metadata: true, cover: 'data:image/svg+xml,' + encodeURIComponent(svg), readingListAddedAt: new Date().toISOString() };
});
const originalCatalog = { entries: [
    { id: 'passage-1', text: '책을 펼치는 순간 우리는 아직 가 보지 못한 세계의 문 앞에 선다. 그 문을 지나는 데 필요한 것은 작은 호기심 하나뿐이다.', title: files[0].title, author: files[0].writer, file: files[0] },
    { id: 'passage-2', text: '천천히 걷는 사람에게만 보이는 풍경이 있다. 오래 들여다본 문장에는 처음 읽었을 때 발견하지 못했던 작은 빛이 남아 있었다. '.repeat(4), title: files[1].title, author: files[1].writer, file: files[1] },
], errors: [] };
let annotationCatalog = originalCatalog;
let mountKey = 0;
let failDashboard = false;
let failGoal = false;
let failCopy = false;
let syncedOnly = false;
const heldMonths = new Set();
const pending = [];
const goals = new Map([[currentMonth, { books: 3, minutes: 300 }]]);
const requests = [];
const opened = [];
const navigated = [];
const copied = [];
let annotationRefreshes = 0;
const recentListeners = new Set();
const listListeners = new Set();
function resultFor(month) {
    const { dates } = dashboardMonthDays(month);
    const active = month + '-01';
    const seconds = month === currentMonth ? 4200 : 1020;
    return { success: true, month, trackingStartedAt: new Date(currentMonth + '-01T12:00:00').toISOString(),
        days: dates.map(date => ({ date, seconds: date === active ? seconds : 0, completedCount: date === active ? 2 : 0, bookCount: date === active && !syncedOnly ? 2 : 0,
            hasActivity: date === active, hasSyncedActivity: date === active, syncedSeconds: date === active ? syncedOnly ? seconds : 600 : 0, syncedBookCount: date === active ? 3 : 0,
            books: date === active && !syncedOnly ? [{ path: files[0].path, seconds: Math.max(0, seconds - 1200), completed: true }, { path: files[1].path, seconds: Math.min(600, seconds - 600), completed: true }] : [] })),
        totals: { seconds, readingDays: 1, completedBooks: 2 }, goal: goals.get(month) || { books: 0, minutes: 0 },
        completedFiles: files.slice(0, 12), completedCount: 12, sync: { source: 'readive', lastSyncedAt: new Date().toISOString(), syncedDevices: 1 },
    };
}
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
    if (failCopy) throw new Error('Clipboard unavailable');
    copied.push(text);
} } });
window.electronAPI = {
    getReadingStates: async paths => paths.filter(filePath => files.slice(0, 12).some(file => file.path === filePath)).map(filePath => ({ filePath, status: 'completed' })),
    getFilePreview: async filePath => ({ success: true, file: { ...files.find(file => file.path === filePath), description: '기억에 남는 장면과 작은 발견을 담은 이야기. 책장을 넘길 때마다 조금씩 다른 풍경이 펼쳐집니다.' } }),
    onRecentReadingChanged: callback => { recentListeners.add(callback); return () => recentListeners.delete(callback); },
    onReadingListsChanged: callback => { listListeners.add(callback); return () => listListeners.delete(callback); },
    readingLists: async request => {
        requests.push(structuredClone(request));
        if (request.operation === 'dashboard-goal') {
            if (failGoal) return { success: false, error: 'goal_write_failed' };
            goals.set(request.month, { ...request.goal });
            return { success: true, month: request.month, goal: request.goal };
        }
        if (request.operation === 'dashboard') {
            if (failDashboard) return { success: false, error: 'offline' };
            const result = structuredClone(resultFor(request.month));
            if (heldMonths.has(request.month)) return new Promise(resolve => pending.push({ month: request.month, release: () => resolve(result) }));
            return result;
        }
        return { success: true, files: [], collections: [] };
    },
};
applyMotionPreference('reduced');
const root = createRoot(document.getElementById('root'));
const render = (remount = false) => {
    if (remount) mountKey += 1;
    root.render(<div className="folder-tab"><ReadingDashboard key={mountKey} t={t} language="ko" files={files} recentFiles={[]}
        libraries={['/fixture/books', '/fixture/essays']} collections={[{ id: 'weekend', name: '주말의 책', count: 4 }]} wishlistCount={5} recentAddedCount={7}
        annotationCatalog={annotationCatalog} onRefreshAnnotations={() => { annotationRefreshes += 1; annotationCatalog = originalCatalog; render(); }}
        onOpenFile={file => opened.push(file.path || file.full_path)} onNavigate={kind => navigated.push(kind)} onOpenLibrarySettings={() => {}} onRefreshRecent={() => {}} /></div>);
};
const byLabel = (label, scope = document) => [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === label || button.getAttribute('aria-label') === label);
const journal = () => document.querySelector('.dashboard-journal');
const goal = () => document.querySelector('.dashboard-monthly-goal');
const passage = () => document.querySelector('.dashboard-passage');
const shelf = () => document.querySelector('.dashboard-finished');
const recommendation = () => document.querySelector('.reading-dashboard-recommendation');
const preferences = () => document.querySelector('.recommendation-preferences');
const setInput = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
};
async function ready(month = currentMonth) {
    await until(() => journal()?.getAttribute('aria-busy') === 'false' && goal()?.dataset.month === month && shelf()?.querySelector('.dashboard-finished-book'), 'Dashboard insight sections did not load for ' + month);
    await frames();
}
function releaseMonth(month) {
    heldMonths.delete(month);
    for (const item of pending.filter(item => item.month === month)) item.release();
}
async function openPreferences() {
    const button = byLabel(t('recommendation_preferences.title'));
    check(button, 'Recommendation preference trigger is missing');
    button.focus();
    button.click();
    await until(() => preferences()?.open, 'Recommendation preferences did not open');
    check(preferences().contains(document.activeElement), 'Preferences did not trap initial focus');
    return button;
}
window.runDashboardInsightsTests = async () => {
    render(true);
    await ready();
    await until(() => recommendation()?.dataset.filePath, 'Recommendation fixture did not load');
    check(document.querySelector('.dashboard-time-total strong').textContent === readingDurationLabel(4200, t), 'Reading-time total is incorrect');
    check(journal().querySelector('.dashboard-tracking-note').textContent.includes(t('dashboard.tracking_hint')), 'Tracking limitations are missing');
    journal().querySelector('[data-date="' + activeDate + '"]').click();
    await until(() => journal().querySelector('.dashboard-day-detail button'), 'Selected calendar day did not show its books');
    journal().querySelector('.dashboard-day-detail button').click();
    check(opened.at(-1) === files[0].path, 'Calendar day opened the wrong book');
    check(journal().querySelector('.dashboard-synced-activity')?.textContent === t('dashboard.synced_day', [readingDurationLabel(600, t), 3]), 'Readive daily totals were not distinguished from local book details');
    syncedOnly = true;
    render(true);
    await ready();
    journal().querySelector('[data-date="' + activeDate + '"]').click();
    await frames();
    check(journal().querySelector('.dashboard-synced-activity')?.textContent.includes(readingDurationLabel(4200, t)), 'Readive-only activity disappeared from the selected day');
    check(!journal().querySelector('.dashboard-day-detail').textContent.includes(t('dashboard.no_day')) && !journal().querySelector('.dashboard-day-detail li'), 'Readive aggregates must not invent per-book times or claim there is no activity');
    syncedOnly = false;
    render(true);
    await ready();

    heldMonths.add(previousMonth);
    byLabel(t('dashboard.previous_month'), journal()).click();
    await until(() => pending.some(item => item.month === previousMonth), 'Previous-month request was not held');
    byLabel(t('dashboard.this_month'), journal()).click();
    await ready();
    releaseMonth(previousMonth);
    await frames(5);
    check(goal()?.dataset.month === currentMonth && document.querySelector('.dashboard-time-total strong').textContent === readingDurationLabel(4200, t), 'Late previous-month response replaced the selected month');
    byLabel(t('dashboard.previous_month'), journal()).click();
    await ready(previousMonth);
    check(document.querySelector('.dashboard-time-total strong').textContent === readingDurationLabel(1020, t), 'Month navigation kept stale totals');
    byLabel(t('dashboard.next_month'), journal()).click();
    await ready();

    byLabel(t('dashboard.edit_goal'), goal()).click();
    await until(() => goal().querySelector('form'), 'Goal editor did not open');
    const bookInput = goal().querySelector('input[aria-label="' + t('dashboard.goal_books') + '"]');
    const hourInput = goal().querySelector('input[aria-label="' + t('dashboard.goal_hours') + '"]');
    setInput(bookInput, 5);
    setInput(hourInput, 7.5);
    await frames();
    failGoal = true;
    goal().querySelector('form').requestSubmit();
    await until(() => goal().querySelector('[role="alert"]'), 'Failed goal save did not show an error');
    check(bookInput.value === '5' && hourInput.value === '7.5' && !bookInput.disabled, 'Failed goal save lost the draft or left it disabled');
    check(goals.get(currentMonth).books === 3, 'Failed save changed persisted goals');
    failGoal = false;
    goal().querySelector('form').requestSubmit();
    await until(() => !goal().querySelector('form') && goals.get(currentMonth).books === 5, 'Goal retry did not finish');
    check(goals.get(currentMonth).minutes === 450, 'Goal hours were not converted to minutes');
    check(goal().querySelector('[role="progressbar"][aria-valuemax="5"]'), 'Saved book goal was not shown');
    render(true);
    await ready();
    check(goal().querySelector('[role="progressbar"][aria-valuemax="5"]'), 'Goal was not restored after remount');

    const originalRandom = Math.random;
    const passageText = () => passage().querySelector('blockquote')?.textContent;
    const activateTab = activeTab => window.dispatchEvent(new CustomEvent('bookmanager:active-tab-changed', { detail: { activeTab } }));
    try {
        Math.random = () => 0;
        render(true);
        await ready();
        check(passageText() === originalCatalog.entries[0].text, 'A dashboard visit should choose a passage with fresh randomness');
        Math.random = () => 0.999;
        render();
        await frames();
        check(passageText() === originalCatalog.entries[0].text, 'Ordinary dashboard rerenders must not reroll the selected passage');
        annotationCatalog = { entries: originalCatalog.entries.map(entry => ({ ...entry })), errors: [] };
        render();
        await frames();
        check(passageText() === originalCatalog.entries[0].text, 'Refreshing equivalent annotation entries must preserve the current passage');
        render(true);
        await ready();
        check(passageText() === originalCatalog.entries[1].text, 'Returning to the dashboard on the same day must choose a new random passage');
        Math.random = () => 0;
        await until(() => byLabel(t('dashboard.expand'), passage()), 'The long selected passage must offer expansion');
        byLabel(t('dashboard.expand'), passage()).click();
        await frames();
        check(passageText() === originalCatalog.entries[1].text && passage().querySelector('blockquote').classList.contains('is-expanded'),
            'Expanding a passage must retain the chosen text');
        byLabel(t('dashboard.copy'), passage()).click();
        await until(() => byLabel(t('dashboard.copied'), passage()), 'The chosen passage should remain copyable');
        check(passageText() === originalCatalog.entries[1].text && copied.at(-1) === originalCatalog.entries[1].text,
            'Copying a passage must retain the selected text and copy the whole passage');
        activateTab('metadata');
        await frames();
        check(passageText() === originalCatalog.entries[1].text, 'Leaving the folder tab must not change the hidden passage');
        activateTab('folder');
        await until(() => passageText() === originalCatalog.entries[0].text, 'Returning to a mounted dashboard must reroll its passage');
        await until(() => !passage().querySelector('blockquote').classList.contains('is-expanded') && !byLabel(t('dashboard.copied'), passage()),
            'A newly chosen passage must reset expansion and copy feedback');
        annotationCatalog = { entries: [], errors: [] };
        render(true);
        await ready();
        check(!passage().querySelector('blockquote'), 'An empty catalog must not retain a passage from the previous visit');
        Math.random = () => 0.999;
        annotationCatalog = originalCatalog;
        render();
        await until(() => passageText() === originalCatalog.entries[1].text, 'Annotations loaded after dashboard entry must receive a random initial selection');
        annotationCatalog = { entries: [originalCatalog.entries[0]], errors: [] };
        render(true);
        await ready();
        check(passageText() === originalCatalog.entries[0].text && byLabel(t('dashboard.next_passage'), passage()).disabled,
            'A single passage must remain visible with the other-passage action disabled');
        activateTab('metadata');
        activateTab('folder');
        await frames();
        check(passageText() === originalCatalog.entries[0].text, 'Revisiting with one passage must safely keep that passage');
    } finally {
        Math.random = originalRandom;
        annotationCatalog = originalCatalog;
        render(true);
        await ready();
    }

    const firstPassage = passage().querySelector('blockquote').textContent;
    byLabel(t('dashboard.next_passage'), passage()).click();
    await frames();
    const nextPassage = passage().querySelector('blockquote').textContent;
    check(nextPassage !== firstPassage, 'Another passage did not change the saved text');
    byLabel(t('dashboard.copy'), passage()).click();
    await until(() => copied.at(-1) === nextPassage && byLabel(t('dashboard.copied'), passage()), 'Passage copy did not copy the full text');
    const selectedEntry = originalCatalog.entries.find(entry => entry.text === nextPassage);
    passage().querySelector('.dashboard-passage-book').click();
    check(opened.at(-1) === selectedEntry.file.path, 'Passage opened the wrong book');
    byLabel(t('dashboard.all_passages'), passage()).click();
    check(navigated.at(-1) === 'annotations', 'All passages did not navigate to annotations');
    byLabel(t('dashboard.next_passage'), passage()).click();
    await frames();
    failCopy = true;
    byLabel(t('dashboard.copy'), passage()).click();
    await until(() => passage().textContent.includes(t('dashboard.copy_failed')), 'Clipboard failure was not explained');
    failCopy = false;
    annotationCatalog = { entries: [], errors: [] };
    render();
    await until(() => passage().textContent.includes(t('dashboard.passage_empty')), 'Empty passages retained the previous quote');
    check(!passage().querySelector('blockquote'), 'Empty passages kept stale text');
    annotationCatalog = { ...originalCatalog, errors: [{ path: '/fixture/broken', error: 'invalid annotation' }] };
    render();
    await until(() => byLabel(t('dashboard.retry'), passage()), 'Partial annotation errors did not offer a retry');
    byLabel(t('dashboard.retry'), passage()).click();
    await until(() => annotationRefreshes === 1 && !passage().textContent.includes(t('dashboard.passage_failed')), 'Annotation retry did not recover');

    const firstShelfTitles = [...shelf().querySelectorAll('.dashboard-finished-book')].map(button => button.title);
    const shelfColumns = getComputedStyle(shelf().querySelector('.dashboard-finished-books')).gridTemplateColumns.split(' ').length;
    check(firstShelfTitles.length === Math.min(12, shelfColumns * 2), 'Finished shelf must fit two rows to its available width');
    byLabel(t('dashboard.next_books'), shelf()).click();
    await frames();
    check(shelf().querySelector('.dashboard-finished-book').title === files[firstShelfTitles.length].title, 'Shelf next page did not advance');
    shelf().querySelector('.dashboard-finished-book').click();
    check(opened.at(-1) === files[firstShelfTitles.length].path, 'Finished shelf opened the wrong book');
    byLabel(t('dashboard.previous_books'), shelf()).click();
    await frames();
    check(shelf().querySelector('.dashboard-finished-book').title === firstShelfTitles[0], 'Shelf previous page did not restore the first books');
    failDashboard = true;
    byLabel(t('dashboard.previous_month'), journal()).click();
    await until(() => journal()?.querySelector('[role="alert"]') && shelf()?.querySelector('.dashboard-finished-book'), 'Cached dashboard failure did not retain its finished shelf');
    check(!shelf().textContent.includes(t('dashboard.shelf_failed')) && document.querySelector('.dashboard-time-total strong').textContent === readingDurationLabel(1020, t), 'Cached month data was cleared after a failed refresh');
    failDashboard = false;
    byLabel(t('dashboard.retry'), journal()).click();
    await ready(previousMonth);
    check(!journal().querySelector('[role="alert"]'), 'Cached dashboard retry did not clear its error');

    const uncachedMonth = shiftDashboardMonth(previousMonth, -1);
    failDashboard = true;
    byLabel(t('dashboard.previous_month'), journal()).click();
    await until(() => journal()?.querySelector('[role="alert"]') && shelf()?.textContent.includes(t('dashboard.shelf_failed')), 'Dashboard and shelf failed state was not shown');
    check(!shelf().querySelector('.dashboard-finished-book'), 'An uncached month displayed a finished shelf from another month');
    failDashboard = false;
    byLabel(t('dashboard.retry'), shelf()).click();
    await ready(uncachedMonth);
    byLabel(t('dashboard.this_month'), journal()).click();
    await ready();

    const trigger = await openPreferences();
    const genreLabel = [...preferences().querySelectorAll('.recommendation-preferences-genres label')].find(label => label.textContent.includes('Fantasy'));
    check(genreLabel, 'Catalog genres were not offered as preferences');
    genreLabel.querySelector('input').click();
    await frames();
    preferences().querySelector('form').requestSubmit();
    await until(() => !preferences() && recommendation()?.dataset.filePath === files[12].path, 'Genre preference did not choose a matching unread book');
    check(JSON.parse(localStorage.getItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY)).genres.includes('fantasy'), 'Genre preference was not persisted');
    check(document.activeElement === trigger, 'Preference apply did not restore focus');
    await openPreferences();
    byLabel(t('recommendation_preferences.exclude_book'), preferences()).click();
    await frames();
    preferences().querySelector('form').requestSubmit();
    await until(() => !preferences() && !recommendation()?.dataset.filePath, 'Excluded book remained eligible');
    check(JSON.parse(localStorage.getItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY)).excludedBooks.some(book => book.path === files[12].path), 'Excluded book was not saved');
    await openPreferences();
    byLabel(t('recommendation_preferences.reset'), preferences()).click();
    await frames();
    preferences().querySelector('form').requestSubmit();
    await until(() => !preferences() && recommendation()?.dataset.filePath, 'Preference reset did not restore an eligible recommendation');
    const beforeCancel = localStorage.getItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY);
    const cancelTrigger = await openPreferences();
    preferences().querySelector('input[type="checkbox"]').click();
    preferences().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => !preferences(), 'Escape did not dismiss preferences');
    check(localStorage.getItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY) === beforeCancel, 'Cancel persisted an unapplied preference');
    check(document.activeElement === cancelTrigger, 'Preference cancel did not restore focus');
    return { calendarBooks: true, monthRace: true, goalRetryPersistence: true, passagesCopyAndRecovery: true, shelfPaginationAndRecovery: true, recommendationPreferences: true };
};
window.verifyInsightsLayout = async (theme = 'dark', section = '') => {
    const panel = document.querySelector('.folder-tab');
    const light = { '--folder-bg': '#eff0f1', '--panel-bg': '#faf9f6', '--panel-bg-2': '#ffffff', '--panel-bg-3': '#f0eee8', '--line': '#d6d4ce', '--line-dark': '#e5e2dc', '--text': '#24282b', '--muted': '#626c70', '--accent': '#267394' };
    for (const key of Object.keys(light)) theme === 'light' ? panel.style.setProperty(key, light[key]) : panel.style.removeProperty(key);
    const dashboard = document.querySelector('.reading-dashboard');
    if (section) document.querySelector(section)?.scrollIntoView({ block: 'start' });
    else dashboard.scrollTop = 0;
    await document.fonts.ready;
    await frames(5);
    check(dashboard.scrollWidth <= dashboard.clientWidth + 1, 'Dashboard overflows horizontally at ' + window.innerWidth + ' in ' + theme);
    for (const element of document.querySelectorAll('.dashboard-journal-grid, .dashboard-calendar-panel, .dashboard-time-panel, .dashboard-passage-card, .dashboard-finished-books')) {
        const bounds = element.getBoundingClientRect();
        check(bounds.left >= -1 && bounds.right <= window.innerWidth + 1, element.className + ' escapes the viewport at ' + window.innerWidth);
    }
    check(journal().querySelectorAll('.dashboard-calendar-days button').length >= 28, 'Calendar dates were clipped from the DOM');
    return true;
};
window.verifyPreferenceLayout = async () => {
    await openPreferences();
    await frames(5);
    const dialog = preferences();
    const bounds = dialog.getBoundingClientRect();
    const footer = dialog.querySelector('footer').getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, 'Preference dialog escapes the viewport');
    check(dialog.scrollWidth <= dialog.clientWidth + 2, 'Preference dialog overflows horizontally');
    check(footer.bottom <= innerHeight && footer.top >= bounds.top, 'Preference actions are inaccessible');
    return true;
};
window.closePreferences = async () => {
    byLabel(t('recommendation_preferences.cancel'), preferences()).click();
    await frames();
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
    const window = new BrowserWindow({ show: false, width: 1400, height: 1000, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    const captureDirectory = ${JSON.stringify(captureDirectory || null)};
    async function capture(name) {
        if (captureDirectory) await fs.writeFile(path.join(captureDirectory, name + '.png'), (await window.webContents.capturePage()).toPNG());
    }
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runDashboardInsightsTests()');
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("dark")');
    await capture('insights-overview-wide-dark');
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("dark", ".dashboard-journal")');
    await capture('insights-journal-wide-dark');
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("dark", ".reading-dashboard-reading-row")');
    await capture('insights-reading-wide-dark');
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("dark", ".reading-dashboard-library-row")');
    await capture('insights-shelves-wide-dark');
    await window.webContents.executeJavaScript('window.verifyPreferenceLayout()');
    await capture('insights-preferences-wide-dark');
    await window.webContents.executeJavaScript('window.closePreferences()');
    window.setContentSize(480, 650);
    await window.webContents.executeJavaScript('window.verifyPreferenceLayout()');
    await capture('insights-preferences-narrow-dark');
    await window.webContents.executeJavaScript('window.closePreferences()');
    window.setContentSize(640, 1000);
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("dark", ".dashboard-journal")');
    await capture('insights-journal-narrow-dark');
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("dark", ".reading-dashboard-library-row")');
    await capture('insights-shelves-narrow-dark');
    window.setContentSize(1400, 1000);
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("light", ".dashboard-journal")');
    await capture('insights-journal-wide-light');
    window.setContentSize(640, 1000);
    await window.webContents.executeJavaScript('window.verifyInsightsLayout("light", ".reading-dashboard-library-row")');
    await capture('insights-shelves-narrow-light');
    console.log('DASHBOARD_INSIGHTS_RESULT=' + JSON.stringify({ ...result, widths: [1400, 640], themes: ['dark', 'light'] }));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Dashboard insights renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/DASHBOARD_INSIGHTS_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), {
            calendarBooks: true, monthRace: true, goalRetryPersistence: true, passagesCopyAndRecovery: true,
            shelfPaginationAndRecovery: true, recommendationPreferences: true, widths: [1400, 640], themes: ['dark', 'light'],
        });
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
