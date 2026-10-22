import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('환경설정의 적용·취소, 라이브러리 편집, 키보드 탐색과 작은 화면 레이아웃을 유지한다', async t => {
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
import { applyMotionPreference, initializeMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
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
const categories = ['basic', 'processing', 'folder', 'viewer', 'api', 'ttsApi', 'privacy', 'licenses'];
const apiSections = ['preferred', 'providers', 'ai', 'tags', 'cache'];
const providerSources = [
    '리디북스', '문피아', '한국웹툰', 'YES24', '알라딘', 'Google Books', 'Anilist', 'Vine',
    'Goodreads', 'Hardcover', 'Open Library', 'iTunes', 'Kobo', 'LubimyCzytac', 'RanobeDB',
    'Amazon', 'Audible', 'AudNexus', 'Libro.fm',
];
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
const calls = { saves: [], saveAttempts: [], viewerPersists: [], associations: [], closes: [], languages: [], effects: [] };
const dataFolderCalls = [];
const dataFolderPath = '/Users/테스트 사용자/Library/Application Support/BookManager/BookManagerData';
let dataFolderLoadFails = false;
let nextDataFolderOpen = null;
let nextSelectedFolder = null;
let nextSave = null;
let nextViewerSave = null;
window.electronAPI = {
    getAppDataPath: async () => {
        if (dataFolderLoadFails) throw new Error('Unavailable');
        return dataFolderPath;
    },
    openAppDataFolder: async () => {
        dataFolderCalls.push(dataFolderPath);
        return nextDataFolderOpen ? nextDataFolderOpen() : { success: true };
    },
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
    applyFileAssociations: async extensions => { calls.associations.push(extensions); return { success: true }; },
    saveConfig: async () => { throw new Error('Unexpected direct configuration save'); },
    installSupertonicModel: async () => { throw new Error('Unexpected model installation'); },
    openExternal: async () => { throw new Error('Unexpected external navigation'); },
};
const root = createRoot(document.getElementById('root'));
initializeMotionPreference();
let language = 'ko';
let properties = { isOpen: true, config: baseline, initialTab: 'basic', navigationRequest: 0 };
function render(patch = {}) {
    properties = { ...properties, ...patch };
    applyMotionPreference(properties.config.motion_preference);
    root.render(<SettingsModal {...properties}
        t={(key, values) => translate(key, language, values)}
        onSave={async value => {
            calls.saveAttempts.push(value);
            const pending = nextSave;
            nextSave = null;
            if (pending) await pending;
            const saved = { ...properties.config, ...value };
            calls.saves.push(saved);
            language = saved.language;
            render({ config: saved });
            return saved;
        }}
        onPersistViewerPaths={async value => {
            calls.viewerPersists.push(value);
            const pending = nextViewerSave;
            nextViewerSave = null;
            if (pending) await pending;
            const saved = { ...properties.config, ...value };
            render({ config: saved });
            return saved;
        }}
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
const applyButton = () => document.querySelector('.settings-footer .btn-primary');
const isActive = id => panel()?.getAttribute('aria-labelledby') === 'settings-tab-' + id;
const apiSection = id => document.getElementById('settings-api-section-' + id);
const isApiSectionActive = id => apiSection(id)?.getAttribute('aria-current') === 'page';
async function navigate(id) {
    check(tab(id), 'Missing category: ' + id);
    tab(id).click();
    await until(() => isActive(id), 'Category did not activate: ' + id);
    await frame();
}
function checkApiSection(id) {
    const submenu = document.querySelector('.settings-api-submenu');
    check(submenu && (submenu.tagName === 'NAV' || submenu.getAttribute('role') === 'navigation'), 'API sections need navigation semantics');
    check(tab('api').getAttribute('aria-expanded') === 'true', 'API category did not announce its expanded submenu');
    check(submenu.querySelectorAll('button').length === apiSections.length, 'Expected five API sections');
    check(submenu.querySelectorAll('[aria-current="page"]').length === 1 && isApiSectionActive(id), 'API section selection is ambiguous: ' + id);
    for (const section of apiSections) {
        check(apiSection(section)?.tagName === 'BUTTON' && apiSection(section).tabIndex === (section === id ? 0 : -1), 'API section keyboard entry does not follow selection: ' + section);
    }
    check(panel().querySelector('h2').textContent.trim() === apiSection(id).textContent.trim(), 'Page heading does not match its API section: ' + id);
    const sectionControls = {
        preferred: '#settings-preferred-comic',
        providers: '#settings-secret-hardcover',
        ai: '#settings-ai-provider',
        tags: '[aria-describedby="settings-tag-rules-help"]',
        cache: '.settings-danger-btn',
    };
    for (const [section, selector] of Object.entries(sectionControls)) {
        check(Boolean(panel().querySelector(selector)) === (section === id), 'Unexpected API content for ' + id + ': ' + section);
    }
    checkTabSemantics('api');
    checkLabels('API section: ' + id);
}
async function navigateApiSection(id) {
    check(apiSection(id), 'Missing API section: ' + id);
    apiSection(id).click();
    await until(() => isApiSectionActive(id), 'API section did not activate: ' + id);
    await frame();
    checkApiSection(id);
}
async function change(element, value) {
    check(element, 'Missing field for value: ' + value);
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await frame();
}
const providerCards = () => [...panel().querySelectorAll('.settings-provider-card')];
const providerCard = source => providerCards().find(card => card.dataset.provider === source);
const providerSwitch = source => providerCard(source)?.querySelector('[role="switch"]');
async function changeProviderSetting(id, value) {
    const control = document.getElementById(id);
    check(control, 'Missing provider setting: ' + id);
    check(control.getClientRects().length > 0 && !control.closest('details'), 'Provider setting is not always visible: ' + id);
    await change(control, value);
}
function checkProviderCards(context, enabled = {}) {
    const cards = providerCards();
    check(cards.length === 19, context + ': expected all 19 source cards');
    for (const source of providerSources) {
        const card = providerCard(source);
        const toggle = providerSwitch(source);
        check(card && toggle, context + ': source or toggle missing: ' + source);
        check(toggle.tagName === 'BUTTON' && toggle.type === 'button', context + ': source toggle needs native button semantics: ' + source);
        check(Boolean(toggle.getAttribute('aria-label')?.trim()), context + ': source toggle has no accessible name: ' + source);
        check(!toggle.disabled, context + ': source toggle unexpectedly disabled: ' + source);
        check(toggle.getAttribute('aria-checked') === String(enabled[source] !== false), context + ': incorrect source state: ' + source);
        check(card.classList.contains('is-disabled') === (enabled[source] === false), context + ': incorrect disabled card styling: ' + source);
        if (enabled[source] === false) check(Number(getComputedStyle(card).opacity) < 1, context + ': disabled source is not dimmed: ' + source);
        check(!card.querySelector('details, summary'), context + ': source settings are still collapsible: ' + source);
        check(!card.textContent.includes(translate('metadata_provider_no_key', language)), context + ': redundant keyless description remains: ' + source);
        check(!card.querySelector('.settings-provider-status.is-enabled, .settings-provider-status.is-disabled'), context + ': redundant enabled or disabled status remains: ' + source);
    }
}
async function setProviderEnabled(source, enabled) {
    const toggle = providerSwitch(source);
    check(toggle, 'Missing source toggle: ' + source);
    if (toggle.getAttribute('aria-checked') !== String(enabled)) toggle.click();
    await until(() => providerSwitch(source)?.getAttribute('aria-checked') === String(enabled), 'Source state did not change: ' + source);
    await frame();
}
function checkLabels(context) {
    for (const element of document.querySelector('.settings-content').querySelectorAll('input, select, textarea')) {
        if (!element.getClientRects().length || element.type === 'hidden') continue;
        const labelledBy = (element.getAttribute('aria-labelledby') || '').split(' ')
            .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
        const labels = [...(element.labels || [])].map(label => label.textContent).join(' ').trim();
        check(Boolean(element.getAttribute('aria-label')?.trim() || labelledBy || labels),
            context + ': field has no accessible name: ' + element.outerHTML);
    }
}
function checkInlineFields(context) {
    for (const control of document.querySelector('.settings-content').querySelectorAll('input, select')) {
        if (['checkbox', 'radio', 'hidden'].includes(control.type) || !control.getClientRects().length) continue;
        const field = control.closest('.settings-control-field');
        check(field, context + ': input or select has no shared field border: ' + control.id);
        const associatedLabel = [...(control.labels || [])].find(label => label === field || field.contains(label));
        const inlineLabel = associatedLabel === field ? field.querySelector(':scope > .settings-field-label') : associatedLabel;
        check(inlineLabel?.textContent.trim(), context + ': input or select has no internal label: ' + control.id);
        const fieldBounds = field.getBoundingClientRect();
        const labelBounds = inlineLabel.getBoundingClientRect();
        const controlBounds = control.getBoundingClientRect();
        const fieldStyle = getComputedStyle(field);
        const controlStyle = getComputedStyle(control);
        check(parseFloat(fieldStyle.borderTopWidth) >= 1 && parseFloat(fieldStyle.borderLeftWidth) >= 1, context + ': shared field border is missing: ' + control.id);
        check(field.scrollWidth <= field.clientWidth + 1, context + ': shared field overflows horizontally: ' + control.id);
        for (const [name, bounds] of [['label', labelBounds], ['control', controlBounds]]) {
            check(bounds.width > 0 && bounds.height > 0, context + ': collapsed internal ' + name + ': ' + control.id);
            check(bounds.left >= fieldBounds.left - 1 && bounds.right <= fieldBounds.right + 1 && bounds.top >= fieldBounds.top - 1 && bounds.bottom <= fieldBounds.bottom + 1, context + ': internal ' + name + ' escaped the field: ' + control.id);
        }
        const textLeft = controlBounds.left + parseFloat(controlStyle.paddingLeft);
        const textRight = controlBounds.right - parseFloat(controlStyle.paddingRight);
        check(labelBounds.right <= textLeft + 1, context + ': internal label overlaps the input text: ' + control.id);
        check(textRight - textLeft >= 12, context + ': input text area collapsed: ' + control.id);
        check(Math.abs((labelBounds.top + labelBounds.bottom) / 2 - (controlBounds.top + controlBounds.bottom) / 2) <= 2, context + ': internal label moved above or below its control: ' + control.id);
        check(parseFloat(controlStyle.borderTopWidth) === 0 && parseFloat(controlStyle.borderLeftWidth) === 0, context + ': input retains a second border inside its shared field: ' + control.id);
        if (control.id.startsWith('settings-secret-')) {
            const reveal = field.querySelector('button[aria-controls="' + control.id + '"]');
            check(reveal?.type === 'button', context + ': secret has no reveal button inside its field: ' + control.id);
            const revealBounds = reveal.getBoundingClientRect();
            check(revealBounds.left >= textRight - 1 && revealBounds.right <= fieldBounds.right + 1 && fieldBounds.right - revealBounds.right <= 12, context + ': secret reveal button is not inside the right edge: ' + control.id);
            check(revealBounds.top >= fieldBounds.top - 1 && revealBounds.bottom <= fieldBounds.bottom + 1, context + ': secret reveal button escaped the field height: ' + control.id);
        }
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
async function applySettings(context) {
    const savesBefore = calls.saves.length;
    const closesBefore = calls.closes.length;
    check(applyButton()?.textContent.trim() === translate('settings.apply', language), context + ': footer action is not labelled Apply');
    check(!applyButton().disabled, context + ': changed settings cannot be applied');
    applyButton().click();
    await until(() => calls.saves.length === savesBefore + 1 && applyButton()?.disabled, context + ': apply did not finish with a clean draft');
    check(document.querySelector('.settings-modal-content') && calls.closes.length === closesBefore, context + ': applying settings closed the dialog');
    return calls.saves.at(-1);
}
async function runDataFolderInteractions() {
    await open();
    const field = () => document.getElementById('settings-data-folder-path');
    const button = () => document.querySelector('.settings-data-folder button');
    const feedback = () => document.querySelector('.settings-data-folder [role="alert"]');
    await until(() => field()?.textContent === dataFolderPath, 'The actual data folder path was not displayed');
    check(!document.querySelector('.settings-data-folder input, .settings-data-folder textarea'), 'Data folder path must be plain text');
    check(getComputedStyle(field()).userSelect === 'text', 'Data folder path must allow text selection');
    const range = document.createRange();
    range.selectNodeContents(field());
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    check(window.getSelection().toString() === dataFolderPath, 'The full data folder path cannot be selected for copying');
    window.getSelection().removeAllRanges();
    check(button().getAttribute('aria-label') === translate('action_open_folder', language) && !button().textContent.trim(), 'Folder opening needs an accessible icon-only button');
    check(button().getBoundingClientRect().left >= field().getBoundingClientRect().right, 'Folder opening button must be on the right of the path');
    let finishOpen;
    nextDataFolderOpen = () => new Promise(resolve => { finishOpen = resolve; });
    button().click();
    button().click();
    await until(() => button().disabled && finishOpen, 'Folder opening did not enter its pending state');
    check(dataFolderCalls.length === 1, 'Folder opening was dispatched more than once');
    finishOpen({ success: false, message: 'Permission denied' });
    await until(() => feedback()?.textContent.includes('Permission denied') && !button().disabled, 'Folder opening failure was not displayed');
    nextDataFolderOpen = async () => { throw new Error('IPC unavailable'); };
    button().click();
    await until(() => feedback()?.textContent.includes('IPC unavailable') && !button().disabled, 'Folder IPC rejection was not displayed');
    nextDataFolderOpen = null;
    button().click();
    await until(() => !feedback() && !button().disabled && dataFolderCalls.length === 3, 'Folder opening did not recover on retry');
    check(dataFolderCalls.every(value => value === dataFolderPath), 'A different folder was opened');
    check(applyButton().disabled && calls.saveAttempts.length === 0, 'Opening the data folder changed settings');
    dataFolderLoadFails = true;
    await open();
    await until(() => feedback(), 'Path lookup failure was not displayed');
    check(button().disabled && !field().textContent, 'An unavailable data folder can still be opened');
    dataFolderLoadFails = false;
    await open();
    await until(() => field()?.textContent === dataFolderPath && !button().disabled, 'Path lookup did not recover after reopening settings');
    return { pathVisible: true, selectable: true, opened: true, failures: true, retry: true, settingsUnchanged: true };
}
async function runInteractions() {
    await until(() => panel(), 'Settings did not mount');
    check(document.querySelector('[role="tablist"]'), 'Category navigation needs tablist semantics');
    check(document.querySelectorAll('[role="tab"]').length === categories.length, 'Expected eight settings categories');
    for (const id of categories) {
        await navigate(id);
        checkTabSemantics(id);
        checkLabels(id);
        check(applyButton().disabled, 'Category navigation made unchanged settings dirty');
    }
    await navigate('basic');
    for (const id of ['language', 'font', 'font-scale', 'motion-preference', 'sound']) {
        check(document.getElementById('settings-' + id), 'Missing general control: ' + id);
    }
    await change(document.getElementById('settings-language'), 'en');
    await change(document.getElementById('settings-font'), 'Jua');
    await change(document.getElementById('settings-font-scale'), '125');
    check(document.getElementById('settings-motion-preference').value === 'system', 'Motion must default to system preference');
    await change(document.getElementById('settings-motion-preference'), 'full');
    check(document.querySelector('.settings-font-preview')?.textContent.trim(), 'Font sample is missing');
    check(calls.languages.at(-1) === 'en', 'Language preview callback was not invoked');
    await navigate('processing');
    for (const id of ['target-format', 'max-threads', 'img-quality', 'renamer-compression']) {
        check(document.getElementById('settings-' + id), 'Missing processing control: ' + id);
    }
    await change(document.getElementById('settings-target-format'), 'cbz');
    await change(document.getElementById('settings-img-quality'), '85');
    await navigate('api');
    checkApiSection('preferred');
    apiSection('preferred').focus();
    for (const [key, section] of [
        ['ArrowDown', 'providers'], ['ArrowRight', 'ai'], ['ArrowUp', 'providers'],
        ['ArrowLeft', 'preferred'], ['End', 'cache'], ['ArrowRight', 'preferred'],
        ['ArrowLeft', 'cache'], ['Home', 'preferred'],
    ]) {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await until(() => isApiSectionActive(section), key + ' did not select API section ' + section);
        check(document.activeElement === apiSection(section), key + ' did not focus API section ' + section);
        checkApiSection(section);
    }
    await change(document.getElementById('settings-preferred-audio'), 'Audible');
    check(![...document.getElementById('settings-preferred-book').options].some(option => option.value === 'Audible'), 'Audiobook-only source leaked into books');
    await navigateApiSection('ai');
    await change(document.getElementById('settings-secret-ai_gemini_key'), 'fixture-api-key');
    await navigateApiSection('providers');
    await changeProviderSetting('settings-secret-hardcover', ' Bearer hc_fixture ');
    await changeProviderSetting('settings-itunes-country', 'JP');
    await changeProviderSetting('settings-itunes-cover', 'standard');
    await changeProviderSetting('settings-kobo-country', 'ca');
    await changeProviderSetting('settings-kobo-language', 'fr');
    await changeProviderSetting('settings-audible-region', 'uk');
    panel().scrollTop = panel().scrollHeight;
    await frame();
    check(panel().scrollTop > 0, 'Provider settings did not exercise content scrolling');
    await navigateApiSection('tags');
    check(panel().scrollTop === 0, 'API section navigation retained the previous scroll position');
    await change(panel().querySelector('textarea'), 'Action -> 액션');
    await navigateApiSection('cache');
    await navigate('api');
    checkApiSection('preferred');
    check(document.getElementById('settings-preferred-audio').value === 'Audible', 'Parent API navigation discarded its draft');
    await navigateApiSection('providers');
    check(panel().scrollTop === 0, 'Reopening provider settings retained a stale scroll position');
    check(document.getElementById('settings-secret-hardcover').value === ' Bearer hc_fixture ', 'API section navigation discarded the token draft');
    await navigate('basic');
    check(tab('api').getAttribute('aria-expanded') === 'false' && !document.querySelector('.settings-api-submenu'), 'Leaving API settings did not collapse its submenu');
    check(document.getElementById('settings-language').value === 'en', 'Category navigation discarded language');
    check(document.getElementById('settings-font').value === 'Jua', 'Category navigation discarded font');
    check(document.getElementById('settings-font-scale').value === '125', 'Category navigation discarded font scale');
    const saved = await applySettings('settings across categories');
    check(calls.saves.length === 1 && calls.closes.length === 0, 'Apply invoked an unexpected save or close callback');
    check(saved.language === 'en' && saved.font_family === 'Jua' && saved.font_scale === 125, 'General settings were not saved');
    check(saved.motion_preference === 'full', 'Animation preference was not saved');
    check(saved.target_format === 'cbz' && saved.img_quality === 85, 'Processing settings were not saved');
    check(saved.api_keys.ai_gemini_key === 'fixture-api-key', 'API setting was not saved across category navigation');
    check(saved.api_keys.hardcover === 'hc_fixture', 'Hardcover token was not normalized');
    check(saved.api_keys.tag_rules === 'Action -> 액션', 'Tag rules were not saved across API section navigation');
    check(saved.preferred_meta_api_audio === 'Audible', 'Audiobook preference was not saved');
    check(JSON.stringify(saved.metadata_providers) === JSON.stringify({ itunes_country: 'JP', itunes_cover_resolution: 'standard', kobo_country: 'ca', kobo_language: 'fr', audible_region: 'uk' }), 'Provider options were not saved');
    await change(document.getElementById('settings-language'), 'ja');
    document.querySelector('.settings-footer .btn-secondary').click();
    await until(() => !document.querySelector('.settings-modal-content'), 'Cancel did not close settings');
    check(calls.saves.length === 1 && calls.closes.at(-1) === undefined, 'Cancel saved a draft configuration');
    check(language === 'en', 'Cancel did not restore the last applied language');
    await open({ config: properties.config });
    check(document.getElementById('settings-language').value === 'en' && document.getElementById('settings-font-scale').value === '125', 'Cancel discarded the last applied settings');
    check(applyButton().disabled, 'Reopened applied settings are dirty');
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
        ['ArrowLeft', 'basic'], ['End', 'licenses'], ['ArrowRight', 'basic'],
        ['ArrowLeft', 'licenses'], ['Home', 'basic'],
    ]) {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await until(() => isActive(id), key + ' did not select ' + id);
        check(document.activeElement === tab(id), key + ' did not move focus with selection');
        checkTabSemantics(id);
    }
    render({ initialTab: 'api', navigationRequest: 3 });
    await until(() => isActive('api') && isApiSectionActive('preferred'), 'External API navigation did not open the first section');
    checkApiSection('preferred');
    await change(document.getElementById('settings-preferred-audio'), 'AudNexus');
    await navigateApiSection('cache');
    render({ navigationRequest: 4 });
    await until(() => isApiSectionActive('preferred'), 'Repeated external API navigation did not reset the selected section');
    checkApiSection('preferred');
    check(document.getElementById('settings-preferred-audio').value === 'AudNexus', 'External API navigation discarded the draft');
    await navigateApiSection('providers');
    const manualOpener = document.querySelector('.settings-api-manual-row button');
    manualOpener.focus();
    manualOpener.click();
    await until(() => document.querySelector('.settings-manual-dialog')?.contains(document.activeElement), 'API manual did not receive focus');
    const manual = document.querySelector('.settings-manual-dialog');
    const manualButtons = [...manual.querySelectorAll('button')];
    check(manual.querySelectorAll('.settings-provider-guide').length === 10, 'New source setup guides are missing');
    check(manual.scrollWidth <= manual.clientWidth + 1, 'Provider setup guides overflow horizontally');
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
    return { categories: categories.length, apiSections: apiSections.length, saved: calls.saves.length, cancelled: calls.closes.length, keyboardMoves: 8, manualFocusChecks: 4 };
}
async function runApplyInteractions() {
    await open();
    const attemptsBefore = calls.saveAttempts.length;
    const closesBefore = calls.closes.length;
    check(applyButton().disabled, 'Initial settings can be applied without changes');
    check(document.querySelector('.settings-save-note').textContent.trim() === translate('settings.save_note', language), 'Apply guidance is not localized');
    applyButton().click();
    await frame();
    check(calls.saveAttempts.length === attemptsBefore, 'Disabled Apply still invoked persistence');
    await navigate('folder');
    await selectPreview('/fixture/Books');
    check(applyButton().disabled, 'Library selection made the draft dirty');
    await navigate('api');
    await navigateApiSection('providers');
    document.querySelector('button[aria-controls="settings-secret-google"]').click();
    await frame();
    check(applyButton().disabled, 'Showing an API key made the draft dirty');
    document.querySelector('button[aria-controls="settings-secret-google"]').click();
    await frame();
    await changeProviderSetting('settings-secret-google', '   ');
    check(applyButton().disabled, 'Whitespace-only API key created a persistent change');
    await setProviderEnabled('Google Books', false);
    check(!applyButton().disabled, 'Provider change did not enable Apply');
    await setProviderEnabled('Google Books', true);
    check(applyButton().disabled, 'Restoring a provider to its original value left the draft dirty');
    await navigate('basic');
    await change(document.getElementById('settings-font-scale'), '125');
    check(!applyButton().disabled, 'Changed font scale did not enable Apply');
    await change(document.getElementById('settings-font-scale'), '100');
    check(applyButton().disabled, 'Restoring the original font scale left the draft dirty');
    await change(document.getElementById('settings-font-scale'), '125');
    let finishSave;
    nextSave = new Promise(resolve => { finishSave = resolve; });
    const savesBefore = calls.saves.length;
    applyButton().click();
    applyButton().click();
    await frame();
    check(calls.saveAttempts.length === attemptsBefore + 1 && applyButton().disabled, 'Pending apply allowed duplicate saves');
    check(applyButton().getAttribute('aria-busy') === 'true' && !document.getElementById('settings-font-scale').disabled, 'Pending apply does not announce its state or blocks editing');
    check(document.querySelector('.settings-footer .btn-secondary').disabled && document.querySelector('.modal-close').disabled, 'Pending apply allows the settings dialog to close');
    await change(document.getElementById('settings-font-scale'), '140');
    await change(document.getElementById('settings-language'), 'ja');
    check(applyButton().disabled, 'Editing during apply enabled a concurrent save');
    await navigate('viewer');
    const associationApply = () => document.querySelector('.settings-file-association-actions .settings-blue-btn');
    check(associationApply().disabled, 'Main apply allows concurrent file association persistence');
    const viewerPersistsBefore = calls.viewerPersists.length;
    associationApply().click();
    await frame();
    check(calls.viewerPersists.length === viewerPersistsBefore, 'File associations persisted while main apply was pending');
    await navigate('basic');
    finishSave();
    await until(() => calls.saves.length === savesBefore + 1 && !applyButton()?.disabled, 'Changes made while applying were not left dirty');
    check(calls.saves.at(-1).font_scale === 125 && document.getElementById('settings-font-scale').value === '140', 'Async apply overwrote the later draft or saved unsubmitted edits');
    check(calls.saves.at(-1).language === 'ko' && document.getElementById('settings-language').value === 'ja' && language === 'ja', 'Async apply overwrote the later language selection or preview');
    check(calls.closes.length === closesBefore && document.querySelector('.settings-modal-content'), 'Async apply closed settings');
    const reapplied = await applySettings('changes made while applying');
    check(reapplied.font_scale === 140 && reapplied.language === 'ja', 'Reapply did not persist the later draft');
    await change(document.getElementById('settings-font-scale'), '150');
    let failSave;
    nextSave = new Promise((_resolve, reject) => { failSave = reject; });
    const savesBeforeFailure = calls.saves.length;
    applyButton().click();
    await frame();
    check(applyButton().disabled, 'Failing apply was not marked pending');
    failSave(new Error('fixture apply failure'));
    await until(() => applyButton() && !applyButton().disabled, 'Failed apply cannot be retried');
    check(calls.saves.length === savesBeforeFailure && document.getElementById('settings-font-scale').value === '150', 'Failed apply changed the saved configuration or discarded the draft');
    check(properties.config.font_scale === 140 && calls.closes.length === closesBefore, 'Failed apply changed the last applied state or closed settings');
    const retried = await applySettings('retry after a failed apply');
    check(retried.font_scale === 150, 'Retry did not persist the retained draft');
    await open();
    await change(document.getElementById('settings-font-scale'), '125');
    await navigate('viewer');
    await until(() => associationApply() && !associationApply().disabled, 'File association controls did not become available');
    document.getElementById('settings-viewer-comic').closest('.settings-path-row').querySelectorAll('button')[1].click();
    await frame();
    check(document.getElementById('settings-viewer-comic').value === '', 'Viewer path clear did not update its draft');
    let finishViewerSave;
    nextViewerSave = new Promise(resolve => { finishViewerSave = resolve; });
    const mainAttemptsBeforeViewerSave = calls.saveAttempts.length;
    const associationsBefore = calls.associations.length;
    associationApply().click();
    applyButton().click();
    await frame();
    check(applyButton().disabled && calls.saveAttempts.length === mainAttemptsBeforeViewerSave, 'Partial viewer persistence allowed a simultaneous main apply');
    check(calls.viewerPersists.length === viewerPersistsBefore + 1 && calls.associations.length === associationsBefore, 'File associations ran before viewer path persistence completed');
    finishViewerSave();
    await until(() => calls.associations.length === associationsBefore + 1 && !associationApply().disabled, 'File association persistence did not finish');
    check(properties.config.viewer_paths.comic === '' && properties.config.font_scale === 100, 'Partial persistence changed an unrelated unapplied setting');
    check(!applyButton().disabled, 'Partial persistence incorrectly marked unrelated font edits clean');
    await navigate('basic');
    await change(document.getElementById('settings-font-scale'), '100');
    check(applyButton().disabled, 'Persisted viewer paths remained dirty after reverting unrelated edits');
    return { initialClean: true, uiOnlyClean: true, revertedClean: true, duplicateBlocked: true, pendingEditsRetained: true, languageRetained: true, retry: true, fileAssociationGuards: true, partialBaseline: true };
}
async function prepareProviderKeyboardToggle() {
    await open({ initialTab: 'api' });
    await navigateApiSection('providers');
    const toggle = providerSwitch('Goodreads');
    toggle.scrollIntoView({ block: 'nearest' });
    toggle.focus();
    check(document.activeElement === toggle, 'Source switch cannot receive keyboard focus');
}
async function checkProviderKeyboardToggle(enabled) {
    await until(() => providerSwitch('Goodreads')?.getAttribute('aria-checked') === String(enabled), 'Native keyboard activation did not toggle the source');
    check(document.activeElement === providerSwitch('Goodreads'), 'Source toggle lost keyboard focus');
    check(providerSwitch('Open Library').getAttribute('aria-checked') === 'true', 'Keyboard activation changed another source');
}
async function runProviderInteractions() {
    const savesBefore = calls.saves.length;
    const original = {
        ...baseline,
        preferred_meta_api_comic: '리디북스', preferred_meta_api_book: '리디북스',
        preferred_meta_api_pdf: '리디북스', preferred_meta_api_audio: '리디북스',
        api_keys: { hardcover: 'saved-token' },
    };
    const originalSnapshot = JSON.stringify(original);
    await open({ initialTab: 'api', config: original });
    await navigateApiSection('providers');
    checkProviderCards('legacy settings without an enabled map');
    for (const key of ['yes24', 'aladin', 'google', 'vine', 'hardcover']) {
        const secret = document.getElementById('settings-secret-' + key);
        const reveal = secret.closest('.settings-provider-secret')?.querySelector('button');
        check(reveal && reveal.getAttribute('aria-controls') === secret.id, 'Provider secret reveal button is missing: ' + key);
        check(secret.type === 'password' && reveal.getAttribute('aria-pressed') === 'false', 'Provider secret should start masked: ' + key);
        const value = secret.value;
        reveal.click();
        await until(() => secret.type === 'text' && reveal.getAttribute('aria-pressed') === 'true', 'Provider secret did not reveal: ' + key);
        reveal.click();
        await until(() => secret.type === 'password' && reveal.getAttribute('aria-pressed') === 'false', 'Provider secret did not hide: ' + key);
        check(secret.value === value, 'Revealing a provider secret changed its value: ' + key);
    }
    check(providerCard('YES24').querySelector('.settings-provider-status')?.textContent.trim() === translate('metadata_provider_setup_required', language), 'Enabled source without a key needs setup guidance');
    await setProviderEnabled('YES24', false);
    check(!providerCard('YES24').querySelector('.settings-provider-status'), 'Disabled source retains a status message');
    await setProviderEnabled('YES24', true);
    check(providerCard('YES24').querySelector('.settings-provider-status')?.textContent.trim() === translate('metadata_provider_setup_required', language), 'Missing credentials prevented re-enabling a source');
    await changeProviderSetting('settings-secret-hardcover', 'retained-token');
    await changeProviderSetting('settings-kobo-country', 'ca');
    await changeProviderSetting('settings-kobo-language', 'fr');
    const disabled = { '리디북스': false, Hardcover: false, Kobo: false };
    for (const source of Object.keys(disabled)) await setProviderEnabled(source, false);
    checkProviderCards('disabled sources remain manageable', disabled);
    await navigateApiSection('preferred');
    for (const type of ['comic', 'book', 'pdf', 'audio']) {
        const select = document.getElementById('settings-preferred-' + type);
        const options = [...select.options].map(option => option.value);
        check(Object.keys(disabled).every(source => !options.includes(source)), 'Disabled source remains in preferred options: ' + type);
        check(select.value && options.includes(select.value) && select.value !== '리디북스', 'Disabled preference did not choose an available fallback: ' + type);
    }
    await navigateApiSection('providers');
    check(document.getElementById('settings-secret-hardcover').value === 'retained-token', 'Disabling a source discarded its token draft');
    check(document.getElementById('settings-kobo-country').value === 'ca' && document.getElementById('settings-kobo-language').value === 'fr', 'Disabling a source discarded its options');
    check(JSON.stringify(original) === originalSnapshot, 'Source toggles mutated the saved configuration');
    check(calls.saves.length === savesBefore, 'Source toggle saved before confirmation');
    const saved = await applySettings('source settings');
    check(calls.saves.length === savesBefore + 1, 'Source configuration was not saved exactly once');
    check(providerSources.every(source => saved.metadata_api_enabled[source] === (disabled[source] !== false)), 'Saved source states are incomplete or incorrect');
    check(saved.api_keys.hardcover === 'retained-token', 'Disabled source token was not preserved in saved settings');
    check(saved.metadata_providers.kobo_country === 'ca' && saved.metadata_providers.kobo_language === 'fr', 'Disabled source options were not preserved in saved settings');
    await open({ initialTab: 'api', config: saved });
    await navigateApiSection('providers');
    checkProviderCards('reopened saved sources', disabled);
    await setProviderEnabled('Hardcover', true);
    await setProviderEnabled('Kobo', true);
    check(document.getElementById('settings-secret-hardcover').value === 'retained-token', 'Re-enabling a source discarded its saved token');
    await changeProviderSetting('settings-secret-hardcover', 'cancelled-token');
    document.querySelector('.settings-footer .btn-secondary').click();
    await until(() => !document.querySelector('.settings-modal-content'), 'Source settings cancel did not close');
    check(calls.saves.length === savesBefore + 1 && calls.closes.at(-1) === undefined, 'Cancel persisted source changes');
    await open({ initialTab: 'api', config: saved });
    await navigateApiSection('providers');
    checkProviderCards('cancelled source changes', disabled);
    check(document.getElementById('settings-secret-hardcover').value === 'retained-token', 'Cancelled token persisted on reopen');
    for (const source of providerSources) await setProviderEnabled(source, false);
    const allDisabled = Object.fromEntries(providerSources.map(source => [source, false]));
    checkProviderCards('all sources disabled', allDisabled);
    await navigateApiSection('preferred');
    for (const type of ['comic', 'book', 'pdf', 'audio']) {
        const select = document.getElementById('settings-preferred-' + type);
        check(select.options.length === 1 && select.options[0].value === '통합검색' && select.value === '통합검색', 'All-disabled preference has an invalid selection: ' + type);
    }
    const allDisabledSaved = await applySettings('all-disabled sources');
    check(providerSources.every(source => allDisabledSaved.metadata_api_enabled[source] === false), 'All-disabled source state did not save');
    await open({ initialTab: 'api', config: allDisabledSaved });
    await navigateApiSection('providers');
    checkProviderCards('reopened all-disabled sources', allDisabled);
    await setProviderEnabled('리디북스', true);
    await navigateApiSection('preferred');
    for (const type of ['comic', 'book', 'pdf', 'audio']) {
        const options = [...document.getElementById('settings-preferred-' + type).options].map(option => option.value);
        check(JSON.stringify(options) === JSON.stringify(['통합검색', '리디북스']), 'Re-enabled source did not return to preferred options: ' + type);
    }
    return { sources: providerSources.length, persisted: true, cancelled: true, retainedValues: true, fallback: true, allDisabled: true, keyboardActivations: 2 };
}
const previewItems = () => [...document.querySelectorAll('.settings-library-preview-item')];
const previewItem = path => previewItems().find(item => item.dataset.libraryPath === path);
const libraryRow = path => [...document.querySelectorAll('.settings-library-list-item')]
    .find(item => item.dataset.libraryPath === path);
const libraryGroup = key => [...document.querySelectorAll('.settings-library-group')]
    .find(group => group.dataset.libraryGroup === key);
const libraryEditor = () => document.querySelector('.settings-library-editor');
const editorOffset = editor => new DOMMatrixReadOnly(getComputedStyle(editor).transform).m42;
async function waitForLibraryEditor() {
    await until(() => libraryEditor()?.classList.contains('is-open') && !libraryEditor().inert && Math.abs(editorOffset(libraryEditor())) <= 0.5,
        'Library editor did not finish sliding open');
}
function checkPreview(expected, groups, context) {
    const actual = previewItems();
    check(JSON.stringify(actual.map(item => [item.dataset.libraryPath, item.textContent.trim()])) === JSON.stringify(expected),
        context + ': unexpected preview order or names: ' + JSON.stringify(actual.map(item => [item.dataset.libraryPath, item.textContent.trim()])));
    check(actual.every(item => item.tagName === 'BUTTON'), context + ': preview items must be keyboard-accessible buttons');
    const displayedGroups = [...document.querySelectorAll('.settings-library-preview-group')].map(group => group.dataset.group);
    check(JSON.stringify(displayedGroups) === JSON.stringify(groups), context + ': unexpected group order: ' + JSON.stringify(displayedGroups));
    const registered = [...document.querySelectorAll('.settings-library-list-item')];
    check(JSON.stringify(registered.map(row => [row.dataset.libraryPath, row.querySelector('.settings-library-list-title')?.textContent.trim()])) === JSON.stringify(expected),
        context + ': registered libraries differ from the preview');
    const registeredGroups = [...document.querySelectorAll('.settings-library-group')];
    check(JSON.stringify(registeredGroups.map(group => group.dataset.libraryGroup)) === JSON.stringify(groups), context + ': registered group order differs from the preview');
    for (const group of registeredGroups) {
        check(Boolean(group.querySelector('.settings-library-group-heading')?.textContent.trim()), context + ': group heading is missing: ' + group.dataset.libraryGroup);
        for (const row of group.querySelectorAll('.settings-library-list-item')) {
            check(previewItem(row.dataset.libraryPath)?.closest('.settings-library-preview-group')?.dataset.group === group.dataset.libraryGroup,
                context + ': registered library belongs to a different preview group: ' + row.dataset.libraryPath);
        }
    }
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
    await waitForLibraryEditor();
}
async function libraryAction(path, key) {
    const row = libraryRow(path);
    const button = [...(row?.querySelectorAll('button') || [])]
        .find(candidate => candidate.getAttribute('aria-label') === translate(key, language));
    check(button && !button.disabled, 'Missing or disabled library action: ' + key + ':' + path);
    button.click();
    await frame();
}
async function dragLibrary(source, target, position = 'before') {
    check(source?.draggable && target, 'Missing library drag source or target');
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    await frame();
    check(dataTransfer.types.includes('text/plain'), 'Library drag did not populate its transfer data');
    if (typeof target === 'function') target = target();
    check(target, 'Library drop target did not appear during dragging');
    target.scrollIntoView({ block: 'center' });
    await frame();
    const bounds = target.getBoundingClientRect();
    const eventOptions = {
        bubbles: true, cancelable: true, dataTransfer,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height * (position === 'after' ? 0.75 : 0.25),
    };
    const over = new DragEvent('dragover', eventOptions);
    target.dispatchEvent(over);
    check(over.defaultPrevented, 'Library drop target did not accept the internal drag');
    target.dispatchEvent(new DragEvent('drop', eventOptions));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    await frame();
}
const dragLibraryEntry = (path, target, position) => dragLibrary(libraryRow(path)?.querySelector('.settings-library-drag-handle'), target, position);
const dragLibraryGroup = (key, targetKey, position) => dragLibrary(libraryGroup(key)?.querySelector('.settings-library-group-drag-handle'), libraryGroup(targetKey), position);
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
    document.getElementById('settings-library-alias').click();
    check(document.querySelector('.settings-library-editor'), 'Clicking inside the editor closed it');
    libraryRow('/fixture/Books').querySelector('.settings-library-select').click();
    await frame();
    check(document.getElementById('settings-library-alias').value === '전자책 서재', 'List selection did not switch the editor');
    await selectPreview('/fixture/Novels');
    check(document.getElementById('settings-library-alias').value === '새 소설', 'Switching selection discarded the alias draft');
    panel().querySelector('h2').click();
    await until(() => !document.querySelector('.settings-library-editor'), 'Clicking outside the editor did not close it');
    check(!document.querySelector('.settings-library-preview-item[aria-pressed="true"]'), 'Closing the editor retained a preview selection');
    await selectPreview('/fixture/Novels');
    check(document.getElementById('settings-library-alias').value === '새 소설' && document.getElementById('settings-library-group').value === '로컬', 'Reopening the editor lost its draft');
    const closesBeforeEscape = calls.closes.length;
    document.getElementById('settings-library-alias').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('.settings-library-editor'), 'Escape did not close the library editor');
    check(document.querySelector('.settings-modal-content') && calls.closes.length === closesBeforeEscape, 'Escape closed the settings dialog with its editor');
    await selectPreview('/fixture/Novels');
    check(document.getElementById('settings-library-alias').value === '새 소설', 'Escape discarded the editor draft');
    await dragLibraryEntry('/fixture/Novels', libraryRow('/fixture/Comics'), 'before');
    checkPreview([
        ['/fixture/Books', '전자책 서재'], ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'],
        ['/fixture/Novels', '새 소설'], ['/fixture/Comics', '만화 라이브러리'],
    ], ['NAS', '', '로컬'], 'folder dragged before its sibling');
    await dragLibraryEntry('/fixture/Novels', libraryRow('/fixture/Comics'), 'after');
    checkPreview([
        ['/fixture/Books', '전자책 서재'], ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'],
        ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'],
    ], ['NAS', '', '로컬'], 'folder dragged after its sibling');
    await dragLibraryGroup('', 'NAS', 'before');
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'],
        ['/fixture/Books', '전자책 서재'], ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'],
    ], ['', 'NAS', '로컬'], 'group dragged before another group');
    await dragLibraryGroup('NAS', '로컬', 'after');
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'],
        ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'], ['/fixture/Books', '전자책 서재'],
    ], ['', '로컬', 'NAS'], 'group dragged after another group');
    await selectPreview('/fixture/Books');
    await dragLibraryEntry('/fixture/Books', libraryGroup('로컬').querySelector('.settings-library-group-heading'));
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'],
        ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'], ['/fixture/Books', '전자책 서재'],
    ], ['', '로컬'], 'folder dropped on a group heading');
    await selectPreview('/fixture/Books');
    check(document.getElementById('settings-library-group').value === '로컬', 'Drag transfer did not update the selected group field');
    await dragLibraryEntry('/fixture/Books', libraryGroup('').querySelector('.settings-library-group-heading'));
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'], ['/fixture/Books', '전자책 서재'],
        ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'],
    ], ['', '로컬'], 'folder dragged out of its group');
    await selectPreview('/fixture/Books');
    check(document.getElementById('settings-library-group').value === '' && document.getElementById('settings-library-alias').value === '전자책 서재', 'Ungrouping lost the alias or retained the previous group');
    await dragLibraryEntry('/fixture/Audio', libraryRow('/fixture/Novels'), 'after');
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Books', '전자책 서재'],
        ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'], ['/fixture/Audio', '오디오북'],
    ], ['', '로컬'], 'folder dropped beside an item in another group');
    await libraryAction('/fixture/Books', 'btn_remove');
    nextSelectedFolder = '/fixture/NewLibrary';
    document.querySelector('.settings-library-toolbar button').click();
    await until(() => previewItem(nextSelectedFolder), 'Added library did not appear in preview');
    nextSelectedFolder = null;
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/NewLibrary', 'NewLibrary'],
        ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'], ['/fixture/Audio', '오디오북'],
    ], ['', '로컬'], 'removed and added libraries');
    check(calls.saves.length === savesBefore && calls.effects.length === effectsBefore, 'Library preview caused persistence or filesystem work before saving');
    check(JSON.stringify(baseline) === baselineBefore, 'Library edits mutated the saved configuration');
    const saved = await applySettings('library changes');
    check(calls.saves.length === savesBefore + 1, 'Library draft was not saved exactly once');
    check(JSON.stringify(saved.libraries) === JSON.stringify(['/fixture/Downloads', '/fixture/Comics', '/fixture/Novels', '/fixture/Audio', '/fixture/NewLibrary']), 'Saved library order differs from the edited list');
    check(saved.library_entries.find(entry => entry.path === '/fixture/Novels')?.alias === '새 소설', 'Edited alias was not saved');
    check(saved.library_entries.find(entry => entry.path === '/fixture/Novels')?.group === '로컬', 'Edited group was not saved');
    check(saved.library_entries.find(entry => entry.path === '/fixture/Audio')?.group === '로컬', 'Drag transfer group was not saved');
    await open({ initialTab: 'folder', config: saved });
    checkPreview([
        ['/fixture/Downloads', 'Downloads'], ['/fixture/NewLibrary', 'NewLibrary'],
        ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '새 소설'], ['/fixture/Audio', '오디오북'],
    ], ['', '로컬'], 'reopened drag edits');
    await open({ initialTab: 'folder' });
    await selectPreview('/fixture/Books');
    await change(document.getElementById('settings-library-alias'), '취소할 이름');
    await dragLibraryGroup('로컬', 'NAS', 'before');
    await dragLibraryEntry('/fixture/Books', libraryGroup('').querySelector('.settings-library-group-heading'));
    document.querySelector('.settings-footer .btn-secondary').click();
    await until(() => !document.querySelector('.settings-modal-content'), 'Library cancel did not close settings');
    check(calls.saves.length === savesBefore + 1 && calls.closes.at(-1) === undefined, 'Cancel persisted the library preview draft');
    await open({ initialTab: 'folder' });
    checkPreview([
        ['/fixture/Books', '전자책 서재'], ['/fixture/Novels', '소설 모음'],
        ['/fixture/Downloads', 'Downloads'], ['/fixture/Audio', '오디오북'], ['/fixture/Comics', '만화 라이브러리'],
    ], ['NAS', '', '로컬'], 'cancelled alias, group and order changes');
    const namedLibraries = libraryFixtures.filter(entry => entry.group);
    await open({ initialTab: 'folder', config: { ...baseline, libraries: namedLibraries.map(entry => entry.path), library_entries: namedLibraries } });
    check(!libraryGroup(''), 'An empty ungrouped section appeared before dragging');
    await dragLibraryEntry('/fixture/Novels', () => libraryGroup('')?.querySelector('.settings-library-group-heading'));
    checkPreview([
        ['/fixture/Books', '전자책 서재'], ['/fixture/Comics', '만화 라이브러리'], ['/fixture/Novels', '소설 모음'],
    ], ['NAS', '로컬', ''], 'ungrouped drop target created for named libraries');
    await open({ initialTab: 'folder', config: { ...baseline, libraries: [], library_entries: [] } });
    checkPreview([], [], 'empty libraries');
    check(document.querySelector('.settings-library-preview')?.textContent.includes(translate('folder.sidebar.empty_libraries', language)), 'Empty library preview has no guidance');
    return { mutations: 13, dragAndDrop: 7, draftIsolation: true, saved: true, cancelled: true, empty: true };
}
async function runLibraryEditorTransitions(reducedMotion = false) {
    await open({ initialTab: 'folder' });
    check(matchMedia('(prefers-reduced-motion: reduce)').matches === reducedMotion, 'Editor fixture has an unexpected motion preference');
    if (reducedMotion) {
        await selectPreview('/fixture/Books');
        const editor = libraryEditor();
        check(getComputedStyle(editor).transitionDuration === '0s' && Math.abs(editorOffset(editor)) <= 0.5,
            'Reduced motion did not open the editor immediately');
        check(editor.contains(document.activeElement), 'Reduced motion lost editor focus');
        libraryRow('/fixture/Novels').querySelector('.settings-library-select').click();
        await frame();
        check(libraryEditor() === editor && document.getElementById('settings-library-alias').value === '소설 모음',
            'Reduced motion changed editor selection behavior');
        panel().querySelector('h2').click();
        await frame();
        check(!libraryEditor(), 'Reduced motion waited for the exit timer');
        await selectPreview('/fixture/Books');
        document.getElementById('settings-tab-basic').click();
        await frame();
        check(!libraryEditor(), 'Reduced motion retained an editor after switching tabs');
        return { opensImmediately: true, closesImmediately: true, retainsNodeOnSelection: true, restoresFocus: true };
    }
    const firstEditorFrame = new Promise(resolve => {
        const observer = new MutationObserver(() => {
            const editor = libraryEditor();
            if (!editor) return;
            observer.disconnect();
            requestAnimationFrame(() => resolve({
                expanded: editor.classList.contains('is-open'),
                offset: editorOffset(editor),
                height: editor.offsetHeight,
                focused: editor.contains(document.activeElement),
            }));
        });
        observer.observe(document.querySelector('.settings-content'), { childList: true, subtree: true });
    });
    previewItem('/fixture/Books').click();
    const firstFrame = await firstEditorFrame;
    check(!firstFrame.expanded && firstFrame.offset >= firstFrame.height && !firstFrame.focused,
        'Library editor did not prepare a closed, unfocused frame before entering: ' + JSON.stringify(firstFrame));
    await until(() => libraryEditor(), 'Selecting a library did not mount its editor');
    const editor = libraryEditor();
    check(getComputedStyle(editor).transitionDuration === '0.22s', 'Library editor did not retain its slide duration');
    const initialOffset = editorOffset(editor);
    check(initialOffset > 1, 'Library editor did not begin below its open position');
    let previousOffset = initialOffset;
    await until(() => {
        const offset = editorOffset(editor);
        check(offset <= previousOffset + 0.5, 'Library editor reversed or jumped during its opening frames');
        previousOffset = offset;
        return editor.classList.contains('is-open') && !editor.inert && Math.abs(offset) <= 0.5;
    }, 'Library editor did not finish sliding open');
    check(editor === libraryEditor() && Math.abs(editorOffset(editor)) <= 0.5, 'Library editor did not slide up into place');
    const openBounds = editor.getBoundingClientRect();
    libraryRow('/fixture/Novels').querySelector('.settings-library-select').click();
    for (let frameIndex = 0; frameIndex < 3; frameIndex++) {
        await frame();
        check(libraryEditor() === editor && editor.classList.contains('is-open') && Math.abs(editorOffset(editor)) <= 0.5,
            'Changing libraries remounted the editor or restarted its animation');
    }
    check(document.getElementById('settings-library-alias').value === '소설 모음', 'Changing libraries did not replace the editor contents');
    check(Math.abs(editor.getBoundingClientRect().top - openBounds.top) <= 1, 'Changing libraries moved the editor');
    panel().querySelector('h2').click();
    await frame();
    check(libraryEditor() === editor && editor.inert && editor.getAttribute('aria-hidden') === 'true' && !editor.classList.contains('is-open'),
        'Closing editor was removed immediately or remained interactive');
    await until(() => !libraryEditor() || editorOffset(editor) > 1, 'Library editor did not slide down while closing');
    check(libraryEditor() === editor, 'Library editor disappeared before its exit transition');
    await until(() => !libraryEditor(), 'Library editor did not unmount after sliding closed');
    await selectPreview('/fixture/Books');
    const reopened = libraryEditor();
    panel().querySelector('h2').click();
    await frame();
    check(libraryEditor() === reopened && reopened.inert, 'Rapid reopen did not exercise a closing editor');
    await selectPreview('/fixture/Novels');
    check(libraryEditor() === reopened && !reopened.inert && reopened.getAttribute('aria-hidden') !== 'true', 'Reopening a closing editor replaced its node or retained hidden state');
    await new Promise(resolve => setTimeout(resolve, 300));
    check(libraryEditor() === reopened && reopened.classList.contains('is-open') && document.getElementById('settings-library-alias').value === '소설 모음',
        'A stale close completion removed the reopened editor');
    panel().querySelector('h2').click();
    await until(() => !libraryEditor(), 'Library editor did not close before the pending-entry check');
    previewItem('/fixture/Books').click();
    await until(() => libraryEditor(), 'Pending library editor did not mount');
    document.getElementById('settings-tab-basic').click();
    await until(() => !libraryEditor(), 'Switching tabs did not cancel the pending library editor');
    check(!document.querySelector('.settings-modal-body').classList.contains('has-library-editor'),
        'Switching tabs retained the library editor spacing');
    return { preparesClosedFrame: true, slidesOpen: true, slidesClosed: true, retainsNodeOnSelection: true, rapidReopen: true, cancelsPendingEntry: true };
}
let libraryPointerSelection;
async function prepareLibraryPointerSelection(source, path) {
    if (!libraryEditor()) {
        await open({ initialTab: 'folder' });
        await selectPreview('/fixture/Books');
    }
    const row = libraryRow(path);
    const target = source === 'preview' ? previewItem(path) : source === 'row' ? row : row.querySelector('.settings-library-select');
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    await frame();
    const bounds = target.getBoundingClientRect();
    const point = { x: Math.round(source === 'row' ? bounds.left + 3 : bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
    check(target.contains(document.elementFromPoint(point.x, point.y)), 'Library pointer target is covered: ' + source);
    if (source === 'row') check(document.elementFromPoint(point.x, point.y) === row, 'Expected registered row padding as pointer target');
    const editor = libraryEditor();
    const trace = { source, path, editor, events: [], errors: [], frame: 0 };
    const sample = () => {
        if (libraryEditor() !== editor || !editor.classList.contains('is-open') || editor.inert || Math.abs(editorOffset(editor)) > 0.5) {
            trace.errors.push('Pointer selection closed, moved or replaced the editor');
        }
    };
    const sampleFrame = () => { sample(); trace.frame = requestAnimationFrame(sampleFrame); };
    trace.observer = new MutationObserver(records => {
        if (records.some(record => !record.oldValue?.split(' ').includes('is-open'))) trace.errors.push('Pointer selection removed the open class between click phases');
        sample();
    });
    trace.observer.observe(editor, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    trace.record = event => { trace.events.push([event.type, event.isTrusted]); sample(); };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) window.addEventListener(type, trace.record, true);
    trace.frame = requestAnimationFrame(sampleFrame);
    libraryPointerSelection = trace;
    return point;
}
async function checkLibraryPointerSelection() {
    for (let index = 0; index < 5; index++) await frame();
    const trace = libraryPointerSelection;
    cancelAnimationFrame(trace.frame);
    trace.observer.disconnect();
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) window.removeEventListener(type, trace.record, true);
    check(JSON.stringify(trace.events) === JSON.stringify(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].map(type => [type, true])),
        'Library selection did not receive a trusted pointer sequence: ' + JSON.stringify(trace.events));
    check(trace.errors.length === 0, trace.source + ': ' + trace.errors.join('; '));
    check(document.querySelector('.settings-library-editor-path').textContent.includes(trace.path), 'Pointer selection did not update the editor contents');
    check(libraryRow(trace.path).classList.contains('active') && previewItem(trace.path).getAttribute('aria-pressed') === 'true', 'Pointer selection did not synchronize list and preview');
    return { source: trace.source, trustedPointer: true, retainsOpenEditor: true };
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
    for (const list of document.querySelectorAll('.settings-library-list, .settings-library-preview-list')) {
        check(!['auto', 'scroll'].includes(getComputedStyle(list).overflowY), context + ': library list still has an internal scroll region');
        check(list.scrollHeight <= list.clientHeight + 1, context + ': library list clips its items');
    }
    for (const group of document.querySelectorAll('.settings-library-group')) {
        const groupHandle = group.querySelector('.settings-library-group-drag-handle');
        check(groupHandle?.tagName === 'BUTTON' && groupHandle.draggable && groupHandle.dataset.libraryDragGroup === group.dataset.libraryGroup,
            context + ': group drag handle is missing: ' + group.dataset.libraryGroup);
        const rows = [...group.querySelectorAll('.settings-library-list-item')];
        for (const [index, row] of rows.entries()) {
            const handle = row.querySelector('.settings-library-drag-handle');
            const select = row.querySelector('.settings-library-select');
            const remove = [...row.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === translate('btn_remove', language));
            check(handle?.tagName === 'BUTTON' && handle.draggable && handle.dataset.libraryDragPath === row.dataset.libraryPath,
                context + ': folder drag handle is missing: ' + row.dataset.libraryPath);
            check(Boolean(handle.getAttribute('aria-label')) && Boolean(groupHandle.getAttribute('aria-label')), context + ': drag handle has no accessible name');
            check(row.querySelectorAll('button').length === 3 && remove && select, context + ': old move or edit actions remain');
            check(handle.getBoundingClientRect().right <= select.getBoundingClientRect().left + 1, context + ': folder drag handle is not on the left');
            const removeStyle = getComputedStyle(remove);
            const color = removeStyle.color.match(/[0-9.]+/g)?.map(Number) || [];
            check(color[0] > color[1] + 30 && color[0] > color[2] + 30, context + ': delete button is not red');
            const background = removeStyle.backgroundColor.match(/[0-9.]+/g)?.slice(0, 3).map(Number) || [];
            check(background.length === 3 && Math.max(...background) - Math.min(...background) <= 12 && Math.max(...background) <= 80,
                context + ': delete button lost its neutral dark background');
            if (index > 0) check(Math.abs(row.getBoundingClientRect().top - rows[index - 1].getBoundingClientRect().bottom) <= 1, context + ': library rows still have a gap');
        }
    }
}
async function checkLibraryEditorLayout(context) {
    await waitForLibraryEditor();
    await frame();
    const content = document.querySelector('.settings-content');
    const body = panel();
    const editor = document.querySelector('.settings-library-editor');
    const footer = document.querySelector('.settings-footer');
    check(editor && editor.parentElement === content && body.parentElement === content, context + ': editor is not beside the scrolling body');
    const contentBounds = content.getBoundingClientRect();
    const before = editor.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    check(before.left >= contentBounds.left - 1 && before.right <= contentBounds.right + 1 && before.top >= contentBounds.top - 1, context + ': editor escaped its content area');
    check(Math.abs(before.bottom - contentBounds.bottom) <= 1, context + ': editor is not flush with the content bottom');
    const editorStyle = getComputedStyle(editor);
    check(parseFloat(editorStyle.borderBottomWidth) === 0 && parseFloat(editorStyle.borderBottomLeftRadius) === 0 && parseFloat(editorStyle.borderBottomRightRadius) === 0,
        context + ': editor retains a lower border or rounded bottom corners');
    check(before.bottom <= footerBounds.top + 1, context + ': editor covers the settings footer');
    check(parseFloat(getComputedStyle(body).paddingBottom) >= before.height + 24, context + ': scrolling content has no space reserved for the editor');
    checkLabels(context);
    checkInlineFields(context);
    body.scrollTop = body.scrollHeight;
    await frame();
    const after = editor.getBoundingClientRect();
    check(Math.abs(before.top - after.top) <= 1 && Math.abs(before.bottom - after.bottom) <= 1, context + ': editor moves with the scrolling body');
    check(body.lastElementChild.getBoundingClientRect().bottom <= after.top + 1, context + ': last content is hidden behind the editor');
    const save = footer.querySelector('.btn-primary');
    const saveBounds = save.getBoundingClientRect();
    const target = document.elementFromPoint(saveBounds.left + saveBounds.width / 2, saveBounds.top + saveBounds.height / 2);
    check(target === save || save.contains(target) || (save.disabled && footer.contains(target)), context + ': editor blocks the apply button');
    body.scrollTop = 0;
}
async function prepareLibraryEditorResize() {
    await open({ initialTab: 'folder' });
    await selectPreview('/fixture/Books');
}
function checkApiNavigationLayout(context, section) {
    const sidebar = document.querySelector('.settings-sidebar').getBoundingClientRect();
    const submenu = document.querySelector('.settings-api-submenu').getBoundingClientRect();
    const parent = tab('api').getBoundingClientRect();
    const selected = apiSection(section).getBoundingClientRect();
    check(submenu.width > 0 && submenu.height > 0, context + ': API submenu collapsed');
    check(submenu.left >= sidebar.left - 1 && submenu.right <= sidebar.right + 1, context + ': API submenu escaped the sidebar width');
    check(submenu.top >= parent.bottom - 1, context + ': API submenu is not below its parent');
    if (innerWidth <= 760) {
        check(submenu.top >= sidebar.top - 1 && submenu.bottom <= sidebar.bottom + 1, context + ': compact submenu escaped its navigation row');
        check(selected.left >= submenu.left - 1 && selected.right <= submenu.right + 1, context + ': selected API section is outside its compact navigation viewport');
        check(selected.top >= submenu.top - 1 && selected.bottom <= submenu.bottom + 1, context + ': compact API section wrapped outside its row');
    }
}
function checkSidebarMenuLayout(context) {
    const sidebar = document.querySelector('.settings-sidebar');
    const sidebarBounds = sidebar.getBoundingClientRect();
    check(!document.querySelector('.settings-sidebar-resizer, [role="separator"]'), context + ': unexpected sidebar resize control');
    if (innerWidth > 760) {
        check(sidebarBounds.width >= 280 && sidebar.scrollWidth <= sidebar.clientWidth + 1, context + ': sidebar is too narrow or overflows horizontally');
    }
    for (const text of sidebar.querySelectorAll('.settings-nav-copy strong, .settings-nav-copy small, .settings-api-submenu button')) {
        if (!text.getClientRects().length) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        const textBounds = range.getBoundingClientRect();
        const linePositions = [...range.getClientRects()].filter(bounds => bounds.width > 0 && bounds.height > 0).map(bounds => bounds.top);
        const buttonBounds = text.closest('button').getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
        check(Math.max(...linePositions) - Math.min(...linePositions) < lineHeight / 2, context + ': menu text wraps: ' + text.textContent.trim());
        check(textBounds.left >= buttonBounds.left - 1 && textBounds.right <= buttonBounds.right + 1, context + ': menu text is clipped by its button: ' + text.textContent.trim());
        if (innerWidth > 760) check(buttonBounds.left >= sidebarBounds.left - 1 && buttonBounds.right <= sidebarBounds.right + 1, context + ': menu button escaped the sidebar');
    }
}
function checkProviderLayout(context) {
    checkProviderCards(context);
    for (const card of providerCards()) {
        const source = card.dataset.provider;
        const bounds = card.getBoundingClientRect();
        const toggle = providerSwitch(source).getBoundingClientRect();
        check(bounds.width > 0 && bounds.height > 0, context + ': collapsed source card: ' + source);
        check(card.scrollWidth <= card.clientWidth + 1, context + ': source card overflows horizontally: ' + source);
        check(toggle.width > 0 && toggle.height > 0 && toggle.left >= bounds.left - 1 && toggle.right <= bounds.right + 1, context + ': source toggle escaped its card: ' + source);
        for (const control of card.querySelectorAll('input, select')) {
            check(control.getClientRects().length > 0, context + ': source setting is hidden: ' + control.id);
            const controlBounds = control.getBoundingClientRect();
            check(controlBounds.left >= bounds.left - 1 && controlBounds.right <= bounds.right + 1, context + ': source setting escaped its card: ' + control.id);
        }
        const secret = card.querySelector('.settings-provider-secret');
        if (secret) {
            const secretBounds = secret.getBoundingClientRect();
            const input = secret.querySelector('input');
            const inlineLabel = secret.querySelector('label');
            const reveal = secret.querySelector('button');
            check(inlineLabel?.htmlFor === input?.id && input.labels.length > 0, context + ': provider secret lost its inline label: ' + source);
            check(reveal, context + ': provider secret lost its reveal action: ' + source);
            check(secretBounds.right <= toggle.left + 1, context + ': provider secret is not left of the switch: ' + source);
            check(Math.abs((secretBounds.top + secretBounds.bottom) / 2 - (toggle.top + toggle.bottom) / 2) <= 2, context + ': provider secret and switch are not vertically aligned: ' + source);
            const labelBounds = inlineLabel.getBoundingClientRect();
            const inputBounds = input.getBoundingClientRect();
            const revealBounds = reveal.getBoundingClientRect();
            for (const [name, fieldBounds] of [['label', labelBounds], ['input', inputBounds], ['reveal', revealBounds]]) {
                check(fieldBounds.width > 0 && fieldBounds.height > 0, context + ': collapsed secret ' + name + ': ' + source);
                check(fieldBounds.left >= secretBounds.left - 1 && fieldBounds.right <= secretBounds.right + 1 && fieldBounds.top >= secretBounds.top - 1 && fieldBounds.bottom <= secretBounds.bottom + 1, context + ': secret ' + name + ' escaped its field: ' + source);
            }
            const inputStyle = getComputedStyle(input);
            const textLeft = inputBounds.left + parseFloat(inputStyle.paddingLeft);
            const textRight = inputBounds.right - parseFloat(inputStyle.paddingRight);
            check(labelBounds.right <= textLeft + 1 && textRight <= revealBounds.left + 1, context + ': inline secret label or reveal overlaps the input text: ' + source);
        }
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
    const pages = categories.flatMap(id => id === 'api'
        ? apiSections.map(section => ({ id, section })) : [{ id }]);
    for (const { id, section } of pages) {
        await navigate(id);
        if (id === 'licenses') {
            check(panel().querySelector('.settings-license-badge')?.textContent === 'MIT License', context + ': app license missing');
            check(panel().querySelector('.settings-license-copyright')?.textContent.includes('dongkkase'), context + ': copyright missing');
            check(!panel().textContent.includes('settings.licenses.'), context + ': license translation missing');
            for (const notice of panel().querySelectorAll('.settings-license-notice')) {
                notice.querySelector('summary').click();
                check(notice.open && notice.querySelector('pre').textContent.trim(), context + ': license notice did not expand');
            }
            await frame();
        }
        if (section) {
            await navigateApiSection(section);
            checkApiNavigationLayout(context + ':' + section, section);
            if (section === 'providers') {
                checkProviderLayout(context + ':provider sources');
            }
        }
        checkSidebarMenuLayout(context + ':' + id);
        checkLabels(context + ':' + id);
        checkInlineFields(context + ':' + id);
        check(applyButton().disabled && applyButton().textContent.trim() === translate('settings.apply', selectedLanguage), context + ':' + id + ': unchanged settings have an active or incorrectly labelled Apply action');
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
        check(target === save || save.contains(target) || (save.disabled && footer.contains(target)), context + ':' + id + ': apply button is covered');
        measurements.push({ category: id, section, contentHeight: body.clientHeight, scrollHeight: body.scrollHeight });
        body.scrollTop = 0;
    }
    const longEntry = {
        path: '/fixture/' + 'LongLibraryPath'.repeat(16),
        alias: '긴 라이브러리 이름 '.repeat(24),
        group: '긴 그룹 이름 '.repeat(24),
    };
    const manyLibraries = [longEntry, ...Array.from({ length: 20 }, (_, index) => ({
        path: '/fixture/Library-' + index, alias: 'Library ' + index, group: index % 2 ? 'Archive' : '',
    }))];
    await open({ initialTab: 'folder', config: {
        ...baseline, font_scale: scale, language: selectedLanguage,
        libraries: manyLibraries.map(entry => entry.path), library_entries: manyLibraries,
    } });
    await selectPreview(longEntry.path);
    checkLibraryPreviewLayout(context + ':long labels');
    checkInlineFields(context + ':long library labels');
    const longBody = document.querySelector('.settings-modal-body');
    const longPreview = document.querySelector('.settings-library-preview');
    check(longBody.scrollWidth <= longBody.clientWidth + 1, context + ': long labels overflow the settings body');
    check(longPreview.scrollWidth <= longPreview.clientWidth + 1, context + ': long labels overflow the preview');
    check(longBody.scrollHeight > longBody.clientHeight, context + ': many libraries did not exercise body scrolling');
    await checkLibraryEditorLayout(context + ':many libraries');
    await open({ config: { ...baseline, font_scale: scale, language: selectedLanguage } });
    return { viewport: [innerWidth, innerHeight], scale, language: selectedLanguage, measurements };
}
render();
window.runDataFolderInteractions = runDataFolderInteractions;
window.settingsLayoutTests = { runInteractions, runApplyInteractions, prepareProviderKeyboardToggle, checkProviderKeyboardToggle, runProviderInteractions, runLibraryPreviewInteractions, runLibraryEditorTransitions, prepareLibraryPointerSelection, checkLibraryPointerSelection, prepareLibraryEditorResize, checkLibraryEditorLayout, runLayout, navigate, navigateApiSection, selectPreview };
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
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    console.log('SETTINGS_RENDER_STAGE=interactions');
    const dataFolder = await window.webContents.executeJavaScript('window.runDataFolderInteractions()');
    if (${Boolean(process.env.BOOKMANAGER_SETTINGS_SCREENSHOTS)}) {
        await window.webContents.executeJavaScript('document.querySelector(".settings-data-folder").scrollIntoView({ block: "center", behavior: "instant" }); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await fs.writeFile('/tmp/bookmanager-settings-data-folder.png', (await window.webContents.capturePage()).toPNG());
    }
    const interactions = await window.webContents.executeJavaScript('window.settingsLayoutTests.runInteractions()');
    const apply = await window.webContents.executeJavaScript('window.settingsLayoutTests.runApplyInteractions()');
    await window.webContents.executeJavaScript('window.settingsLayoutTests.prepareProviderKeyboardToggle()');
    window.webContents.focus();
    for (const [keyCode, enabled] of [['Space', false], ['Enter', true]]) {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        await window.webContents.executeJavaScript('window.settingsLayoutTests.checkProviderKeyboardToggle(' + enabled + ')');
    }
    const providers = await window.webContents.executeJavaScript('window.settingsLayoutTests.runProviderInteractions()');
    const libraryPreview = await window.webContents.executeJavaScript('window.settingsLayoutTests.runLibraryPreviewInteractions()');
    const editorTransitions = await window.webContents.executeJavaScript('window.settingsLayoutTests.runLibraryEditorTransitions()');
    const checkPointerSelections = async () => {
        const results = [];
        for (const [source, path] of [['list', '/fixture/Novels'], ['preview', '/fixture/Comics'], ['row', '/fixture/Books']]) {
            const point = await window.webContents.executeJavaScript('window.settingsLayoutTests.prepareLibraryPointerSelection(' + JSON.stringify(source) + ',' + JSON.stringify(path) + ')');
            window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
            window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
            window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
            results.push(await window.webContents.executeJavaScript('window.settingsLayoutTests.checkLibraryPointerSelection()'));
        }
        return results;
    };
    editorTransitions.pointerSelections = await checkPointerSelections();
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const editorReducedMotion = await window.webContents.executeJavaScript('window.settingsLayoutTests.runLibraryEditorTransitions(true)');
    editorReducedMotion.pointerSelections = await checkPointerSelections();
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await window.webContents.executeJavaScript('window.settingsLayoutTests.prepareLibraryEditorResize()');
    window.setContentSize(520, 650);
    await window.webContents.executeJavaScript('window.settingsLayoutTests.checkLibraryEditorLayout("editor resized to mobile")');
    window.setContentSize(1280, 900);
    await window.webContents.executeJavaScript('window.settingsLayoutTests.checkLibraryEditorLayout("editor resized to desktop")');
    console.log('SETTINGS_RENDER_STAGE=layouts');
    const layouts = [];
    for (const [width, height] of [[1280, 900], [708, 902], [520, 650]]) {
        window.setContentSize(width, height);
        for (const scale of [100, 155]) {
            layouts.push(await window.webContents.executeJavaScript('window.settingsLayoutTests.runLayout(' + scale + ')'));
            if (${Boolean(process.env.BOOKMANAGER_SETTINGS_SCREENSHOTS)}) {
                await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '.png', (await window.webContents.capturePage()).toPNG());
                if (width === 1280 && scale === 100) {
                    for (const category of ['processing', 'viewer', 'api', 'ttsApi', 'folder', 'licenses']) {
                        console.log('SETTINGS_RENDER_CAPTURE=' + width + ':' + category);
                        await window.webContents.executeJavaScript('window.settingsLayoutTests.navigate(' + JSON.stringify(category) + ')');
                        if (category === 'folder') {
                            await window.webContents.executeJavaScript('window.settingsLayoutTests.selectPreview("/fixture/Books")');
                        } else if (category === 'ttsApi') {
                            await window.webContents.executeJavaScript('document.getElementById("settings-secret-tts_openai_key").closest(".settings-control-field").scrollIntoView({ block: "center" })');
                        }
                        await new Promise(resolve => setTimeout(resolve, 75));
                        await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-' + category + '.png', (await window.webContents.capturePage()).toPNG());
                        if (category === 'api') {
                            await window.webContents.executeJavaScript('window.settingsLayoutTests.navigateApiSection("providers")');
                            await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-api-providers.png', (await window.webContents.capturePage()).toPNG());
                            await window.webContents.executeJavaScript('document.getElementById("settings-secret-google").closest(".settings-provider-card").scrollIntoView({ block: "center" }); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                            await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-api-provider-keys.png', (await window.webContents.capturePage()).toPNG());
                        }
                    }
                } else if (width <= 760 && scale === 100) {
                    await window.webContents.executeJavaScript('window.settingsLayoutTests.navigate("folder")');
                    await window.webContents.executeJavaScript('window.settingsLayoutTests.selectPreview("/fixture/Books")');
                    await new Promise(resolve => setTimeout(resolve, 75));
                    await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-folder.png', (await window.webContents.capturePage()).toPNG());
                }
                if (width <= 760 && scale === 100) {
                    await window.webContents.executeJavaScript('window.settingsLayoutTests.navigate("api")');
                    await window.webContents.executeJavaScript('window.settingsLayoutTests.navigateApiSection("providers")');
                    await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-api-providers.png', (await window.webContents.capturePage()).toPNG());
                    await window.webContents.executeJavaScript('document.getElementById("settings-secret-google").closest(".settings-provider-card").scrollIntoView({ block: "center" }); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                    await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-api-provider-keys.png', (await window.webContents.capturePage()).toPNG());
                }
                await window.webContents.executeJavaScript('window.settingsLayoutTests.navigate("licenses")');
                await window.webContents.executeJavaScript('document.querySelector(".settings-license-notice summary").click(); new Promise(resolve => requestAnimationFrame(resolve))');
                await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-' + scale + '-licenses-expanded.png', (await window.webContents.capturePage()).toPNG());
            }
        }
    }
    for (const language of ['en', 'ja']) {
        for (const [width, height] of [[1280, 900], [520, 650]]) {
            window.setContentSize(width, height);
            layouts.push(await window.webContents.executeJavaScript('window.settingsLayoutTests.runLayout(155, ' + JSON.stringify(language) + ')'));
            if (${Boolean(process.env.BOOKMANAGER_SETTINGS_SCREENSHOTS)}) {
                await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-155-' + language + '.png', (await window.webContents.capturePage()).toPNG());
                if (language === 'en' && width === 520) {
                    for (const category of ['viewer', 'ttsApi']) {
                        await window.webContents.executeJavaScript('window.settingsLayoutTests.navigate(' + JSON.stringify(category) + ')');
                        const controlId = category === 'viewer' ? 'settings-viewer-comic' : 'settings-secret-tts_openai_key';
                        await window.webContents.executeJavaScript('document.getElementById(' + JSON.stringify(controlId) + ').closest(".settings-control-field").scrollIntoView({ block: "center" }); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                        await fs.writeFile('/tmp/bookmanager-settings-' + width + '-' + height + '-155-' + language + '-' + category + '.png', (await window.webContents.capturePage()).toPNG());
                    }
                }
            }
        }
    }
    console.log('SETTINGS_LAYOUT_RESULT=' + JSON.stringify({ dataFolder, interactions, apply, providers, libraryPreview, editorTransitions, editorReducedMotion, layouts }));
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
        assert.deepEqual(report.dataFolder, { pathVisible: true, selectable: true, opened: true, failures: true, retry: true, settingsUnchanged: true });
        assert.equal(report.interactions.categories, 8);
        assert.equal(report.interactions.apiSections, 5);
        assert.equal(report.interactions.manualFocusChecks, 4);
        assert.deepEqual(report.apply, { initialClean: true, uiOnlyClean: true, revertedClean: true, duplicateBlocked: true, pendingEditsRetained: true, languageRetained: true, retry: true, fileAssociationGuards: true, partialBaseline: true });
        assert.deepEqual(report.providers, { sources: 19, persisted: true, cancelled: true, retainedValues: true, fallback: true, allDisabled: true, keyboardActivations: 2 });
        assert.deepEqual(report.libraryPreview, { mutations: 13, dragAndDrop: 7, draftIsolation: true, saved: true, cancelled: true, empty: true });
        assert.deepEqual(report.editorTransitions, {
            preparesClosedFrame: true, slidesOpen: true, slidesClosed: true, retainsNodeOnSelection: true, rapidReopen: true, cancelsPendingEntry: true,
            pointerSelections: ['list', 'preview', 'row'].map(source => ({ source, trustedPointer: true, retainsOpenEditor: true })),
        });
        assert.deepEqual(report.editorReducedMotion, {
            opensImmediately: true, closesImmediately: true, retainsNodeOnSelection: true, restoresFocus: true,
            pointerSelections: ['list', 'preview', 'row'].map(source => ({ source, trustedPointer: true, retainsOpenEditor: true })),
        });
        assert.equal(report.layouts.length, 10);
        assert.ok(report.layouts.every(layout => layout.measurements.length === 12));
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
