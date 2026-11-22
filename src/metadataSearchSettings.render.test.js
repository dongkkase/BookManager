import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('metadata search settings filter results, persist tag toggles, and isolate modal input', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-settings-render-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MetadataSearchDialog } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/MetadataTab.jsx')}`)};
import { TooltipLayer } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/TooltipLayer.jsx')}`)};
import { normalizeMetadataSearchSettings } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/metadataSearchSettings.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) { if (predicate()) return; await frame(); }
    throw new Error(message);
}
const title = '추방당한 전생 중기사는 게임 지식으로 무쌍한다';
const results = [
    { id: 1, title, metadata: { Title: title, Tags: '로맨스, 광고', Genre: '판타지' }, ridiDetailResolved: true },
    { id: 2, title: '[특별 세트]' + title + '(총 14권)', metadata: { Tags: '로맨스, 광고' }, ridiDetailResolved: true },
    { id: 3, title: '전생에 마술사단장이던 나, 당신을 사랑할 일 없다고 말한 남편이', metadata: { Tags: '연재, 로맨스' }, ridiDetailResolved: true },
];
let settings = normalizeMetadataSearchSettings();
let type = 'comic';
let language = 'ko';
let failSave = false;
let saves = 0;
let searches = 0;
let clears = 0;
let selections = 0;
let closes = 0;
let state = { results, requestId: 1, apiSource: '리디북스', query: title, page: 1, hasNext: true };
const apiSources = [{ value: '리디북스', labelKey: 'api_ridi' }];
window.electronAPI = { clearApiCache: async () => { clears++; return { success: true }; } };
document.documentElement.dataset.motion = 'reduced';
const root = createRoot(document.getElementById('root'));
function render() {
    root.render(<><MetadataSearchDialog state={state} apiSources={apiSources} searchSettings={settings}
        searchSettingType={type} minWidth={720} minHeight={560} t={(key, values) => translate(key, language, values)}
        onClose={() => { closes++; }} onSelect={() => { selections++; }}
        onSearch={() => { searches++; state = { ...state, requestId: state.requestId + 1 }; render(); }}
        onSaveSearchSettings={async next => {
            if (failSave) { failSave = false; throw new Error('disk full'); }
            saves++; settings = normalizeMetadataSearchSettings(next); render();
        }} /><TooltipLayer /></>);
}
const modal = () => document.querySelector('dialog[open]');
const list = () => [...document.querySelectorAll('.meta-api-result')];
const chip = text => [...document.querySelectorAll('.meta-api-preview-tags button')].find(node => node.textContent === text);
const input = field => modal().querySelector('[data-search-setting="' + field + '"] input');
async function openSettings() {
    document.querySelector('.meta-api-settings-btn').click();
    await until(modal, 'Settings did not open');
    const bounds = modal().getBoundingClientRect();
    check(Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) < 2, 'Settings dialog is not centered');
}
async function enter(field, text) {
    const node = input(field);
    node.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    await frame();
}
async function chooseType(next) {
    const node = modal().querySelector('select');
    node.value = next;
    node.dispatchEvent(new Event('change', { bubbles: true }));
    await frame();
}
async function apply() {
    modal().querySelector('footer .primary').click();
    await frame();
}
window.metadataSettingsTests = (async () => {
    render();
    await until(() => list().length === 3, 'Initial results missing');
    await openSettings();
    check(modal().contains(document.activeElement), 'Focus escaped the native settings dialog');
    await enter('excludedTitleTerms', '취소할 문구');
    modal().querySelector('footer button').click();
    await until(() => !modal(), 'Cancel did not close settings');
    check(saves === 0 && list().length === 3, 'Cancel persisted the draft');
    await openSettings();
    await enter('excludedTitleTerms', '특별 세트');
    await enter('excludedResultTags', '연재');
    await enter('excludedTags', '광고');
    input('excludedTags').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }));
    input('excludedTags').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    check(selections === 0 && searches === 0, 'Parent shortcuts handled settings input');
    await chooseType('epub');
    check(!modal().querySelector('.meta-tag-chip'), 'EPUB inherited comic settings');
    await enter('excludedTags', 'EPUB 전용');
    await chooseType('comic');
    check(modal().textContent.includes('특별 세트'), 'Type switching lost draft values');
    failSave = true;
    await apply();
    check(modal() && modal().querySelector('[role="alert"]').textContent.includes('disk full'), 'Save failure did not retain the draft with an error');
    check(saves === 0 && list().length === 3, 'Failed save changed active filters');
    await apply();
    await until(() => !modal() && list().length === 1, 'Saved filters did not update the current results');
    check(settings.epub.excludedTags[0] === 'EPUB 전용', 'Saving lost another type');
    check(settings.txt.excludedTags.length === 0, 'TXT inherited EPUB tags');
    check(document.querySelector('.meta-api-page-status small').textContent.includes('1'), 'Visible result count is wrong');
    check(chip('광고').classList.contains('excluded') && Number(getComputedStyle(chip('광고')).opacity) < 0.5, 'Excluded tag was not dimmed');
    chip('광고').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    await until(() => document.querySelector('[role="tooltip"]'), 'Tag tooltip missing');
    check(document.querySelector('[role="tooltip"]').textContent.includes('포함'), 'Excluded tag tooltip did not offer inclusion');
    chip('광고').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    chip('광고').click();
    await until(() => !chip('광고').classList.contains('excluded'), 'Click failed to include the tag');
    check(chip('광고').getAttribute('data-tooltip').includes('제외'), 'Included tag tooltip did not offer exclusion');
    failSave = true;
    chip('광고').click();
    await until(() => document.querySelector('.meta-api-header-error[role="alert"]'), 'Tag save error missing');
    check(!chip('광고').classList.contains('excluded'), 'Failed tag save changed inclusion');
    chip('광고').click();
    await until(() => chip('광고').classList.contains('excluded'), 'Click failed to exclude the tag');
    await openSettings();
    const stored = JSON.stringify(settings);
    modal().querySelector('.meta-search-settings-cache button').click();
    await until(() => clears === 1 && searches === 1, 'Cache clear did not repeat the search');
    check(JSON.stringify(settings) === stored && list().length === 1, 'Cache clear changed settings or bypassed filters');
    modal().querySelector('[data-search-setting="excludedTitleTerms"] .meta-tag-chip button').click();
    await frame();
    await apply();
    await until(() => !modal() && list().length === 2, 'Removing a rule did not restore cached results');
    list()[1].click();
    await frame();
    chip('광고').click();
    await until(() => !chip('광고').classList.contains('excluded'), 'Second result tag toggle failed');
    check(list()[1].classList.contains('active'), 'A tag-only setting change reset the selected result');
    type = 'txt'; render();
    await until(() => list().length === 3, 'TXT used comic result filters');
    type = 'comic'; render();
    await until(() => list().length === 2, 'Comic settings did not restore');
    await openSettings();
    await enter('excludedTitleTerms', '전생');
    await apply();
    await until(() => !modal() && list().length === 0, 'All matching results were not excluded');
    check(!document.querySelector('.meta-api-page-controls button:last-child').disabled, 'Filtering an entire page blocked the next page');
    check(document.querySelector('.meta-api-action-controls .primary').disabled, 'Empty results can still be applied');
    check(closes === 0, 'Nested dialog closed its parent');
    type = 'txt'; render();
    await until(() => list().length === 3, 'Type restore failed');
    for (const value of ['en', 'ja', 'ko']) {
        language = value; render(); await frame();
        await openSettings();
        check(!modal().textContent.includes('metadata_search_settings.') && !modal().textContent.includes('btn_apply'), 'Missing settings translations');
        check(modal().scrollWidth <= modal().clientWidth + 1, 'Settings overflow horizontally');
        modal().querySelector('footer button').click();
        await until(() => !modal(), 'Translated settings failed to close');
    }
    await openSettings();
    return { saves, searches, clears, typeIsolation: true, failureRecovery: true, tooltips: true };
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { backgroundThrottling: false } });
    await window.loadURL('http://127.0.0.1:${server.httpServer.address().port}/');
    const report = await window.webContents.executeJavaScript('window.metadataSettingsTests');
    if (process.env.BOOKMANAGER_METADATA_SCREENSHOT) require('node:fs').writeFileSync(process.env.BOOKMANAGER_METADATA_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    window.setContentSize(760, 600);
    const smallLayout = await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => { const dialog = document.querySelector("dialog[open]"); const bounds = dialog.getBoundingClientRect(); resolve(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth + 1); }))');
    if (!smallLayout) throw new Error('Settings dialog overflowed a small window');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    const closed = await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => resolve(!document.querySelector("dialog[open]") && !!document.querySelector(".meta-api-dialog"))))');
    if (!closed) throw new Error('Escape did not close only the nested settings dialog');
    console.log('METADATA_SETTINGS_RESULT=' + JSON.stringify(report));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const require = createRequire(import.meta.url);
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Metadata settings renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/METADATA_SETTINGS_RESULT=(.+)/)[1]);
        assert.ok(report.saves >= 5);
        assert.equal(report.clears, 1);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
