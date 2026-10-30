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
const click = node => { check(node && !node.disabled, 'Expected an enabled button: ' + (node?.textContent || 'missing')); node.focus(); node.click(); };
const escape = () => window.pressAuthorEscape();
const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const dialog = () => document.querySelector('dialog.author-editor-dialog');
const hover = async node => {
    const bounds = node.getBoundingClientRect();
    await window.moveAuthorPointer(Math.round(bounds.left + bounds.width / 2), Math.round(bounds.top + bounds.height / 2));
};
const changeValue = (node, value) => {
    const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
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
const thumbnailCanvas = document.createElement('canvas');
thumbnailCanvas.width = 1200; thumbnailCanvas.height = 1600;
thumbnailCanvas.getContext('2d').drawImage(canvas, 0, 0, 1200, 1600);
const thumbnailDataUrl = thumbnailCanvas.toDataURL('image/png');
const original = normalizeAuthorProfile({
    provider: 'wikidata', id: 'Q101', name: '가쇼 쇼지', description: '일본의 소설가', birthDate: '1971',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.png',
    storedPhoto: { id: 'a'.repeat(64), sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.png' },
    imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Portrait.png', imageArtist: 'Original photographer', imageLicense: 'CC BY-SA 4.0',
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
const previewImports = [];
const releasedImages = [];
const confirmations = [];
const profilePhotoSaves = [];
const webSearches = [];
let webSearchResult = { cancelled: true };
let confirmationChoice = 'yes';
let confirmationGate = null;
let failPreservedPhoto = false;
let importGate = null;
let previewImportGate = null;
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
    openAuthorWebSearch: async request => { webSearches.push(request); return webSearchResult; },
    cancelAuthorWebSearch: async () => ({ success: true }),
    showMessage: async options => { await pause(20); confirmations.push(options); if (confirmationGate) await confirmationGate; return confirmationChoice; },
    searchAuthorProfiles: async (query, options) => { searches.push({ source: 'profiles', query, options }); return { success: true, profiles: sourceProfiles || profiles, partial: failedSources.length > 0, failedSources }; },
    searchAuthorPhotos: async value => {
        searches.push({ source: 'naver', ...value });
        const start = value.start || 1;
        return { success: true, results: Array.from({ length: 20 }, (_, index) => ({
            id: 'naver-candidate-' + (start + index),
            title: '가쇼 쇼지 작가의 프로필 사진과 긴 설명이 함께 표시되는 검색 결과 ' + (start + index),
        })), hasNext: start < 41, nextStart: start < 41 ? start + 20 : null };
    },
    previewAuthorPhoto: async () => ({ success: true, dataUrl: thumbnailDataUrl }),
    selectAuthorPhoto: async () => ({ success: true, dataUrl, photo: { id: 'b'.repeat(64), sourceUrl: 'https://example.com/portrait.png', query: '가쇼 쇼지' } }),
    saveAuthorProfilePhoto: async profile => {
        profilePhotoSaves.push(profile);
        if (failPreservedPhoto) return { success: false, code: 'AUTHOR_PHOTO_STORAGE_FAILED' };
        return { success: true, dataUrl, photo: { id: 'c'.repeat(64), source: profile.provider, query: profile.name,
            sourceUrl: profile.storedPhoto?.sourceUrl || profile.photoUrl, imageSourceUrl: profile.imageSourceUrl, imageArtist: profile.imageArtist, imageLicense: profile.imageLicense } };
    },
    importAuthorPhoto: async value => { imported.push(value); if (importGate) await importGate; return { success: true, dataUrl: value.dataUrl, photo: { ...value.photo, id: 'd'.repeat(64), source: value.photo ? value.photo.source : 'local' } }; },
    previewCoverEditorImportedImage: async value => {
        if (!value.url) return { dataUrl, width: 120, height: 160 };
        const imagePath = '/fixture/web-drop-' + (previewImports.length + 1) + '.png';
        previewImports.push({ ...value, imagePath });
        if (previewImportGate) await previewImportGate;
        if (value.url === 'https://images.example.test/unavailable.png') return { error: 'Image download failed', code: 'COVER_EDITOR_IMAGE_IMPORT_FAILED' };
        return { dataUrl, width: 120, height: 160, imagePath };
    },
    releaseAuthorPhotos: async () => ({ success: true }),
    releaseCoverEditorImages: async value => { releasedImages.push(value); return {}; },
};
const files = [{ path: '/fixture/book.epub', name: '풀 메탈 패닉', title: '풀 메탈 패닉', writer: '가쇼 쇼지', readingListAddedAt: '2026-06-14T12:00:00Z' }];
const root = createRoot(document.getElementById('root'));
const assertContained = node => {
    const bounds = node.getBoundingClientRect();
    check(bounds.left >= -1 && bounds.right <= innerWidth + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1, 'The modal must fit inside the viewport');
    check(Math.abs(bounds.left + bounds.right - innerWidth) < 2 && Math.abs(bounds.top + bounds.bottom - innerHeight) < 2, 'The modal must remain centered with the global style reset');
    check(node.scrollWidth <= node.clientWidth + 1, 'The modal must not overflow horizontally');
};
const assertGalleryContents = () => {
    const gallery = dialog().querySelector('.author-editor-results.is-gallery');
    const cards = [...gallery.querySelectorAll('.author-editor-result')];
    const bounds = cards.map(card => card.getBoundingClientRect());
    for (const [index, card] of cards.entries()) {
        const image = card.querySelector('.author-editor-result-image').getBoundingClientRect();
        const caption = card.querySelector(':scope > span:not(.author-editor-result-image)').getBoundingClientRect();
        const outer = bounds[index];
        check(image.bottom <= caption.top + 1, 'Gallery image and caption must not overlap at card ' + index);
        for (const [name, child] of [['image', image], ['caption', caption]]) {
            check(child.top >= outer.top - 1 && child.bottom <= outer.bottom + 1 && child.left >= outer.left - 1 && child.right <= outer.right + 1,
                'Gallery card must contain its ' + name + ': ' + JSON.stringify({ index, cardHeight: outer.height, cardTop: outer.top, cardBottom: outer.bottom, childTop: child.top, childBottom: child.bottom }));
        }
        for (let next = index + 1; next < bounds.length; next += 1) {
            const other = bounds[next];
            check(outer.right <= other.left + 1 || other.right <= outer.left + 1 || outer.bottom <= other.top + 1 || other.bottom <= outer.top + 1,
                'Gallery cards must not overlap across rows');
        }
    }
    if (cards.length >= 20) check(new Set(bounds.map(rectangle => Math.round(rectangle.top))).size > 1, 'The fixture must exercise multiple gallery rows');
    const more = gallery.querySelector('.author-editor-more');
    if (more) check(more.getBoundingClientRect().top >= Math.max(...bounds.map(rectangle => rectangle.bottom)) - 1,
        'More photos must appear after the last complete gallery row');
};
const assertPhotoLayout = (upload = false) => {
    const body = dialog().querySelector('.author-editor-body');
    const preview = body.querySelector('.author-editor-preview');
    const content = body.querySelector(upload ? '.author-editor-upload' : '.author-editor-results');
    const previewBounds = preview.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    check(body.firstElementChild === preview && previewBounds.right <= contentBounds.left + 1,
        'Photo preview must appear before the search or upload area in both reading and visual order');
    check(Math.abs(previewBounds.width - 250) < 1, 'The photo preview column must remain 250 pixels wide');
    const previewStyle = getComputedStyle(preview);
    check(previewStyle.alignItems === 'center' && previewStyle.textAlign === 'center', 'Photo preview contents must be horizontally centered');
    for (const node of preview.querySelectorAll('.author-editor-photo-stage, .author-editor-photo-caption, .author-editor-credit, .author-editor-edit')) {
        const bounds = node.getBoundingClientRect();
        if (bounds.width) check(Math.abs((bounds.left + bounds.right) / 2 - (previewBounds.left + preview.clientLeft + preview.clientWidth / 2)) < 1.5,
            'Photo preview items must align with the center of the preview column');
    }
    const editButton = preview.querySelector('.author-editor-edit');
    if (editButton) check(Math.abs(editButton.getBoundingClientRect().width - (preview.clientWidth - parseFloat(previewStyle.paddingLeft) - parseFloat(previewStyle.paddingRight))) < 1,
        'The photo edit button must span the full preview content width');
    for (const node of [body, preview, content]) check(node.scrollWidth <= node.clientWidth + 1, 'Photo panels must not overflow horizontally');
    if (!upload) {
        check(content.classList.contains('is-gallery') && getComputedStyle(content).display === 'grid', 'Photo search results must use a gallery grid');
        for (const thumb of content.querySelectorAll('.author-editor-result-image')) {
            const bounds = thumb.getBoundingClientRect();
            check(Math.abs(bounds.width - bounds.height) < 1 && getComputedStyle(thumb).borderRadius === '50%',
                'Photo gallery thumbnails must be square circles');
        }
    }
    assertContained(dialog());
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
    check(button('이 프로필 편집', dialog())?.disabled, 'Editing a search result must require a selected profile');
    check(button('이 프로필 편집', dialog()).nextElementSibling === button('이 프로필 선택', dialog()),
        'Edit this profile must appear immediately before Use this profile');
    check([...dialog().querySelectorAll('[role="tab"]')].map(node => node.textContent).join('|') === '프로필 편집|프로필 찾기|프로필 사진 찾기|프로필 사진 업로드', 'The modal should expose profile editing before the three existing tabs');
    for (const [key, expected] of [['Home', '프로필 편집'], ['End', '프로필 사진 업로드'], ['ArrowRight', '프로필 편집'],
        ['ArrowLeft', '프로필 사진 업로드'], ['ArrowLeft', '프로필 사진 찾기'], ['ArrowLeft', '프로필 찾기']]) {
        dialog().querySelector('[role="tab"][aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await until(() => selectedTab() === expected && document.activeElement === button(expected, dialog()),
            'Tab keyboard navigation must select and focus ' + expected + ' after ' + key);
    }
    assertContained(dialog());
    assertTheme(dialog());
    check(dialog().querySelector('.author-editor-results').getBoundingClientRect().right
        <= dialog().querySelector('.author-editor-preview').getBoundingClientRect().left + 1,
        'Profile search must keep its preview to the right of the results');
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
    for (const choice of ['cancel', undefined]) {
        confirmationChoice = choice;
        const previousConfirmations = confirmations.length;
        click(button('이 프로필 선택', dialog()));
        await until(() => confirmations.length === previousConfirmations + 1 && button('이 프로필 선택', dialog()) && !button('이 프로필 선택', dialog()).disabled, 'Cancelling photo confirmation must allow another attempt');
        check(dialog()?.open && saves.length === 0 && currentProfile.id === original.id, 'Cancelling photo confirmation must keep the profile, photo and search result');
        check(dialog().contains(document.activeElement), 'Confirmation cancellation must retain focus in the profile modal');
        check(confirmations.at(-1).type === 'question' && confirmations.at(-1).buttons === 'yes-no-cancel'
            && confirmations.at(-1).defaultChoice === 'no' && confirmations.at(-1).language === 'ko', 'Existing photos must use a cancellable confirmation that defaults to keeping the photo');
    }
    confirmationChoice = 'yes';
    click(button('이 프로필 선택', dialog()));
    await until(() => !dialog(), 'Applying a profile should close the modal');
    check(saves[0].id === 'Q102', 'The selected profile should be saved');
    check(!saves[0].photoOverride && saves[0].photoUrl === profiles[0].photoUrl, 'Confirming photo replacement must use the new profile photo');
    check(document.activeElement === profileTrigger, 'Closing after applying should restore the profile trigger focus');
    const profileActions = document.querySelector('.author-profile-hover-actions');
    check(['프로필 변경', '이니셜로 표시', '자동으로 찾기'].every(label => button(label, profileActions)),
        'Profile controls should share the profile change action row');
    check(!document.querySelector('.author-profile-corner-actions') && !button('프로필 수정'),
        'The separate corner actions and duplicate profile edit button should be removed');
    const photoTrigger = button('사진 변경');
    click(photoTrigger);
    await until(() => dialog()?.open && selectedTab() === '프로필 사진 찾기', 'Photo overlay should open photo search');
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length >= 4, 'Photo search should include Naver and all profile photo sources');
    await until(() => [...dialog().querySelectorAll('.is-gallery img')].some(image => image.complete && image.naturalWidth > 1),
        'Photo thumbnails should load before checking their layout');
    for (let frame = 0; frame < 40; frame += 1) {
        for (const image of dialog().querySelectorAll('.is-gallery img')) {
            if (!image.complete || !image.naturalWidth) continue;
            const bounds = image.getBoundingClientRect();
            const container = image.parentElement.getBoundingClientRect();
            check(Math.abs(bounds.width - container.width) < 1 && Math.abs(bounds.height - container.height) < 1,
                'Photo thumbnails must keep the circular frame dimensions while loading and resampling: '
                    + JSON.stringify({ width: bounds.width, height: bounds.height, frameWidth: container.width, frameHeight: container.height }));
        }
        await pause(20);
    }
    await until(() => [...dialog().querySelectorAll('.is-gallery img')].some(image => image.src.startsWith('blob:') && image.complete),
        'The thumbnail layout check should exercise a resampled photo');
    await capture('photo-gallery-many');
    assertGalleryContents();
    assertPhotoLayout();
    const galleryCards = [...dialog().querySelectorAll('.author-editor-result')];
    check(Math.abs(galleryCards[0].getBoundingClientRect().top - galleryCards[1].getBoundingClientRect().top) < 1,
        'The wide photo gallery should display multiple results in each row');
    await capture('photo-gallery');
    click(button('사진 더 보기', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 43, 'More photos should append the next gallery page');
    assertGalleryContents();
    const source = dialog().querySelector('select[aria-label="검색 소스"]');
    check(['all', 'naver', 'wikidata', 'wikipedia', 'openlibrary', 'aladin', 'kyobo', 'cartoon', 'kmas'].every(value => [...source.options].some(option => option.value === value)), 'Photo search should allow choosing each source');
    changeValue(source, 'naver');
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 0, 'Changing the source should reset old results');
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length === 20, 'A Naver source search should display its own result page');
    click(dialog().querySelector('.author-editor-result'));
    await until(() => button('이 사진 사용', dialog()) && !button('이 사진 사용', dialog()).disabled, 'A selected photo should become available for applying');
    assertPhotoLayout();
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
    assertPhotoLayout(true);
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
    click(button('프로필 사진 업로드', dialog()));
    await until(() => selectedTab() === '프로필 사진 업로드', 'Upload tab should open for browser drops');
    const dropPhoto = dataTransfer => {
        const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer });
        dialog().querySelector('.author-editor-upload').dispatchEvent(event);
        check(event.defaultPrevented, 'Image drops must not navigate away from the profile editor');
    };
    const photoPreview = () => dialog().querySelector('.author-editor-photo-stage img');
    const photoError = () => dialog().querySelector('.author-editor-message.is-error');
    const arrivalNodes = [];
    const arrivalObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof Element && node.classList.contains('cover-editor-image-arrival')) arrivalNodes.push(node);
        }
    });
    arrivalObserver.observe(document.body, { childList: true, subtree: true });
    const localDrop = new DataTransfer();
    localDrop.items.add(new File([transfer.files[0]], 'dropped-portrait.png', { type: 'image/png' }));
    localDrop.setData('text/html', '<img src="https://images.example.test/ignored.png">');
    let dropImportCount = imported.length;
    const previewsBeforeFileDrop = previewImports.length;
    dropPhoto(localDrop);
    await until(() => imported.length === dropImportCount + 1 && photoPreview() && !button('사진 편집', dialog()).disabled, 'A local file drop should load the photo');
    check(previewImports.length === previewsBeforeFileDrop && dialog().querySelector('.author-editor-photo-caption strong').textContent === 'dropped-portrait.png',
        'A readable dropped image file must take priority over accompanying browser URLs');
    const webImageUrl = 'https://images.example.test/portrait.png';
    const webDrop = new DataTransfer();
    webDrop.setData('text/html', '<a href="https://site.example.test/author"><img src="' + webImageUrl + '"></a>');
    webDrop.setData('text/uri-list', 'https://site.example.test/author');
    dropImportCount = imported.length;
    dropPhoto(webDrop);
    await until(() => imported.length === dropImportCount + 1 && photoPreview() && !button('사진 편집', dialog()).disabled, 'A browser image URL drop should load a usable profile photo');
    check(previewImports.at(-1).url === webImageUrl && imported.at(-1).dataUrl === dataUrl && !photoError(),
        'Browser drops must decode the HTML image URL instead of the enclosing page link');
    check(releasedImages.some(value => value?.imagePath === previewImports.at(-1).imagePath), 'The temporary remote preview must be released after import');
    const dataDrop = new DataTransfer();
    dataDrop.setData('text/html', '<img src="' + dataUrl + '">');
    dropImportCount = imported.length;
    dropPhoto(dataDrop);
    await until(() => imported.length === dropImportCount + 1 && photoPreview() && !button('사진 편집', dialog()).disabled, 'An inline browser image should load from its data URL');
    check(previewImports.at(-1).url === dataUrl && !photoError(), 'Data URL drops must use the validated image importer');
    const placeholderDrop = new DataTransfer();
    placeholderDrop.items.add(new File([], 'browser-placeholder.png', { type: 'image/png' }));
    placeholderDrop.setData('text/html', '<img src="' + webImageUrl + '">');
    dropImportCount = imported.length;
    dropPhoto(placeholderDrop);
    await until(() => imported.length === dropImportCount + 1 && photoPreview() && !button('사진 편집', dialog()).disabled, 'A browser placeholder file should fall back to its image URL');
    check(previewImports.at(-1).url === webImageUrl && !photoError(), 'Empty browser image files must not reject an accompanying valid image URL');
    const preservedPreview = photoPreview().src;
    const preservedCaption = dialog().querySelector('.author-editor-photo-caption').textContent;
    const importsBeforeInvalidDrop = imported.length;
    const previewsBeforeInvalidDrop = previewImports.length;
    for (const payload of ['blob:https://images.example.test/temporary', 'https://images.example.test/one.png\\nhttps://images.example.test/two.png']) {
        const invalidDrop = new DataTransfer();
        invalidDrop.setData('text/uri-list', payload);
        dropPhoto(invalidDrop);
        await until(photoError, 'Invalid or multiple browser images should show an error');
        await pause(20);
        check(imported.length === importsBeforeInvalidDrop && previewImports.length === previewsBeforeInvalidDrop,
            'Invalid or multiple browser image URLs must not reach image import');
        check(photoPreview()?.src === preservedPreview && dialog().querySelector('.author-editor-photo-caption').textContent === preservedCaption,
            'Rejected browser drops must preserve the selected photo');
    }
    const failedDrop = new DataTransfer();
    failedDrop.setData('text/uri-list', 'https://images.example.test/unavailable.png');
    dropPhoto(failedDrop);
    await until(() => previewImports.length === previewsBeforeInvalidDrop + 1 && photoError()?.textContent.includes('사진을 불러오지 못했습니다') && !button('사진 편집', dialog()).disabled,
        'A failed remote image download should finish with an error');
    check(imported.length === importsBeforeInvalidDrop && photoPreview()?.src === preservedPreview,
        'Failed browser image downloads must keep the existing photo and avoid saving invalid data');
    check(arrivalNodes.length === 0, 'Reduced motion must not create an arrival animation for uploaded or dropped photos');
    applyMotionPreference('full');
    const runningArrival = () => {
        const node = dialog()?.querySelector('.cover-editor-image-arrival');
        return node?.getAnimations().some(animation => animation.playState === 'running') ? node : null;
    };
    dropImportCount = imported.length;
    dropPhoto(webDrop);
    await until(() => imported.length === dropImportCount + 1 && runningArrival(), 'A browser image drop should animate into the preview in full motion mode');
    const arrival = runningArrival();
    check(dialog().contains(arrival) && arrival.querySelector('img').src === dataUrl,
        'The arriving photo must render inside the native profile dialog');
    check(!button('사진 편집', dialog()).disabled && !button('이 사진 사용', dialog()).disabled,
        'Arrival animation must not block editing or saving the uploaded candidate');
    const keyframes = arrival.getAnimations()[0].effect.getKeyframes();
    check(keyframes.some(frame => new DOMMatrixReadOnly(frame.transform).m41 < -1),
        'The arrival animation must move from the upload area toward the left preview');
    await until(() => !dialog().querySelector('.cover-editor-image-arrival'), 'The arrival animation should remove its temporary element after finishing');
    check(photoPreview()?.src === dataUrl && !photoError(), 'The final uploaded photo must remain visible after the arrival animation');
    const arrivalsBeforeFailure = arrivalNodes.length;
    dropPhoto(failedDrop);
    await until(() => photoError()?.textContent.includes('사진을 불러오지 못했습니다') && !button('사진 편집', dialog()).disabled,
        'A failed upload in full motion mode should return to the existing preview');
    check(arrivalNodes.length === arrivalsBeforeFailure && !dialog().querySelector('.cover-editor-image-arrival'),
        'Failed image imports must not start an arrival animation');
    const arrivalFileInput = dialog().querySelector('input[type="file"]');
    arrivalFileInput.files = localDrop.files;
    arrivalFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await until(runningArrival, 'Selecting a local image file should animate into the preview');
    click(button('프로필 사진 찾기', dialog()));
    await until(() => selectedTab() === '프로필 사진 찾기' && !dialog().querySelector('.cover-editor-image-arrival'),
        'Changing tabs during arrival must remove the animated photo');
    click(button('프로필 사진 업로드', dialog()));
    await until(() => selectedTab() === '프로필 사진 업로드', 'Upload tab should reopen after cancelling arrival');
    dropPhoto(localDrop);
    await until(runningArrival, 'Dropping a local photo should start a new arrival animation');
    click(button('닫기', dialog()));
    await until(() => !dialog() && !document.querySelector('.cover-editor-image-arrival'),
        'Closing during arrival must remove the animated photo without leaving an overlay');
    applyMotionPreference('reduced');
    click(photoTrigger);
    await until(() => dialog()?.open, 'Photo search should reopen after arrival cleanup testing');
    click(button('프로필 사진 업로드', dialog()));
    await until(() => selectedTab() === '프로필 사진 업로드', 'Upload tab should reopen in reduced motion mode');
    const arrivalsBeforeReducedDrop = arrivalNodes.length;
    dropImportCount = imported.length;
    dropPhoto(localDrop);
    await until(() => imported.length === dropImportCount + 1 && photoPreview() && !button('사진 편집', dialog()).disabled,
        'Reduced motion should show the uploaded photo immediately');
    check(arrivalNodes.length === arrivalsBeforeReducedDrop && !dialog().querySelector('.cover-editor-image-arrival'),
        'Switching back to reduced motion must skip arrival animations');
    arrivalObserver.disconnect();
    let finishPreviewImport;
    previewImportGate = new Promise(resolve => { finishPreviewImport = resolve; });
    const importsBeforeClose = imported.length;
    const previewsBeforeClose = previewImports.length;
    dropPhoto(webDrop);
    await until(() => previewImports.length === previewsBeforeClose + 1, 'A remote image request should be pending before closing');
    const closedPreviewPath = previewImports.at(-1).imagePath;
    click(button('닫기', dialog()));
    await until(() => !dialog(), 'The profile editor should close while a dropped image loads');
    previewImportGate = null;
    finishPreviewImport();
    await until(() => releasedImages.some(value => value?.imagePath === closedPreviewPath), 'A preview arriving after close must release its temporary image');
    check(imported.length === importsBeforeClose, 'A dropped image arriving after close must not import or save a profile photo');
    click(photoTrigger);
    await until(() => dialog()?.open, 'Photo search should reopen after browser drop testing');
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
    click(button('프로필 사진 찾기', dialog()));
    await until(() => selectedTab() === '프로필 사진 찾기', 'Narrow photo search should open');
    click(button('검색', dialog()));
    await until(() => dialog().querySelectorAll('.author-editor-result').length >= 4, 'Narrow photo results should load');
    assertGalleryContents();
    assertPhotoLayout();
    await capture('narrow-photo-gallery');
    click(button('프로필 사진 업로드', dialog()));
    await until(() => selectedTab() === '프로필 사진 업로드', 'Narrow upload should open');
    const narrowFileInput = dialog().querySelector('input[type="file"]');
    narrowFileInput.files = transfer.files;
    narrowFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => button('사진 편집', dialog()) && !button('사진 편집', dialog()).disabled, 'Narrow uploaded photo should be ready for preview');
    assertPhotoLayout(true);
    await capture('narrow-photo-upload');
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
    const addedProfiles = sourceProfiles.slice();
    const selectProfileForSaving = async candidate => {
        sourceProfiles = [candidate];
        click(button('프로필 변경'));
        await until(() => dialog()?.open, 'The profile picker must reopen for photo choice verification');
        click(button('검색', dialog()));
        await until(() => dialog().querySelectorAll('.author-editor-result').length === 1, 'The requested profile candidate should be available');
        click(dialog().querySelector('.author-editor-result'));
        await until(() => !button('이 프로필 선택', dialog()).disabled, 'The profile should be ready for saving');
    };
    const setFixtureProfile = async value => {
        currentProfile = normalizeAuthorProfile(value);
        status = currentProfile?.photoUrl ? 'ready' : 'empty';
        notify();
        await pause(20);
    };
    const keepProfile = async candidate => {
        confirmationChoice = 'no';
        await selectProfileForSaving(candidate);
        click(button('이 프로필 선택', dialog()));
        await until(() => !dialog(), 'Keeping the current photo must save the new profile');
        return saves.at(-1);
    };
    await setFixtureProfile(original);
    const beforeStoredSave = profilePhotoSaves.length;
    const keptStored = await keepProfile(addedProfiles[0]);
    check(keptStored.id === 'aladin:49154' && keptStored.photoOverride?.id === original.storedPhoto.id,
        'Keeping a stored photo across profile sources must preserve its file identity');
    check(keptStored.photoOverride.source === 'wikidata' && keptStored.photoOverride.sourceUrl === original.storedPhoto.sourceUrl
        && keptStored.imageSourceUrl === original.imageSourceUrl && keptStored.imageArtist === original.imageArtist && keptStored.imageLicense === original.imageLicense,
        'Keeping a stored photo must preserve its original source, photographer and license');
    check(profilePhotoSaves.length === beforeStoredSave, 'An already stored photo should not be downloaded again');
    check(normalizeAuthorProfile(JSON.parse(JSON.stringify(keptStored))).photoOverride?.id === original.storedPhoto.id,
        'The preserved photo must survive profile normalization after restarting');
    for (const override of [
        { id: 'e'.repeat(64), source: 'local', sourceUrl: '', query: '' },
        { id: 'f'.repeat(64), source: 'naver', sourceUrl: 'https://example.com/previous-portrait.png', query: '기존 사진' },
    ]) {
        await setFixtureProfile({ provider: 'local', id: override.id, name: '가쇼 쇼지', photoOverride: override });
        const previousDownloads = profilePhotoSaves.length;
        const keptOverride = await keepProfile(addedProfiles[1]);
        check(keptOverride.id === 'kyobo:1000646901' && Object.entries(override).every(([key, value]) => keptOverride.photoOverride?.[key] === value),
            'A standalone uploaded or selected photo must remain intact when adding profile information');
        check(profilePhotoSaves.length === previousDownloads, 'A local photo override should be reused without a network request');
    }
    await setFixtureProfile({ ...original, storedPhoto: undefined, photoUrl: original.storedPhoto.sourceUrl });
    failPreservedPhoto = true;
    confirmationChoice = 'no';
    const beforeFailedSave = saves.length;
    await selectProfileForSaving(addedProfiles[0]);
    click(button('이 프로필 선택', dialog()));
    await until(() => dialog()?.querySelector('[role="alert"]') && !button('이 프로필 선택', dialog()).disabled,
        'A failed attempt to preserve a remote photo should show an error and allow retry');
    check(saves.length === beforeFailedSave && currentProfile.id === original.id,
        'Failure to preserve the current photo must not apply the selected profile');
    failPreservedPhoto = false;
    click(button('이 프로필 선택', dialog()));
    await until(() => !dialog(), 'Retrying remote photo preservation should save the selected profile');
    check(profilePhotoSaves.at(-1).id === original.id && saves.at(-1).id === 'aladin:49154' && saves.at(-1).photoOverride?.id === 'c'.repeat(64),
        'Preserving a remote photo must save the previous profile image and attach it to the new profile');
    check(saves.at(-1).imageArtist === original.imageArtist && saves.at(-1).imageLicense === original.imageLicense,
        'Preserving a remote photo must also preserve its attribution');
    await setFixtureProfile(original);
    confirmationChoice = 'yes';
    await selectProfileForSaving(addedProfiles[2]);
    click(button('이 프로필 선택', dialog()));
    await until(() => !dialog(), 'Explicitly confirming a profile without a photo should save it');
    check(confirmations.at(-1).message.includes('사진이 없') && /지우|제거/.test(confirmations.at(-1).message),
        'Confirmation must explain that choosing a profile without a photo removes the current photo');
    check(saves.at(-1).id === addedProfiles[2].id && !saves.at(-1).photoUrl && !saves.at(-1).photoOverride,
        'Explicit photo removal must retain the selected profile information');
    const beforeNoPhoto = confirmations.length;
    await selectProfileForSaving(addedProfiles[0]);
    click(button('이 프로필 선택', dialog()));
    await until(() => !dialog(), 'A profile without an existing photo should save without confirmation');
    check(confirmations.length === beforeNoPhoto && saves.at(-1).id === 'aladin:49154', 'No existing photo means there is no replacement to confirm');
    await window.resizeAuthorEditor(1100, 820);
    await pause(50);
    await setFixtureProfile({ ...original, birthDate: '1971-07-11', topWork: '기존 대표작', works: ['기존 대표작'],
        photoOverride: { id: 'e'.repeat(64), source: 'naver', sourceUrl: 'https://example.com/retained-photo.png', query: '보존할 사진',
            imageSourceUrl: 'https://example.com/photo-credit', imageArtist: 'Retained photographer', imageLicense: 'CC BY-SA 4.0' } });
    const profileBeforeEditing = JSON.parse(JSON.stringify(currentProfile));
    const editField = name => {
        const explicit = dialog().querySelector('input[aria-label="' + name + '"], textarea[aria-label="' + name + '"]');
        if (explicit) return explicit;
        const label = [...dialog().querySelectorAll('label')].find(node => node.querySelector('span')?.textContent.trim() === name || node.textContent.trim() === name);
        return label?.control || label?.querySelector('input, textarea');
    };
    const openProfileEdit = async () => {
        click(button('프로필 변경'));
        await until(() => dialog()?.open && selectedTab() === '프로필 찾기', 'Existing profile controls must still open profile search');
        click(button('프로필 편집', dialog()));
        await until(() => selectedTab() === '프로필 편집' && editField('이름'), 'The profile edit tab must display the edit form');
    };
    await openProfileEdit();
    check(editField('이름').value === profileBeforeEditing.name && editField('출생').value === profileBeforeEditing.birthDate
        && editField('사망').value === '' && editField('대표작').value === profileBeforeEditing.topWork
        && editField('소개').value === profileBeforeEditing.description, 'The edit form must start with the currently saved profile fields');
    assertContained(dialog());
    await capture('profile-edit');
    const beforeCancelledEdit = saves.length;
    changeValue(editField('이름'), '저장하지 않을 이름');
    changeValue(editField('소개'), '탭을 이동해도 유지할 소개 초안');
    click(button('프로필 사진 찾기', dialog()));
    await until(() => selectedTab() === '프로필 사진 찾기', 'Photo search should remain accessible while editing a draft');
    click(button('프로필 편집', dialog()));
    await until(() => selectedTab() === '프로필 편집', 'The edit tab should reopen without losing its draft');
    check(editField('이름').value === '저장하지 않을 이름' && editField('소개').value === '탭을 이동해도 유지할 소개 초안',
        'Switching tabs must preserve unsaved profile edits');
    await escape();
    await until(() => !dialog(), 'Closing should discard the unsaved profile draft');
    check(saves.length === beforeCancelledEdit && JSON.stringify(currentProfile) === JSON.stringify(profileBeforeEditing),
        'Cancelling profile editing must preserve the stored profile and photo');
    await openProfileEdit();
    check(editField('이름').value === profileBeforeEditing.name && editField('소개').value === profileBeforeEditing.description,
        'Reopening after cancellation must restore the saved profile values');
    changeValue(editField('이름'), '   ');
    await until(() => button('변경사항 저장', dialog())?.disabled, 'A blank profile name must prevent saving');
    changeValue(editField('이름'), '가쇼 쇼지 수정');
    changeValue(editField('출생'), '1970-12-01');
    changeValue(editField('사망'), '2026-01-02');
    changeValue(editField('대표작'), '수정한 대표작');
    changeValue(editField('소개'), '수정한 작가 소개\\n두 번째 소개 문단');
    await until(() => !button('변경사항 저장', dialog()).disabled, 'Valid profile edits should enable saving');
    await window.resizeAuthorEditor(480, 660);
    await pause(50);
    assertContained(dialog());
    for (const field of dialog().querySelectorAll('input, textarea')) {
        const bounds = field.getBoundingClientRect();
        check(bounds.left >= 0 && bounds.right <= innerWidth, 'Profile edit fields must fit in a narrow modal');
    }
    await capture('narrow-profile-edit');
    const beforeTextEdit = { confirmations: confirmations.length, downloads: profilePhotoSaves.length, imports: imported.length };
    click(button('변경사항 저장', dialog()));
    await until(() => !dialog(), 'Saving profile text should close the editor');
    const editedProfile = saves.at(-1);
    check(editedProfile.name === '가쇼 쇼지 수정' && editedProfile.birthDate === '1970-12-01' && editedProfile.deathDate === '2026-01-02'
        && editedProfile.topWork === '수정한 대표작' && editedProfile.description === '수정한 작가 소개\\n두 번째 소개 문단',
        'All edited profile fields must be saved: ' + JSON.stringify({ name: editedProfile.name, birthDate: editedProfile.birthDate,
            deathDate: editedProfile.deathDate, topWork: editedProfile.topWork, description: editedProfile.description }));
    for (const key of ['provider', 'id', 'sourceUrl', 'photoUrl', 'storedPhoto', 'photoOverride', 'imageSourceUrl', 'imageArtist', 'imageLicense']) {
        check(JSON.stringify(editedProfile[key]) === JSON.stringify(profileBeforeEditing[key]),
            'Editing profile text must preserve the existing photo and source field: ' + key);
    }
    check(confirmations.length === beforeTextEdit.confirmations && profilePhotoSaves.length === beforeTextEdit.downloads
        && imported.length === beforeTextEdit.imports, 'Text-only profile editing must not confirm, download or replace the existing photo');

    const editableCandidate = { ...addedProfiles[0], name: '검색한 작가', birthDate: '1970-12-01', deathDate: '2020-01-02',
        topWork: '검색한 대표작', description: '검색 결과의 소개', alternateNames: ['검색한 작가의 다른 이름'] };
    const openSelectedProfileEdit = async () => {
        await selectProfileForSaving(editableCandidate);
        const editAction = button('이 프로필 편집', dialog());
        const selectAction = button('이 프로필 선택', dialog());
        const editBounds = editAction.getBoundingClientRect();
        const selectBounds = selectAction.getBoundingClientRect();
        check(editBounds.right <= selectBounds.left + 1 && Math.abs(editBounds.top - selectBounds.top) < 1,
            'The selected-profile edit action must stay left of the select action in a narrow footer');
        assertContained(dialog());
        await capture('selected-profile-search');
        const before = { saves: saves.length, confirmations: confirmations.length, photos: profilePhotoSaves.length };
        click(editAction);
        await until(() => selectedTab() === '프로필 편집' && document.activeElement === editField('이름'),
            'Editing a selected profile must activate the edit tab and focus its name');
        check(editField('이름').value === editableCandidate.name && editField('출생').value === editableCandidate.birthDate
            && editField('사망').value === editableCandidate.deathDate && editField('대표작').value === editableCandidate.topWork
            && editField('소개').value === editableCandidate.description, 'The selected search result must supply every editable field');
        check(dialog().querySelector('.author-editor-profile-source a')?.href === editableCandidate.sourceUrl,
            'The editor must show the selected profile source instead of the saved profile source');
        check(saves.length === before.saves && confirmations.length === before.confirmations && profilePhotoSaves.length === before.photos,
            'Opening a selected profile draft must not save, confirm or download a photo');
        await capture('selected-profile-edit');
    };
    await setFixtureProfile(original);
    await openSelectedProfileEdit();
    changeValue(editField('이름'), '검색 결과 수정 초안');
    changeValue(editField('소개'), '검색 결과를 바탕으로 수정한 소개');
    click(button('프로필 사진 찾기', dialog()));
    await until(() => selectedTab() === '프로필 사진 찾기', 'A selected profile draft must allow switching tabs');
    click(button('프로필 편집', dialog()));
    await until(() => selectedTab() === '프로필 편집', 'The selected profile draft must remain available');
    check(editField('이름').value === '검색 결과 수정 초안' && editField('소개').value === '검색 결과를 바탕으로 수정한 소개',
        'Tab changes must preserve edits to a selected search result');
    const beforeSelectedCancel = saves.length;
    await escape();
    await until(() => !dialog(), 'Closing a selected profile draft must dismiss the editor');
    check(saves.length === beforeSelectedCancel && JSON.stringify(currentProfile) === JSON.stringify(original),
        'Cancelling a selected profile draft must preserve the existing profile and photo');

    await openSelectedProfileEdit();
    changeValue(editField('이름'), '검색 결과 수정');
    changeValue(editField('소개'), '저장할 검색 결과 소개');
    confirmationChoice = 'cancel';
    const beforeSelectedSave = { saves: saves.length, confirmations: confirmations.length };
    click(button('변경사항 저장', dialog()));
    await until(() => confirmations.length > beforeSelectedSave.confirmations && button('변경사항 저장', dialog())?.disabled === false,
        'Saving an edited search result must ask whether to replace the existing photo');
    check(saves.length === beforeSelectedSave.saves && currentProfile.id === original.id && editField('이름').value === '검색 결과 수정',
        'Cancelling photo replacement must keep both the current profile and the unsaved edited draft');
    confirmationChoice = 'no';
    click(button('변경사항 저장', dialog()));
    await until(() => !dialog(), 'An edited search result must save while preserving the current photo');
    const savedSelectedDraft = saves.at(-1);
    check(savedSelectedDraft.id === editableCandidate.id && savedSelectedDraft.provider === editableCandidate.provider
        && savedSelectedDraft.sourceUrl === editableCandidate.sourceUrl && savedSelectedDraft.name === '검색 결과 수정'
        && savedSelectedDraft.description === '저장할 검색 결과 소개' && savedSelectedDraft.birthDate === editableCandidate.birthDate
        && savedSelectedDraft.deathDate === editableCandidate.deathDate && savedSelectedDraft.topWork === editableCandidate.topWork
        && savedSelectedDraft.alternateNames.includes(editableCandidate.alternateNames[0]),
        'Saving selected-profile edits must retain the selected identity and source with the edited fields');
    check(savedSelectedDraft.photoOverride?.id === original.storedPhoto.id && savedSelectedDraft.imageArtist === original.imageArtist,
        'Declining photo replacement from the edit tab must preserve the existing photo and attribution');
    await setFixtureProfile(original);
    await openSelectedProfileEdit();
    confirmationChoice = 'yes';
    click(button('변경사항 저장', dialog()));
    await until(() => !dialog(), 'Accepting photo replacement must save the edited search profile');
    check(saves.at(-1).id === editableCandidate.id && saves.at(-1).photoUrl === editableCandidate.photoUrl && !saves.at(-1).photoOverride,
        'Accepting photo replacement from the edit tab must use the selected search result photo');

    await setFixtureProfile(null);
    await openProfileEdit();
    check(editField('이름').value === '가쇼 쇼지' && editField('소개').value === '',
        'An author without a profile should start with the author name and empty optional fields');
    changeValue(editField('이름'), '직접 입력한 작가');
    changeValue(editField('소개'), '사진 없이 직접 작성한 프로필');
    await until(() => !button('변경사항 저장', dialog()).disabled, 'A photo is not required to save a manually entered profile');
    click(button('변경사항 저장', dialog()));
    await until(() => !dialog(), 'A new local profile without a photo should save');
    const localProfile = saves.at(-1);
    check(localProfile.provider === 'local' && localProfile.id.startsWith('local:') && !localProfile.photoUrl
        && localProfile.name === '직접 입력한 작가' && localProfile.description === '사진 없이 직접 작성한 프로필',
        'A manually created profile must keep its text without requiring a photo or external source');
    check(normalizeAuthorProfile(JSON.parse(JSON.stringify(localProfile)))?.name === localProfile.name,
        'A manually entered profile must survive normalization and reload');
    click(button('사진 변경'));
    await until(() => dialog()?.open && selectedTab() === '프로필 사진 찾기', 'A manually entered profile should still offer photo search');
    click(button('프로필 사진 업로드', dialog()));
    await until(() => selectedTab() === '프로필 사진 업로드', 'A local profile should allow uploading its first photo');
    const localProfileInput = dialog().querySelector('input[type="file"]');
    localProfileInput.files = transfer.files;
    localProfileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => button('이 사진 사용', dialog()) && !button('이 사진 사용', dialog()).disabled,
        'The first photo for a local profile should become ready to apply');
    click(button('이 사진 사용', dialog()));
    await until(() => !dialog(), 'Adding a photo should save the existing local profile');
    check(saves.at(-1).id === localProfile.id && saves.at(-1).provider === 'local' && saves.at(-1).name === localProfile.name
        && saves.at(-1).description === localProfile.description && saves.at(-1).photoOverride?.source === 'local',
        'Adding a photo to a manually entered profile must preserve its identity and edited metadata');
    for (const provider of ['google', 'namuwiki']) {
        await setFixtureProfile(original);
        const candidate = normalizeAuthorProfile(provider === 'google' ? {
            provider, id: 'google:' + 'e'.repeat(64), name: '검색한 작가', description: '구글 검색 결과 요약',
            sourceUrl: 'https://example.com/author', photoUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:portrait',
        } : { provider, id: 'namuwiki:검색한 작가', name: '검색한 작가', birthDate: '1970년',
            photoUrl: 'https://i.namu.wiki/i/portrait.webp', description: '나무위키 작가 소개' });
        sourceProfiles = [candidate];
        click(button('프로필 변경'));
        await until(() => dialog()?.open, 'Web source profile search should open');
        changeValue(dialog().querySelector('select[aria-label="검색 소스"]'), provider);
        await pause(0);
        click(button('검색', dialog()));
        await until(() => dialog().querySelectorAll('.author-editor-result').length === 1, 'Web source should populate the profile list');
        click(dialog().querySelector('.author-editor-result'));
        await until(() => dialog().querySelector('.author-editor-description')?.textContent.includes(candidate.description), 'Web profile should show its snippet or introduction');
        webSearchResult = { cancelled: true };
        click(button('검색 창에서 선택', dialog()));
        await pause(0);
        await until(() => !button('검색 창에서 선택', dialog()).disabled, 'Closing a search window should re-enable search');
        check(dialog().querySelector('.author-editor-profile-summary h3')?.textContent === candidate.name,
            'Cancelling web search must preserve the selected profile');
        webSearchResult = { profile: { ...candidate, description: '직접 선택한 프로필' } };
        click(button('검색 창에서 선택', dialog()));
        await until(() => dialog().querySelector('.author-editor-description')?.textContent.includes('직접 선택한 프로필'), 'A directly chosen profile should appear without saving');
        check(webSearches.at(-1).source === provider && webSearches.at(-1).kind === 'profile', 'Direct profile search should use the selected source');
        click(button('이 프로필 편집', dialog()));
        await until(() => selectedTab() === '프로필 편집', 'A web result should be editable');
        check(editField('소개').value === '직접 선택한 프로필', 'The selected web introduction should reach the edit draft');
        click(button('프로필 사진 찾기', dialog()));
        await until(() => selectedTab() === '프로필 사진 찾기', 'Web photo search should open');
        click(button('검색', dialog()));
        await until(() => dialog().querySelectorAll('.author-editor-result').length === 1, 'Web source photos should populate the gallery');
        check(searches.at(-1).options.photos === true, 'Photo search must reach the image-search path');
        click(dialog().querySelector('.author-editor-result'));
        await until(() => !button('이 사진 사용', dialog()).disabled, 'An automatic web photo should become selectable');
        webSearchResult = { dataUrl, photo: { id: 'e'.repeat(64), source: provider, query: '검색한 작가',
            sourceUrl: 'https://example.com/chosen.png', imageSourceUrl: candidate.sourceUrl } };
        click(button('검색 창에서 선택', dialog()));
        await until(() => imported.at(-1)?.photo?.source === provider && !button('이 사진 사용', dialog()).disabled,
            'A directly selected web photo should import and become ready to save');
        check(webSearches.at(-1).kind === 'photo', 'Direct photo search should request image selection');
        await capture('web-search-' + provider);
        assertPhotoLayout();
        click(button('이 사진 사용', dialog()));
        await until(() => !dialog(), 'A chosen web photo should save');
        check(saves.at(-1).id === original.id && saves.at(-1).photoOverride?.source === provider
            && saves.at(-1).imageSourceUrl === candidate.sourceUrl, 'Web photo saving must preserve the existing profile and selected photo source');
    }
    sourceProfiles = null;
    await setFixtureProfile(original);
    await selectProfileForSaving(addedProfiles[1]);
    let finishConfirmation;
    confirmationGate = new Promise(resolve => { finishConfirmation = resolve; });
    const beforeUnmount = { saves: saves.length, photos: profilePhotoSaves.length, confirmations: confirmations.length };
    confirmationChoice = 'no';
    click(button('이 프로필 선택', dialog()));
    await until(() => confirmations.length > beforeUnmount.confirmations, 'Photo confirmation should be pending before leaving the view');
    root.unmount();
    confirmationGate = null;
    finishConfirmation();
    await pause(20);
    check(saves.length === beforeUnmount.saves && profilePhotoSaves.length === beforeUnmount.photos, 'A confirmation resolved after leaving the view must not save a profile or photo');
    return { tabs: true, profileSearch: true, photoSources: true, preservedProfile: true, photoConfirmation: true, editedUpload: true, focusRestored: true, narrowLayout: true, stableLoading: true };
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
        assert.deepEqual(JSON.parse(payload), { tabs: true, profileSearch: true, photoSources: true, preservedProfile: true, photoConfirmation: true, editedUpload: true, focusRestored: true, narrowLayout: true, stableLoading: true });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
