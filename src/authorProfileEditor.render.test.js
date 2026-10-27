import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('저자 프로필 모달은 실제 폴더 테마, 진입 탭, 사진 편집, 포커스와 좁은 화면 배치를 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'author-profile-editor-render-'));
    try {
        await build({
            stdin: { loader: 'jsx', resolveDir: projectRoot, contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthorsBrowser } from './src/components/folder/AuthorsBrowser.jsx';
import { normalizeAuthorProfile } from './src/authorCatalog.js';
import { applyMotionPreference } from './src/motionPolicy.js';
import './src/styles/global.css';
import './src/styles/FolderTab.css';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
const capture = async name => { await pause(80); await window.captureAuthorEditor(name); };
async function until(predicate, message) {
    const deadline = performance.now() + 7000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await pause(20);
    }
    throw new Error(message);
}
const button = (text, root = document) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text);
const click = node => { check(node && !node.disabled, 'Expected an enabled button'); node.focus(); node.click(); };
const escape = () => window.pressAuthorEscape();
const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const dialog = () => document.querySelector('dialog.author-editor-dialog');
const hover = async node => {
    const bounds = node.getBoundingClientRect();
    await window.moveAuthorPointer(Math.round(bounds.left + bounds.width / 2), Math.round(bounds.top + bounds.height / 2));
};
const changeValue = (node, value) => {
    const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};
const canvas = document.createElement('canvas');
canvas.width = 120; canvas.height = 160;
const context = canvas.getContext('2d');
context.fillStyle = '#304b61'; context.fillRect(0, 0, 120, 160);
context.fillStyle = '#d6b395'; context.beginPath(); context.ellipse(60, 58, 28, 35, 0, 0, 2 * Math.PI); context.fill();
context.fillStyle = '#748e83'; context.beginPath(); context.ellipse(60, 150, 48, 50, 0, 0, 2 * Math.PI); context.fill();
const dataUrl = canvas.toDataURL('image/png');
const original = normalizeAuthorProfile({
    provider: 'wikidata', id: 'Q101', name: '가쇼 쇼지', description: '일본의 소설가', birthDate: '1971',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.png',
    storedPhoto: { id: 'a'.repeat(64), sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.png' },
});
const profiles = [
    { provider: 'wikidata', id: 'Q102', name: '가쇼 쇼지', birthDate: '1971', description: '소설가', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.png', imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Portrait.png', imageArtist: 'Fixture artist', imageLicense: 'CC BY 4.0' },
    { provider: 'wikipedia', id: 'wikipedia:ja:103', name: '가쇼 쇼지', description: '작가', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.png' },
    { provider: 'openlibrary', id: 'OL104A', name: '가쇼 쇼지', topWork: '대표 작품' },
];
let currentProfile = original;
let status = 'ready';
let snapshot = 0;
const listeners = new Set();
const saves = [];
const searches = [];
const imported = [];
let importGate = null;
let failedSources = [];
let sourceProfiles = null;
const notify = () => { snapshot += 1; for (const listener of listeners) listener(); };
const store = {
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    getProfile: () => currentProfile,
    getStatus: () => status,
    hasOverride: () => true,
    setAuthors() {},
    saveManual: async (key, profile) => { saves.push(profile); currentProfile = profile; status = profile ? 'ready' : 'initials'; notify(); return true; },
    useAutomatic: () => true,
};
window.electronAPI = {
    searchAuthorProfiles: async (query, options) => { searches.push({ source: 'profiles', query, options }); return { success: true, profiles: sourceProfiles || profiles, partial: failedSources.length > 0, failedSources }; },
    searchAuthorPhotos: async value => { searches.push({ source: 'naver', ...value }); return { success: true, results: [{ id: 'naver-candidate', title: '가쇼 쇼지 사진' }], hasNext: false }; },
    previewAuthorPhoto: async () => ({ success: true, dataUrl }),
    selectAuthorPhoto: async () => ({ success: true, dataUrl, photo: { id: 'b'.repeat(64), sourceUrl: 'https://example.com/portrait.png', query: '가쇼 쇼지' } }),
    saveAuthorProfilePhoto: async profile => ({ success: true, dataUrl, photo: { id: 'c'.repeat(64), source: profile.provider, query: profile.name, sourceUrl: profile.photoUrl, imageSourceUrl: profile.imageSourceUrl } }),
    importAuthorPhoto: async value => { imported.push(value); if (importGate) await importGate; return { success: true, dataUrl: value.dataUrl, photo: { ...value.photo, id: 'd'.repeat(64), source: value.photo ? value.photo.source : 'local' } }; },
    previewCoverEditorImportedImage: async () => ({ dataUrl, width: 120, height: 160 }),
    releaseAuthorPhotos: async () => ({ success: true }),
    releaseCoverEditorImages: async () => ({}),
};
const files = [{ path: '/fixture/book.epub', name: '풀 메탈 패닉', title: '풀 메탈 패닉', writer: '가쇼 쇼지', readingListAddedAt: '2026-06-14T12:00:00Z' }];
const root = createRoot(document.getElementById('root'));
const assertContained = node => {
    const bounds = node.getBoundingClientRect();
    check(bounds.left >= -1 && bounds.right <= innerWidth + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1, 'The modal must fit inside the viewport');
    check(Math.abs(bounds.left + bounds.right - innerWidth) < 2 && Math.abs(bounds.top + bounds.bottom - innerHeight) < 2, 'The modal must remain centered with the global style reset');
    check(node.scrollWidth <= node.clientWidth + 1, 'The modal must not overflow horizontally');
};
const assertTheme = node => {
    const folder = document.querySelector('.folder-tab');
    const folderStyle = getComputedStyle(folder);
    const style = getComputedStyle(node);
    const resolvedColor = property => {
        const probe = document.createElement('span');
        probe.style.color = 'var(' + property + ')';
        folder.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    };
    check(style.backgroundColor === resolvedColor('--panel-bg'), 'The modal must inherit the real folder surface instead of becoming transparent');
    check(style.borderTopStyle === 'solid' && style.borderTopWidth === '1px' && style.borderTopColor === resolvedColor('--line'), 'The modal border must use the folder theme');
    check(style.color === resolvedColor('--text'), 'The modal text must use the folder theme');
    check(style.fontFamily === folderStyle.fontFamily && style.fontSize === folderStyle.fontSize, 'The modal must preserve the app font and text size');
    const input = node.querySelector('.author-editor-search input');
    check(getComputedStyle(input).backgroundColor === resolvedColor('--panel-bg-2'), 'The search input needs an opaque themed background');
    check(getComputedStyle(node.querySelector('[role="tab"][aria-selected="true"]')).color === resolvedColor('--accent'), 'The active tab must keep the folder accent');
    check(getComputedStyle(node.querySelector('.author-editor-footer .primary')).backgroundColor === resolvedColor('--accent'), 'The apply button must keep the folder accent');
};
window.runProfileEditorTests = async () => {
    applyMotionPreference('reduced');
    root.render(<AuthorsBrowser files={files} language="ko" t={key => key} profileStore={store} />);
    await until(() => document.querySelector('.author-card'), 'The author card should render');
    click(document.querySelector('.author-card'));
    await until(() => document.querySelector('.author-profile'), 'Author details should open');
    const portrait = () => document.querySelector('.author-profile-portrait');
    const before = portrait().getBoundingClientRect();
    const headingBefore = document.querySelector('.author-profile-info').getBoundingClientRect();
    status = 'loading'; notify();
    await until(() => portrait().dataset.photoStatus === 'loading', 'Photo loading status should render');
    const during = portrait().getBoundingClientRect();
    check(before.width === during.width && before.height === during.height, 'Loading must keep portrait dimensions fixed');
    check(headingBefore.left === document.querySelector('.author-profile-info').getBoundingClientRect().left, 'Loading must not move profile information');
    const statusBounds = portrait().querySelector('.author-photo-status').getBoundingClientRect();
    check(statusBounds.left >= during.left && statusBounds.right <= during.right + 1, 'Loading status must stay within the portrait');
    status = 'ready'; notify();
    applyMotionPreference('full');
    await window.moveAuthorPointer(2, innerHeight - 2);
    await until(() => Number(getComputedStyle(document.querySelector('.author-profile-hover-actions')).opacity) < 0.01, 'Profile controls should be hidden before hover');
    await hover(document.querySelector('.author-profile-info'));
    await until(() => Number(getComputedStyle(document.querySelector('.author-profile-hover-actions')).opacity) > 0.99, 'Hovering the profile card should fade its controls in');
    await hover(document.querySelector('.author-portrait-button'));
    await until(() => Number(getComputedStyle(document.querySelector('.author-photo-change')).opacity) > 0.99, 'Hovering the portrait should reveal the camera overlay');
    await capture('hover');
    applyMotionPreference('reduced');
    await until(() => button('프로필 변경'), 'Profile change control should exist');
    const profileTrigger = button('프로필 변경');
    click(profileTrigger);
    await until(() => dialog()?.open && selectedTab() === '프로필 찾기', 'Profile control should open the profile search tab');
    check([...dialog().querySelectorAll('[role="tab"]')].map(node => node.textContent).join('|') === '프로필 찾기|프로필 사진 찾기|프로필 사진 업로드', 'The modal should expose the three requested tabs');
    assertContained(dialog());
    assertTheme(dialog());
    const profileSource = dialog().querySelector('select[aria-label="검색 소스"]');
    const addedSourceLabels = { aladin: '알라딘', kyobo: '교보문고', cartoon: '한국만화가협회', kmas: '한국웹툰' };
    for (const [value, label] of Object.entries(addedSourceLabels)) {
        check([...profileSource.options].some(option => option.value === value && option.textContent === label), 'Profile search must offer ' + label);
    }
    changeValue(profileSource, 'kyobo');
    await until(() => profileSource.value === 'kyobo', 'The selected profile source should change');
    click(button('검색', dialog()));
    await until(() => searches.at(-1)?.options?.source === 'kyobo' && !button('검색', dialog()).disabled, 'Profile search must request the selected source');
    check(searches.length === 1 && searches[0].source === 'profiles', 'A profile-source search must not call Naver photo search');
    changeValue(profileSource, 'all');
    await until(() => profileSource.value === 'all', 'All profile sources should be selectable');
    failedSources = [{ source: 'kmas', code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' }];
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 3, 'Profile search should show every profile source');
    check(searches.at(-1).options?.allSources === true && searches.at(-1).options?.source === 'all', 'Manual profile search should request all existing sources');
    check(dialog().querySelector('[role="status"]')?.textContent.includes('한국웹툰'), 'A partial failure must name the unavailable source while keeping successful results');
    failedSources = [];
    click(dialog().querySelector('.author-editor-result'));
    check(saves.length === 0, 'Selecting a result should preview it before saving');
    await capture('profile');
    click(button('이 프로필 선택', dialog()));
    await until(() => !dialog(), 'Applying a profile should close the modal');
    check(saves[0].id === 'Q102', 'The selected profile should be saved');
    check(document.activeElement === profileTrigger, 'Closing after applying should restore the profile trigger focus');
    const cornerTrigger = button('프로필 수정');
    click(cornerTrigger);
    await until(() => dialog()?.open && selectedTab() === '프로필 찾기', 'The corner edit button should open profile search');
    await escape();
    await until(() => !dialog(), 'The corner edit dialog should close');
    check(document.activeElement === cornerTrigger, 'Closing should restore the corner edit button focus');
    const photoTrigger = button('사진 변경');
    click(photoTrigger);
    await until(() => dialog()?.open && selectedTab() === '프로필 사진 찾기', 'Photo overlay should open photo search');
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length >= 4, 'Photo search should include Naver and all profile photo sources');
    const source = dialog().querySelector('select[aria-label="검색 소스"]');
    check(['all', 'naver', 'wikidata', 'wikipedia', 'openlibrary', 'aladin', 'kyobo', 'cartoon', 'kmas'].every(value => [...source.options].some(option => option.value === value)), 'Photo search should allow choosing each source');
    changeValue(source, 'naver');
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 0, 'Changing the source should reset old results');
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 1, 'A Naver source search should display its own result');
    click(dialog().querySelector('.author-editor-result'));
    await until(() => button('이 사진 사용', dialog()) && !button('이 사진 사용', dialog()).disabled, 'A selected photo should become available for applying');
    click(button('이 사진 사용', dialog()));
    await until(() => !dialog(), 'Applying a photo should close the modal');
    check(saves.at(-1).id === 'Q102' && saves.at(-1).photoOverride?.id === 'b'.repeat(64), 'Changing a photo must preserve the selected profile information');
    click(photoTrigger);
    await until(() => dialog()?.open, 'Photo search should reopen');
    click(button('프로필 사진 업로드', dialog()));
    await until(() => selectedTab() === '프로필 사진 업로드', 'Upload tab should activate');
    const fileInput = dialog().querySelector('input[type="file"]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await (await fetch(dataUrl)).blob()], 'portrait.png', { type: 'image/png' }));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => button('사진 편집', dialog()) && !button('사진 편집', dialog()).disabled, 'Uploaded photo should be ready for editing');
    click(button('사진 편집', dialog()));
    await until(() => document.querySelector('.ee-image-edit-dialog[open] .ee-image-edit-footer .ee-primary:not(:disabled)'), 'The shared cover image editor should open and render the upload');
    check(document.querySelector('.ee-image-edit-dialog').contains(document.activeElement), 'Focus should enter the nested image editor');
    await until(() => document.querySelector('.ee-image-edit-picture img')?.naturalWidth > 0, 'The image editor preview should decode before inspection');
    await capture('editor');
    click(button('1:1', document.querySelector('.ee-image-edit-dialog')));
    await until(() => document.querySelector('.ee-image-edit-dialog').textContent.includes('120 × 120'), 'Square cropping should update the output dimensions');
    click(document.querySelector('.ee-image-edit-footer .ee-primary'));
    await until(() => !document.querySelector('.ee-image-edit-dialog'), 'Applying image edits should return to the profile modal');
    check(dialog().contains(document.activeElement), 'Image editor focus should return to the profile modal');
    await capture('upload');
    let finishImport;
    importGate = new Promise(resolve => { finishImport = resolve; });
    click(button('이 사진 사용', dialog()));
    await until(() => imported.length === 2, 'Saving edited pixels should wait for the photo importer');
    currentProfile = { ...currentProfile, description: '저장 중 갱신된 작가 소개' }; notify();
    await until(() => document.querySelector('.author-profile-description').textContent === '저장 중 갱신된 작가 소개', 'New profile information should render during photo import');
    importGate = null; finishImport();
    await until(() => !dialog(), 'Applying an upload should close the profile modal');
    check(imported.length > 0 && imported.at(-1).dataUrl.startsWith('data:image/'), 'An edited upload should be passed to the photo importer');
    const editedBitmap = await createImageBitmap(await (await fetch(imported.at(-1).dataUrl)).blob());
    check(editedBitmap.width === 120 && editedBitmap.height === 120 && imported.at(-1).dataUrl !== dataUrl, 'Applying an image crop should save the cropped pixels');
    editedBitmap.close();
    check(saves.at(-1).id === 'Q102' && saves.at(-1).photoOverride?.source === 'local', 'An uploaded photo should retain the profile identity and local provenance');
    check(saves.at(-1).description === '저장 중 갱신된 작가 소개', 'Finishing photo import must preserve profile information updated while saving');
    click(photoTrigger);
    await until(() => dialog()?.open, 'Photo search should reopen for focus testing');
    const focusables = [...dialog().querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(node => node.getClientRects().length);
    focusables.at(-1).focus();
    focusables.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    check(dialog().contains(document.activeElement), 'Tab should remain within the modal');
    await escape();
    await until(() => !dialog(), 'Escape should close the profile modal');
    check(document.activeElement === photoTrigger, 'Escape should restore focus to the photo trigger');
    await window.resizeAuthorEditor(480, 660);
    await pause(50);
    status = 'loading'; notify();
    await until(() => portrait().dataset.photoStatus === 'loading', 'Narrow layout should show loading');
    const narrow = portrait().getBoundingClientRect();
    check(narrow.width > 0 && narrow.right <= innerWidth, 'Narrow portrait must stay visible');
    check(document.querySelector('.authors-browser').scrollWidth <= document.querySelector('.authors-browser').clientWidth + 1, 'Loading must not introduce horizontal page overflow');
    await capture('narrow');
    click(button('프로필 변경'));
    await until(() => dialog()?.open, 'The profile modal should open at narrow width');
    assertContained(dialog());
    assertTheme(dialog());
    await capture('narrow-modal');
    await escape();
    await until(() => !dialog(), 'The narrow modal should close');
    sourceProfiles = [
        { provider: 'aladin', id: 'aladin:49154', name: '한강', description: '작가 소개',
            sourceUrl: 'https://www.aladin.co.kr/author/wauthor_overview.aspx?AuthorSearch=@49154',
            photoUrl: 'https://image.aladin.co.kr/Author/Photo/49154/49154_2.jpg',
            imageSourceUrl: 'https://www.aladin.co.kr/author/wauthor_overview.aspx?AuthorSearch=@49154' },
        { provider: 'kyobo', id: 'kyobo:1000646901', name: '한강', birthDate: '1970-11-27',
            sourceUrl: 'https://store.kyobobook.co.kr/person/detail/1000646901',
            photoUrl: 'https://contents.kyobobook.co.kr/sih/fit-in/300x0/dtl/author/1000646901.jpg?t=2988445',
            imageSourceUrl: 'https://store.kyobobook.co.kr/person/detail/1000646901' },
        { provider: 'cartoon', id: 'cartoon:556493ac05911d93a9a659596fb3032975407d754e976478334691b43cb68592', name: '허영만', topWork: '식객',
            sourceUrl: 'https://www.cartoon.or.kr/all-member', photoUrl: '', imageSourceUrl: '' },
        { provider: 'kmas', id: 'kmas:0000042604', name: '허영만', birthDate: '1947-08-12',
            sourceUrl: 'https://www.kmas.or.kr/archive/writrList/detail/0000042604',
            photoUrl: 'https://www.kmas.or.kr/common/file/atchmnflDownload.ajax?fileImageId=cd2302ca-686d-42a8-85fd-22b071fb82d8',
            imageSourceUrl: 'https://www.kmas.or.kr/archive/writrList/detail/0000042604' },
    ];
    click(button('프로필 변경'));
    await until(() => dialog()?.open, 'Profile search should open for added sources');
    for (const provider of ['kyobo', 'cartoon', 'kmas']) {
        changeValue(dialog().querySelector('select[aria-label="검색 소스"]'), provider);
        await pause(0);
        click(button('검색', dialog()));
        await until(() => dialog().querySelectorAll('.author-editor-result').length === 1, 'The selected new source should provide its profile');
        check(searches.at(-1).options?.source === provider, 'The selected provider must reach the profile request');
        click(dialog().querySelector('.author-editor-result'));
        await until(() => dialog().querySelector('.author-editor-profile-summary a')?.textContent.includes(addedSourceLabels[provider]), 'Profile preview should identify the new source');
        if (provider === 'cartoon') check(!dialog().querySelector('.author-editor-profile-summary img'), 'A source without an author photo must keep initials');
    }
    changeValue(dialog().querySelector('select[aria-label="검색 소스"]'), 'aladin');
    await pause(0);
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 1, 'An Aladin search should show its profile');
    click(dialog().querySelector('.author-editor-result'));
    await until(() => dialog().querySelector('.author-editor-profile-summary a')?.textContent.includes('알라딘'), 'The selected profile should identify Aladin as its source');
    click(button('이 프로필 선택', dialog()));
    await until(() => !dialog(), 'The added-source profile should apply');
    check(saves.at(-1).id === 'aladin:49154' && document.querySelector('.author-profile-meta a')?.textContent.includes('알라딘'), 'The detail page must keep the added profile source');
    click(photoTrigger);
    await until(() => dialog()?.open, 'Photo search should open for added sources');
    changeValue(dialog().querySelector('select[aria-label="검색 소스"]'), 'cartoon');
    await pause(0);
    click(button('검색', dialog()));
    await until(() => !button('검색', dialog()).disabled, 'A photo search without portraits should finish');
    check(dialog().querySelectorAll('.author-editor-result').length === 0, 'Profile sources without a portrait must not offer a book cover as a photo');
    changeValue(dialog().querySelector('select[aria-label="검색 소스"]'), 'kmas');
    await pause(0);
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 1, 'Korean Webtoons should contribute profile photos');
    check(searches.at(-1).options?.source === 'kmas', 'Photo search must request the selected profile source');
    click(dialog().querySelector('.author-editor-result'));
    await until(() => !button('이 사진 사용', dialog()).disabled, 'The added-source photo should be ready to apply');
    click(button('이 사진 사용', dialog()));
    await until(() => !dialog(), 'The added-source photo should apply');
    check(saves.at(-1).id === 'aladin:49154' && saves.at(-1).photoOverride?.source === 'kmas', 'Using a new-source photo must preserve the selected profile identity');
    check(saves.at(-1).imageSourceUrl === sourceProfiles.find(profile => profile.provider === 'kmas').sourceUrl, 'The added-source photo attribution must remain attached to the photo');
    root.unmount();
    return { tabs: true, profileSearch: true, photoSources: true, preservedProfile: true, editedUpload: true, focusRestored: true, narrowLayout: true, stableLoading: true };
};
` },
            bundle: true, format: 'esm', outfile: path.join(directory, 'renderer.js'),
            loader: { '.ttf': 'file', '.png': 'file' }, logLevel: 'silent',
        });
        await build({ entryPoints: [path.join(projectRoot, 'src/features/fileTools/epubEditor/imageEditing.worker.js')], bundle: true,
            format: 'esm', outfile: path.join(directory, 'imageEditing.worker.js'), logLevel: 'silent' });
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{margin:0;height:100%;overflow:hidden}.app-container{--font-primary:"Noto Sans KR",sans-serif;--font-sm:14px}</style></head><body><div class="app-container"><div id="root" class="folder-tab"></div></div><script type="module" src="renderer.js"></script></body></html>');
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('captureAuthorEditor', kind => ipcRenderer.invoke('capture-author-editor', kind));
contextBridge.exposeInMainWorld('resizeAuthorEditor', (width, height) => ipcRenderer.invoke('resize-author-editor', width, height));
contextBridge.exposeInMainWorld('moveAuthorPointer', (x, y) => ipcRenderer.invoke('move-author-pointer', x, y));
contextBridge.exposeInMainWorld('pressAuthorEscape', () => ipcRenderer.invoke('press-author-escape'));
`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-thumbnail', privileges: { standard: true, secure: true } }]);
app.whenReady().then(async () => {
    const png = nativeImage.createFromBitmap(Buffer.from([97, 75, 48, 255]), { width: 1, height: 1 }).toPNG();
    for (const scheme of ['bookmanager-thumbnail', 'https']) protocol.handle(scheme, () => new Response(png, { headers: { 'content-type': 'image/png' } }));
    protocol.handle('http', () => new Response(null, { status: 403 }));
    const window = new BrowserWindow({ show: false, width: 1100, height: 820, useContentSize: true, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))} } });
    ipcMain.handle('capture-author-editor', async (_event, kind) => {
        const screenshotDirectory = process.env.BOOKMANAGER_AUTHOR_EDITOR_SCREENSHOTS;
        if (screenshotDirectory) {
            await fs.mkdir(screenshotDirectory, { recursive: true });
            await fs.writeFile(path.join(screenshotDirectory, kind + '.png'), (await window.webContents.capturePage()).toPNG());
        }
    });
    ipcMain.handle('resize-author-editor', (_event, width, height) => window.setContentSize(width, height));
    ipcMain.handle('move-author-pointer', (_event, x, y) => window.webContents.sendInputEvent({ type: 'mouseMove', x, y }));
    ipcMain.handle('press-author-escape', () => { window.webContents.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
    const result = await window.webContents.executeJavaScript('window.runProfileEditorTests()');
    console.log('AUTHOR_EDITOR_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Author profile editor renderer timed out: ' + result)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/AUTHOR_EDITOR_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), { tabs: true, profileSearch: true, photoSources: true, preservedProfile: true, editedUpload: true, focusRestored: true, narrowLayout: true, stableLoading: true });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
