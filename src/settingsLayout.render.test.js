import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('환경설정의 라이브러리 미리보기, 저장·취소, 키보드 탐색과 작은 화면 레이아웃을 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'settings-layout-render-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsModal } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/SettingsModal.jsx')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import { fontVarsForConfig } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/fontPolicy.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
const categories = ['basic', 'processing', 'folder', 'viewer', 'api', 'ttsApi', 'privacy'];
const libraryFixtures = [
    { path: '/fixture/Books', alias: '전자책 서재', group: 'NAS' },
    { path: '/fixture/Downloads', alias: '', group: '' },
    { path: '/fixture/Comics', alias: '만화 라이브러리', group: '로컬' },
    { path: '/fixture/Novels', alias: '소설 모음', group: 'NAS' },
    { path: '/fixture/Audio', alias: '오디오북', group: '' },
];
const baseline = {
    language: 'ko', font_family: 'Noto Sans KR', font_scale: 100,
    libraries: libraryFixtures.map(entry => entry.path),
    library_entries: libraryFixtures,
    viewer_paths: { comic: '/fixture/A long directory/Comic Viewer.app', epub: '', pdf: '', text: '' },
    api_keys: {},
};
const calls = { saves: [], closes: [], languages: [], effects: [] };
let nextSelectedFolder = null;
window.electronAPI = {
    listSounds: async () => ['Default.wav', 'Chime.wav'],
    listBundledFonts: async () => [
        { family: 'Noto Sans KR', filename: 'NotoSansKR-VariableFont_wght.ttf' },
        { family: 'Jua', filename: 'Jua-Regular.ttf' },
    ],
    listSystemFonts: async () => ['Arial', 'Segoe UI'],
    getSupertonicModelStatus: async () => ({ installed: false, modelDir: '', archiveSize: 0 }),
    onSupertonicModelProgress: () => () => {},
    onSupertonicModelStatus: () => () => {},
    getTelemetryStatus: async () => ({ errorReportingConfigured: true, usageAnalyticsConfigured: true }),
    getFileAssociationStatus: async () => ({
        platform: 'darwin', supported: true, directApply: true,
        associations: [
            { extension: 'cbz', group: 'comic', isDefault: true, handlerName: 'BookManager' },
            { extension: 'epub', group: 'document', isDefault: false, handlerName: 'Books' },
            { extension: 'txt', group: 'text', isDefault: false, handlerName: 'TextEdit' },
            { extension: 'mp3', group: 'audio', isDefault: false, handlerName: 'Music' },
        ],
    }),
    playSound: async value => { calls.effects.push(['sound', value]); },
    selectFile: async () => null, selectFolder: async () => nextSelectedFolder,
    getRoots: async () => { calls.effects.push(['roots']); return []; },
    getSpecialPaths: async () => { calls.effects.push(['special-paths']); return {}; },
    readDir: async () => { calls.effects.push(['read-directory']); return []; },
    getLibraryFolderChildren: async () => { calls.effects.push(['library-folders']); return { indexed: false }; },
    applyFileAssociations: async () => { throw new Error('Unexpected file association mutation'); },
    saveConfig: async () => { throw new Error('Unexpected direct configuration save'); },
    installSupertonicModel: async () => { throw new Error('Unexpected model installation'); },
    openExternal: async () => { throw new Error('Unexpected external navigation'); },
};
const root = createRoot(document.getElementById('root'));
let language = 'ko';
let properties = { isOpen: true, config: baseline, initialTab: 'basic', navigationRequest: 0 };
function render(patch = {}) {
    properties = { ...properties, ...patch };
    root.render(<SettingsModal {...properties}
        t={(key, values) => translate(key, language, values)}
        onSave={value => calls.saves.push(value)}
        onClose={value => {
            calls.closes.push(value);
            language = value?.language || properties.config.language;
            render({ isOpen: false });
        }}
        onLanguagePreviewChange={value => { calls.languages.push(value); language = value; render(); }}
    />);
}
const tab = id => document.getElementById('settings-tab-' + id);
const panel = () => document.querySelector('[role="tabpanel"]');
const isActive = id => panel()?.getAttribute('aria-labelledby') === 'settings-tab-' + id;
async function navigate(id) {
    check(tab(id), 'Missing category: ' + id);
    tab(id).click();
    await until(() => isActive(id), 'Category did not activate: ' + id);
    await frame();
}
async function change(element, value) {
    check(element, 'Missing field for value: ' + value);
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await frame();
}
function checkLabels(context) {
    for (const element of panel().querySelectorAll('input, select, textarea')) {
        if (!element.getClientRects().length || element.type === 'hidden') continue;
        const labelledBy = (element.getAttribute('aria-labelledby') || '').split(' ')
            .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
        const labels = [...(element.labels || [])].map(label => label.textContent).join(' ').trim();
        check(Boolean(element.getAttribute('aria-label')?.trim() || labelledBy || labels),
            context + ': field has no accessible name: ' + element.outerHTML);
    }
}
function checkTabSemantics(id) {
    const panels = document.querySelectorAll('[role="tabpanel"]');
    check(panels.length === 1 && panels[0].id === 'settings-panel', 'Expected one shared settings panel: ' + id);
    check(tab(id).getAttribute('aria-selected') === 'true', 'Selected tab semantics missing: ' + id);
    check(tab(id).getAttribute('aria-controls') === panels[0].id, 'Tab does not control its panel: ' + id);
    check(panels[0].getAttribute('aria-labelledby') === tab(id).id, 'Panel has no matching tab label: ' + id);
    check(document.querySelectorAll('[role="tab"][aria-selected="true"]').length === 1, 'Multiple selected categories');
    for (const category of categories) {
        check(document.getElementById(tab(category).getAttribute('aria-controls')) === panels[0], 'Category controls an absent panel: ' + category);
    }
}
async function open(patch = {}) {
    render({ isOpen: false });
    await until(() => !document.querySelector('.settings-modal-content'), 'Settings did not close before reopening');
    await frame();
    language = patch.config?.language || baseline.language;
    render({ isOpen: true, config: baseline, initialTab: 'basic', ...patch });
    await until(() => document.querySelector('.settings-modal-content') && panel(), 'Settings did not open');
    await frame();
}
async function runInteractions() {
    await until(() => panel(), 'Settings did not mount');
    check(document.querySelector('[role="tablist"]'), 'Category navigation needs tablist semantics');
    check(document.querySelectorAll('[role="tab"]').length === categories.length, 'Expected seven settings categories');
    for (const id of categories) {
        await navigate(id);
        checkTabSemantics(id);
        checkLabels(id);
    }
    await navigate('basic');
    for (const id of ['language', 'font', 'font-scale', 'sound']) {
        check(document.getElementById('settings-' + id), 'Missing general control: ' + id);
    }
    await change(document.getElementById('settings-language'), 'en');
    await change(document.getElementById('settings-font'), 'Jua');
    await change(document.getElementById('settings-font-scale'), '125');
    check(document.querySelector('.settings-font-preview')?.textContent.trim(), 'Font sample is missing');
    check(calls.languages.at(-1) === 'en', 'Language preview callback was not invoked');
    await navigate('processing');
    for (const id of ['target-format', 'max-threads', 'img-quality', 'renamer-compression']) {
        check(document.getElementById('settings-' + id), 'Missing processing control: ' + id);
    }
    await change(document.getElementById('settings-target-format'), 'cbz');
    await change(document.getElementById('settings-img-quality'), '85');
    await navigate('api');
    await change(document.getElementById('settings-secret-ai_gemini_key'), 'fixture-api-key');
    await navigate('basic');
    check(document.getElementById('settings-language').value === 'en', 'Category navigation discarded language');
    check(document.getElementById('settings-font').value === 'Jua', 'Category navigation discarded font');
    check(document.getElementById('settings-font-scale').value === '125', 'Category navigation discarded font scale');
    document.querySelector('.settings-footer .btn-primary').click();
    await until(() => !document.querySelector('.settings-modal-content'), 'Save did not close settings');
    check(calls.saves.length === 1 && calls.closes.length === 1, 'Save callbacks were not invoked once');
    const saved = calls.saves[0];
    check(saved === calls.closes[0], 'Close did not receive the saved configuration');
    check(saved.language === 'en' && saved.font_family === 'Jua' && saved.font_scale === 125, 'General settings were not saved');
    check(saved.target_format === 'cbz' && saved.img_quality === 85, 'Processing settings were not saved');
    check(saved.api_keys.ai_gemini_key === 'fixture-api-key', 'API setting was not saved across category navigation');
    await open();
    await change(document.getElementById('settings-language'), 'ja');
    document.querySelector('.settings-footer .btn-secondary').click();
    await until(() => !document.querySelector('.settings-modal-content'), 'Cancel did not close settings');
    check(calls.saves.length === 1 && calls.closes.at(-1) === undefined, 'Cancel saved a draft configuration');
    check(language === 'ko', 'Cancel did not allow the parent to restore the saved language');
    await open({ initialTab: 'ttsApi', navigationRequest: 1 });
    checkTabSemantics('ttsApi');
    await navigate('basic');
    await change(document.getElementById('settings-font-scale'), '130');
    render({ navigationRequest: 2 });
    await until(() => isActive('ttsApi'), 'Repeated external TTS navigation was ignored');
    await navigate('basic');
    check(document.getElementById('settings-font-scale').value === '130', 'External navigation discarded the draft');
    tab('basic').focus();
    for (const [key, id] of [
        ['ArrowDown', 'processing'], ['ArrowRight', 'folder'], ['ArrowUp', 'processing'],
        ['ArrowLeft', 'basic'], ['End', 'privacy'], ['ArrowRight', 'basic'],
        ['ArrowLeft', 'privacy'], ['Home', 'basic'],
    ]) {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await until(() => isActive(id), key + ' did not select ' + id);
        check(document.activeElement === tab(id), key + ' did not move focus with selection');
        checkTabSemantics(id);
    }
    await navigate('api');
    const manualOpener = document.querySelector('.settings-api-manual-row button');
    manualOpener.focus();
    manualOpener.click();
    await until(() => document.querySelector('.settings-manual-dialog')?.contains(document.activeElement), 'API manual did not receive focus');
    const manual = document.querySelector('.settings-manual-dialog');
    const manualButtons = [...manual.querySelectorAll('button')];
    check(document.activeElement === manualButtons[0], 'API manual did not focus its first action');
    for (const selector of ['.modal-header', '.settings-workspace', '.settings-footer']) {
        check(document.querySelector(selector).inert, 'API manual left background interactive: ' + selector);
    }
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    check(document.activeElement === manualButtons.at(-1), 'Shift+Tab escaped the API manual');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    check(document.activeElement === manualButtons[0], 'Tab escaped the API manual');
    const closesBeforeManual = calls.closes.length;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('.settings-manual-dialog'), 'Escape did not close the API manual');
    check(document.querySelector('.settings-modal-content') && calls.closes.length === closesBeforeManual, 'Escape also closed the parent settings');
    await until(() => document.activeElement === manualOpener, 'API manual did not restore focus to its opener');
    return { categories: categories.length, saved: calls.saves.length, cancelled: calls.closes.length - calls.saves.length, keyboardMoves: 8, manualFocusChecks: 4 };
}
const previewItems = () => [...document.querySelectorAll('.settings-library-preview-item')];
const previewItem = path => previewItems().find(item => item.dataset.libraryPath === path);
const libraryRow = path => [...document.querySelectorAll('.settings-library-list-item')]
    .find(item => item.dataset.libraryPath === path);
function checkPreview(expected, groups, context) {
    const actual = previewItems();
    check(JSON.stringify(actual.map(item => [item.dataset.libraryPath, item.textContent.trim()])) === JSON.stringify(expected),
        context + ': unexpected preview order or names: ' + JSON.stringify(actual.map(item => [item.dataset.libraryPath, item.textContent.trim()])));
    check(actual.every(item => item.tagName === 'BUTTON'), context + ': preview items must be keyboard-accessible buttons');
    const displayedGroups = [...document.querySelectorAll('.settings-library-preview-group')].map(group => group.dataset.group);
    check(JSON.stringify(displayedGroups) === JSON.stringify(groups), context + ': unexpected group order: ' + JSON.stringify(displayedGroups));
    check(!document.querySelector('.settings-library-preview .library-scan-status'), context + ': preview invented an index status');
}
async function selectPreview(path) {
    const item = previewItem(path);
    check(item, 'Missing preview item: ' + path);
    item.click();
    await frame();
    check(previewItem(path).getAttribute('aria-pressed') === 'true', 'Preview selection was not announced: ' + path);
    check(document.querySelectorAll('.settings-library-preview-item[aria-pressed="true"]').length === 1, 'Preview has multiple selected items');
    check(libraryRow(path)?.classList.contains('active'), 'Preview did not select the matching editor row: ' + path);
    check(document.querySelector('.settings-library-editor-path')?.textContent.includes(path), 'Preview did not open the matching editor: ' + path);
}
async function libraryAction(path, key) {
    const row = libraryRow(path);
    const button = [...(row?.querySelectorAll('button') || [])]
        .find(candidate => candidate.getAttribute('aria-label') === translate(key, language));
    check(button && !button.disabled, 'Missing or disabled library action: ' + key + ':' + path);
    button.click();
    await frame();
}
async function runLibraryPreviewInteractions() {
    const savesBefore = calls.saves.length;
    const effectsBefore = calls.effects.length;
    const baselineBefore = JSON.stringify(baseline);
    await open({ initialTab: 'folder' });
    checkPreview([
        ['/fixture/Books', '전자책 서재'], ['/fixture/Novels', '소설 모음'],
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'],
        ['/fixture/Comics', '만화 라이브러리'],
    ], ['NAS', '', '로컬'], 'initial preview');
    await selectPreview('/fixture/Novels');
    await change(document.getElementById('settings-library-alias'), '새 소설');
    check(previewItem('/fixture/Novels').textContent.trim() === '새 소설', 'Alias did not update the preview immediately');
    await change(document.getElementById('settings-library-alias'), '   ');
    check(previewItem('/fixture/Novels').textContent.trim() === 'Novels', 'Whitespace alias did not fall back to the folder name');
    await change(document.getElementById('settings-library-alias'), '새 소설');
    await change(document.getElementById('settings-library-group'), '로컬');
    checkPreview([
        ['/fixture/Books', '전자책 서재'], ['/fixture/Downloads', 'Downloads'],
        ['/fixture/Audio', '오디오북'], ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'],
    ], ['NAS', '', '로컬'], 'edited group');
    await libraryAction('/fixture/Novels', 'settings_library_move_up');
    await libraryAction('/fixture/Downloads', 'settings_library_move_up');
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'],
        ['/fixture/Books', '전자책 서재'], ['/fixture/Novels', '새 소설'], ['/fixture/Comics', '만화 라이브러리'],
    ], ['', 'NAS', '로컬'], 'reordered libraries');
    await libraryAction('/fixture/Books', 'btn_remove');
    nextSelectedFolder = '/fixture/NewLibrary';
    document.querySelector('.settings-library-toolbar button').click();
    await until(() => previewItem(nextSelectedFolder), 'Added library did not appear in preview');
    nextSelectedFolder = null;
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'], ['/fixture/NewLibrary', 'NewLibrary'],
        ['/fixture/Novels', '새 소설'], ['/fixture/Comics', '만화 라이브러리'],
    ], ['', '로컬'], 'removed and added libraries');
    check(calls.saves.length === savesBefore && calls.effects.length === effectsBefore, 'Library preview caused persistence or filesystem work before saving');
    check(JSON.stringify(baseline) === baselineBefore, 'Library edits mutated the saved configuration');
    document.querySelector('.settings-footer .btn-primary').click();
    await until(() => !document.querySelector('.settings-modal-content'), 'Library save did not close settings');
    const saved = calls.saves.at(-1);
    check(calls.saves.length === savesBefore + 1, 'Library draft was not saved exactly once');
    check(JSON.stringify(saved.libraries) === JSON.stringify(['/fixture/Downloads', '/fixture/Novels', '/fixture/Comics', '/fixture/Audio', '/fixture/NewLibrary']), 'Saved library order differs from the edited list');
    check(saved.library_entries.find(entry => entry.path === '/fixture/Novels')?.alias === '새 소설', 'Edited alias was not saved');
    check(saved.library_entries.find(entry => entry.path === '/fixture/Novels')?.group === '로컬', 'Edited group was not saved');
    await open({ initialTab: 'folder' });
    await selectPreview('/fixture/Books');
    await change(document.getElementById('settings-library-alias'), '취소할 이름');
    document.querySelector('.settings-footer .btn-secondary').click();
    await until(() => !document.querySelector('.settings-modal-content'), 'Library cancel did not close settings');
    check(calls.saves.length === savesBefore + 1 && calls.closes.at(-1) === undefined, 'Cancel persisted the library preview draft');
    await open({ initialTab: 'folder', config: { ...baseline, libraries: [], library_entries: [] } });
    checkPreview([], [], 'empty libraries');
    check(document.querySelector('.settings-library-preview')?.textContent.includes(translate('folder.sidebar.empty_libraries', language)), 'Empty library preview has no guidance');
    return { mutations: 8, draftIsolation: true, saved: true, cancelled: true, empty: true };
}
function checkLibraryPreviewLayout(context) {
    const workspace = document.querySelector('.settings-library-workspace');
    const editing = document.querySelector('.settings-library-editing');
    const preview = document.querySelector('.settings-library-preview');
    check(workspace && editing && preview, context + ': library preview regions missing');
    const area = workspace.getBoundingClientRect();
    const left = editing.getBoundingClientRect();
    const right = preview.getBoundingClientRect();
    for (const [name, bounds] of [['editing', left], ['preview', right]]) {
        check(bounds.width > 0 && bounds.height > 0, context + ': collapsed library ' + name);
        check(bounds.left >= area.left - 1 && bounds.right <= area.right + 1, context + ': library ' + name + ' escaped its workspace');
    }
    if (area.width > 580) {
        check(right.left >= left.right - 1 && Math.abs(right.top - left.top) <= 2, context + ': desktop preview is not beside the editor');
    } else {
        check(right.top >= left.bottom - 1 && Math.abs(right.left - left.left) <= 2, context + ': narrow preview is not below the editor');
    }
    for (const item of previewItems()) {
        const bounds = item.getBoundingClientRect();
        check(bounds.left >= right.left - 1 && bounds.right <= right.right + 1, context + ': long preview name escaped its panel');
    }
}
async function runLayout(scale, selectedLanguage = 'ko') {
    for (const [key, value] of Object.entries(fontVarsForConfig({ font_scale: scale }))) {
        document.getElementById('root').style.setProperty(key, value);
    }
    await open({ config: { ...baseline, font_scale: scale, language: selectedLanguage } });
    check(document.getElementById('settings-font-scale').value === String(scale), 'Reopened settings retained the previous font scale');
    await document.fonts.ready;
    const context = selectedLanguage + ':' + innerWidth + 'x' + innerHeight + '@' + scale;
    const measurements = [];
    for (const id of categories) {
        await navigate(id);
        checkLabels(context + ':' + id);
        const dialog = document.querySelector('.settings-modal-content');
        const body = document.querySelector('.settings-modal-body');
        const workspace = document.querySelector('.settings-workspace');
        const footer = document.querySelector('.settings-footer');
        const save = footer.querySelector('.btn-primary');
        check(workspace && body && footer, context + ': layout regions missing');
        for (const [name, element] of [['dialog', dialog], ['workspace', workspace], ['body', body], ['footer', footer], ['save', save]]) {
            const bounds = element.getBoundingClientRect();
            check(bounds.width > 0 && bounds.height > 0, context + ':' + id + ': collapsed ' + name);
            check(bounds.left >= -1 && bounds.right <= innerWidth + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1,
                context + ':' + id + ': ' + name + ' escaped viewport: ' + JSON.stringify(bounds.toJSON()));
        }
        check(body.scrollWidth <= body.clientWidth + 1, context + ':' + id + ': horizontal content overflow');
        if (id === 'folder') checkLibraryPreviewLayout(context);
        check(document.documentElement.scrollWidth <= innerWidth + 1, context + ':' + id + ': page overflow');
        check(['auto', 'scroll'].includes(getComputedStyle(body).overflowY), context + ': body is not the scroll region');
        const before = save.getBoundingClientRect();
        body.scrollTop = body.scrollHeight;
        await frame();
        const after = save.getBoundingClientRect();
        check(Math.abs(before.top - after.top) <= 1, context + ':' + id + ': save button scrolled away');
        const target = document.elementFromPoint(after.left + after.width / 2, after.top + after.height / 2);
        check(target === save || save.contains(target), context + ':' + id + ': save button is covered');
        measurements.push({ category: id, contentHeight: body.clientHeight, scrollHeight: body.scrollHeight });
        body.scrollTop = 0;
    }
    const longEntry = {
        path: '/fixture/' + 'LongLibraryPath'.repeat(16),
        alias: '긴 라이브러리 이름 '.repeat(24),
        group: '긴 그룹 이름 '.repeat(24),
    };
    await open({ initialTab: 'folder', config: {
        ...baseline, font_scale: scale, language: selectedLanguage,
        libraries: [longEntry.path], library_entries: [longEntry],
    } });
    await selectPreview(longEntry.path);
    checkLibraryPreviewLayout(context + ':long labels');
    const longBody = document.querySelector('.settings-modal-body');
    const longPreview = document.querySelector('.settings-library-preview');
    check(longBody.scrollWidth <= longBody.clientWidth + 1, context + ': long labels overflow the settings body');
    check(longPreview.scrollWidth <= longPreview.clientWidth + 1, context + ': long labels overflow the preview');
    await open({ config: { ...baseline, font_scale: scale, language: selectedLanguage } });
    return { viewport: [innerWidth, innerHeight], scale, language: selectedLanguage, measurements };
}
render();
window.settingsLayoutTests = { runInteractions, runLibraryPreviewInteractions, runLayout, navigate, selectPreview };
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<html><head></head><body style="margin:0"><div id="root" style="width:100%;height:100vh"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.httpServer.address().port}/`)});
    console.log('SETTINGS_RENDER_STAGE=interactions');
    const interactions = await window.webContents.executeJavaScript('window.settingsLayoutTests.runInteractions()');
    const libraryPreview = await window.webContents.executeJavaScript('window.settingsLayoutTests.runLibraryPreviewInteractions()');
    console.log('SETTINGS_RENDER_STAGE=layouts');
    const layouts = [];
    for (const [width, height] of [[1280, 900], [708, 902], [520, 650]]) {
        window.setContentSize(width, height);
        for (const scale of [100, 155]) {
            layouts.push(await window.webContents.executeJavaScript('window.settingsLayoutTests.runLayout(' + scale + ')'));
            if (${Boolean(process.env.BOOKMANAGER_SETTINGS_SCREENSHOTS)}) {
                await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '.png', (await window.webContents.capturePage()).toPNG());
                if (width === 1280 && scale === 100) {
                    for (const category of ['processing', 'viewer', 'api', 'folder']) {
                        console.log('SETTINGS_RENDER_CAPTURE=' + width + ':' + category);
                        await window.webContents.executeJavaScript('window.settingsLayoutTests.navigate(' + JSON.stringify(category) + ')');
                        if (category === 'folder') {
                            await window.webContents.executeJavaScript('window.settingsLayoutTests.selectPreview("/fixture/Books")');
                            await window.webContents.executeJavaScript('document.querySelector(".settings-library-editor").scrollIntoView({ block: "nearest" })');
                        }
                        await new Promise(resolve => setTimeout(resolve, 75));
                        await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-' + category + '.png', (await window.webContents.capturePage()).toPNG());
                    }
                } else if (width === 708 && scale === 100) {
                    await window.webContents.executeJavaScript('window.settingsLayoutTests.navigate("folder")');
                    await window.webContents.executeJavaScript('window.settingsLayoutTests.selectPreview("/fixture/Books")');
                    await window.webContents.executeJavaScript('document.querySelector(".settings-library-editor").scrollIntoView({ block: "nearest" })');
                    await new Promise(resolve => setTimeout(resolve, 75));
                    await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-folder.png', (await window.webContents.capturePage()).toPNG());
                }
            }
        }
    }
    for (const language of ['en', 'ja']) {
        for (const [width, height] of [[1280, 900], [520, 650]]) {
            window.setContentSize(width, height);
            layouts.push(await window.webContents.executeJavaScript('window.settingsLayoutTests.runLayout(155, ' + JSON.stringify(language) + ')'));
            if (${Boolean(process.env.BOOKMANAGER_SETTINGS_SCREENSHOTS)}) {
                await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-155-' + language + '.png', (await window.webContents.capturePage()).toPNG());
            }
        }
    }
    console.log('SETTINGS_LAYOUT_RESULT=' + JSON.stringify({ interactions, libraryPreview, layouts }));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Settings renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/SETTINGS_LAYOUT_RESULT=(.+)/)[1]);
        assert.equal(report.interactions.categories, 7);
        assert.equal(report.interactions.manualFocusChecks, 4);
        assert.deepEqual(report.libraryPreview, { mutations: 8, draftIsolation: true, saved: true, cancelled: true, empty: true });
        assert.equal(report.layouts.length, 10);
        assert.ok(report.layouts.every(layout => layout.measurements.length === 7));
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
