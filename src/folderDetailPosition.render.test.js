import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('폴더 상세패널의 배치·너비 저장, 접기 모션과 동작 줄이기 및 좁은 창 스크롤이 동작한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-detail-position-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
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
const book = {
    path: '/fixture/book.epub', full_path: '/fixture/book.epub', name: 'book.epub', ext: '.epub',
    title: '상세패널 배치 확인을 위한 여러 줄로 표시되는 긴 제목', series: '긴 메타데이터 시리즈 이름과 부제', author: '테스트 작가', publisher: '테스트 출판사',
    description: Array.from({ length: 60 }, (_, index) => '설명 ' + index + ': 긴 책 정보를 아래로 스크롤하여 읽을 수 있어야 합니다.').join('\\n'),
    genre: '판타지, 사이버펑크', tags: '모험, 여행, LongUnbrokenMetadataTagForOverflowVerification', size: 2048, exists: true, has_metadata: true,
    cover: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="254" viewBox="0 0 180 254"><rect width="180" height="254" fill="#36536c"/><rect x="24" y="32" width="132" height="190" fill="#d6c79d"/></svg>'),
    readingState: { status: 'reading', pageIndex: 0, pageCount: 6, scrollPercent: 17 },
};
const originalCover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1270" viewBox="0 0 180 254"><rect width="180" height="254" fill="#36536c"/><rect x="24" y="32" width="132" height="190" fill="#d6c79d"/></svg>');
const coverRequests = [];
localStorage.setItem('bookmanager-viewer-bookmarks:' + book.path, JSON.stringify([{ pageIndex: 0 }]));
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}),
    getLibraryScanStates: async () => ({}), getReadingStates: async () => [{ ...book.readingState, filePath: book.path }], listRecentReading: async () => [],
    stat: async filePath => ({ isDirectory: filePath === '/fixture', isFile: filePath === book.path }),
    readDir: async () => [{ ...book, isFile: true }], scanFolder: async () => [book],
    getFilePreview: async () => ({ success: false }),
    loadMetadataCover: async filePath => { coverRequests.push(filePath); return originalCover; },
    readingLists: async () => ({ success: true, collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0 }),
};
const root = createRoot(document.getElementById('root'));
const saves = [];
let mountKey = 0;
let persisted;
const saveConfig = async patch => { saves.push(patch); persisted = { ...persisted, ...patch }; };
const content = () => document.querySelector('.folder-content-area');
const panel = () => document.querySelector('#folder-detail-panel');
const list = () => document.querySelector('.view-container');
const toggle = () => Array.from(document.querySelectorAll('.folder-detail-panel-toggle')).find(button => button.getClientRects().length > 0);
const positionButton = value => document.querySelector('.folder-detail-position-button[data-position="' + value + '"]');
const rect = element => element.getBoundingClientRect();
const near = (actual, expected) => Math.abs(actual - expected) <= 2;
function clickVisibleButton(button) {
    const bounds = rect(button);
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    check(target && button.contains(target), 'The visible control is covered and cannot receive pointer input');
    button.focus();
    button.click();
}
async function mount(config) {
    persisted = config;
    root.render(<FolderTab key={++mountKey} config={config} t={t} saveConfig={saveConfig} showToast={() => {}} />);
    await until(() => document.querySelector('tr[data-file-path="' + book.path + '"]')?.textContent.includes(book.title)
        && list()?.getAttribute('aria-busy') === 'false', 'The folder book metadata did not load');
    await frame();
    await frame();
    document.querySelector('tr[data-file-path="' + book.path + '"]').click();
    await until(() => panel()?.textContent.includes(book.title), 'Selecting the actual book did not show its details');
    await until(() => panel()?.querySelector('.detail-cover-progress'), 'Reading progress did not load onto the cover');
    await until(() => {
        const image = panel()?.querySelector('.detail-cover-image');
        return image?.complete && image.naturalWidth > 0;
    }, 'The detail cover image did not load');
    await document.fonts.ready;
    await frame();
    const position = config.folder_detail_panel_position === 'right' ? 'right' : 'bottom';
    const expandedSize = rect(panel().querySelector('.detail-panel-disclosure-content'))[position === 'right' ? 'width' : 'height'];
    await waitForExpandedSize(position, expandedSize, 'Initial ' + position + ' panel');
}
async function setPosition(position) {
    clickVisibleButton(positionButton(position));
    await until(() => positionButton(position)?.getAttribute('aria-pressed') === 'true', position + ': position button did not activate');
    await frame();
}
async function resizeWindow(width, height) {
    await new Promise(resolve => {
        window.detailResizeRequest = { width, height };
        window.continueDetailResize = resolve;
        console.log('FOLDER_DETAIL_RESIZE');
    });
    await until(() => window.innerWidth === width, 'The fixture window did not resize');
    await frame();
}
async function capture(name) {
    if (!${JSON.stringify(Boolean(process.env.BOOKMANAGER_DETAIL_SCREENSHOT))}) return;
    await new Promise(resolve => {
        window.detailCaptureName = name;
        window.continueDetailCapture = resolve;
        console.log('FOLDER_DETAIL_CAPTURE');
    });
}
async function nativeKey(keyCode, modifiers = []) {
    await new Promise(resolve => {
        window.detailKeyRequest = { keyCode, modifiers };
        window.continueDetailKey = resolve;
        console.log('FOLDER_DETAIL_KEY');
    });
    await frame();
}
async function verifyCoverPreview() {
    const cover = panel().querySelector('.detail-cover-frame');
    const trigger = cover.querySelector('.detail-cover-preview-button');
    const currentDialog = () => document.querySelector('.detail-cover-preview-dialog');
    const waitOpen = async source => {
        await until(() => currentDialog()?.open, 'The cover preview dialog did not open from ' + source);
        check(currentDialog().parentElement === document.body, 'The cover preview must escape the detail panel clipping');
        check(currentDialog().contains(document.activeElement), 'Opening the cover preview must move focus inside it');
        return currentDialog();
    };
    const waitClosed = async () => {
        await until(() => !currentDialog(), 'Closing the cover preview must remove its dialog');
        check(document.activeElement === trigger, 'Closing the cover preview must restore focus to its trigger');
        check(document.querySelector('tr[data-file-path="' + book.path + '"]')?.classList.contains('selected'), 'Closing the cover preview must preserve the selected file');
    };
    const clickBackdrop = dialog => {
        const bounds = rect(dialog.querySelector('.detail-cover-preview-image'));
        const target = document.elementFromPoint(bounds.left - 8, bounds.top + bounds.height / 2);
        check(target === dialog, 'The ambient glow beside the actual cover must remain a backdrop target');
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };
    check(trigger && getComputedStyle(cover).cursor === 'zoom-in', 'A loaded cover must offer the zoom-in preview control');
    check(coverRequests.length === 0, 'The original cover must load only when the preview opens');
    trigger.focus();
    await nativeKey('Enter');
    let dialog = await waitOpen('initial Enter');
    const backdropStyle = getComputedStyle(dialog, '::backdrop');
    check((backdropStyle.backdropFilter || backdropStyle.webkitBackdropFilter).includes('blur(10px)'), 'The cover preview backdrop must blur the underlying screen');
    const dialogStyle = getComputedStyle(dialog);
    check(!dialog.querySelector('header, h2') && dialogStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && dialogStyle.borderTopWidth === '0px' && dialogStyle.boxShadow === 'none', 'The cover preview must show only the image and close control without a modal box or header');
    await until(() => {
        const image = dialog.querySelector('.detail-cover-preview-image');
        return image?.complete && image.naturalWidth === 900;
    }, 'The original cover did not replace the preview thumbnail');
    check(coverRequests.at(-1) === book.path, 'The preview must request the selected book original cover');
    const image = dialog.querySelector('.detail-cover-preview-image');
    const imageBounds = rect(image);
    const ambient = dialog.querySelector('.detail-cover-preview-ambient');
    await until(() => ambient?.height === 360, 'The ambient canvas must update to the loaded original cover');
    check(ambient.width > 0 && Math.max(ambient.width, ambient.height) <= 360, 'The ambient canvas must keep its longest edge within 360 pixels');
    const ambientPixel = ambient.getContext('2d').getImageData(Math.floor(ambient.width / 2), Math.floor(ambient.height / 2), 1, 1).data;
    check(ambientPixel[0] === 54 && ambientPixel[1] === 83 && ambientPixel[2] === 108 && ambientPixel[3] === 255, 'The ambient canvas must be painted from the cover edge colors');
    const ambientStyle = getComputedStyle(ambient);
    const imageStyle = getComputedStyle(image);
    const closeStyle = getComputedStyle(dialog.querySelector('.detail-cover-preview-close'));
    check(ambient.getAttribute('aria-hidden') === 'true' && ambientStyle.pointerEvents === 'none', 'The decorative ambient canvas must not intercept input or accessibility focus');
    check(ambient.parentElement === image.parentElement && getComputedStyle(image.parentElement).isolation === 'isolate' && Number(ambientStyle.zIndex) < Number(imageStyle.zIndex) && Number(imageStyle.zIndex) < Number(closeStyle.zIndex), 'The ambient glow must remain behind the image and its close control');
    check(ambientStyle.filter === 'blur(74px) saturate(1.45) contrast(1.05)' && ambientStyle.opacity === '0.78', 'The enlarged cover must use the viewer ambient glow appearance');
    const ambientBounds = rect(ambient);
    check(ambientBounds.left < imageBounds.left && ambientBounds.right > imageBounds.right && ambientBounds.top < imageBounds.top && ambientBounds.bottom > imageBounds.bottom, 'The ambient glow must extend beyond the cover image');
    check(document.elementFromPoint(imageBounds.left + imageBounds.width / 2, imageBounds.top + imageBounds.height / 2) === image, 'The cover image must remain the pointer target above the ambient glow');
    check(imageBounds.width > rect(cover).width && imageBounds.height > rect(cover).height, 'The preview must display a larger cover');
    check(imageBounds.left >= 0 && imageBounds.top >= 0 && imageBounds.right <= innerWidth && imageBounds.bottom <= innerHeight, 'The enlarged cover must stay inside the viewport');
    check(getComputedStyle(image).objectFit === 'contain', 'The preview must preserve the complete cover image');
    const closeBounds = rect(dialog.querySelector('.detail-cover-preview-close'));
    check(near(closeBounds.top, imageBounds.top) && near(closeBounds.left, imageBounds.right + 12) && closeBounds.right <= innerWidth && closeBounds.top >= 0 && closeBounds.bottom <= innerHeight, 'The close control must stay 12 pixels outside the cover top-right and inside the viewport');
    image.click();
    await frame();
    check(currentDialog()?.open, 'Clicking the enlarged image must keep its preview open');
    await nativeKey('3');
    await nativeKey('l', [/Mac|iPhone|iPad/.test(navigator.platform) ? 'meta' : 'control']);
    check(document.querySelector('.file-table') && dialog.contains(document.activeElement), 'Preview shortcuts must not switch folder view or focus the folder path');
    await capture('cover-preview');
    dialog.querySelector('.detail-cover-preview-close').click();
    await waitClosed();
    clickVisibleButton(trigger);
    dialog = await waitOpen('cover click');
    clickBackdrop(dialog);
    await waitClosed();
    cover.querySelector('.viewer-status-reading').click();
    await waitOpen('reading status icon');
    await nativeKey('Escape');
    await waitClosed();
    for (const key of ['Enter', 'Space']) {
        trigger.focus();
        await nativeKey(key);
        dialog = await waitOpen(key);
        if (key === 'Enter') dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
        else clickBackdrop(dialog);
        await waitClosed();
    }
}
async function verifyButtons(position, label) {
    await Promise.all(Array.from(document.querySelectorAll('.view-controls .view-icon-btn'))
        .flatMap(button => button.getAnimations()).map(animation => animation.finished.catch(() => {})));
    const viewButtons = Array.from(document.querySelectorAll('.view-controls > .view-icon-btn'));
    for (const value of ['bottom', 'right']) {
        const button = positionButton(value);
        check(button?.querySelector('svg'), label + ': position control needs an icon');
        check(button.getAttribute('aria-label') && !button.getAttribute('aria-label').startsWith('folder.'), label + ': position control needs a translated accessible name');
        check(button.getAttribute('aria-pressed') === String(position === value), label + ': incorrect active position');
        check(button.getAttribute('data-tooltip') === button.getAttribute('aria-label') && !button.hasAttribute('title'), label + ': icon bubble tooltip must describe its action without a native tooltip');
        check(button.classList.contains('view-icon-btn'), label + ': position controls must use the shared view button style');
        const matchingViewButton = viewButtons.find(viewButton => viewButton.getAttribute('aria-pressed') === button.getAttribute('aria-pressed'));
        check(matchingViewButton, label + ': a matching view control state must exist');
        const positionStyle = getComputedStyle(button);
        const viewStyle = getComputedStyle(matchingViewButton);
        for (const property of ['width', 'height', 'padding', 'borderRadius', 'backgroundColor']) {
            check(positionStyle[property] === viewStyle[property], label + ': position and view button ' + property + ' differ');
        }
    }
    const controls = positionButton('right').parentElement;
    const controlBounds = rect(controls);
    check(controls.closest('.right-bottom-bar'), label + ': position controls must stay in the bottom bar');
    const footerBounds = rect(document.querySelector('.right-bottom-bar'));
    const viewControlBounds = rect(document.querySelector('.view-controls'));
    check(viewControlBounds.left >= footerBounds.left && viewControlBounds.right <= footerBounds.right, label + ': view controls must remain inside the bottom bar');
    check(controls === document.querySelector('.view-controls').firstElementChild, label + ': position controls must precede the view mode buttons');
    const divider = controls.nextElementSibling;
    check(divider?.classList.contains('view-controls-divider'), label + ': position controls need a separator before view mode buttons');
    check(controlBounds.right <= rect(divider).left && rect(divider).right <= rect(viewButtons[0]).left, label + ': position controls and separator must stay left of view mode buttons');
    const boundary = document.querySelector('.folder-detail-resizer-row');
    const boundaryBounds = rect(boundary);
    const toggleBounds = rect(toggle());
    check(boundary.contains(toggle()), label + ': detail toggle must stay on the list and detail boundary');
    check(toggle().textContent.trim() === '상세' && toggle().querySelector('svg'), label + ': detail toggle needs its label and icon');
    check(position === 'right'
        ? near(toggleBounds.top + toggleBounds.height / 2, boundaryBounds.top + boundaryBounds.height / 2)
        : near(toggleBounds.left + toggleBounds.width / 2, boundaryBounds.left + boundaryBounds.width / 2), label + ': detail toggle must stay centered on its boundary');
    if (position === 'right') {
        const text = Array.from(toggle().querySelectorAll('span')).find(element => element.textContent.trim() === '상세');
        check(text && getComputedStyle(text).writingMode.startsWith('vertical'), label + ': the right boundary label must remain vertical');
    }
    if (!panel().hidden) {
        const panelBounds = rect(panel());
        check(near(rect(panel().querySelector('.detail-panel-transition')).top, panelBounds.top), label + ': position controls must not reserve a detail header row');
        const badges = panel().querySelector('.detail-cover-status-icons');
        check(badges.querySelector('.viewer-status-bookmark'), label + ': the bookmark fixture must be visible');
        check(controlBounds.top >= rect(badges).bottom, label + ': bottom bar controls must not overlap the reading status badges');
    }
}
function verifyLayout(position, label) {
    const listBounds = rect(list());
    const panelBounds = rect(panel());
    const contentBounds = rect(content());
    const cover = panel().querySelector('.detail-cover-frame');
    const coverBounds = rect(cover);
    const coverImageBounds = rect(cover.querySelector('.detail-cover-image'));
    const statusIcons = cover.querySelector('.detail-cover-status-icons');
    const statusBounds = rect(statusIcons);
    const progress = cover.querySelector('.detail-cover-progress');
    const progressBounds = rect(progress);
    const progressbar = cover.querySelector('[role="progressbar"]');
    const progressFill = progress.querySelector('.viewer-cover-progress-fill');
    check(statusIcons.querySelector('.viewer-status-reading') && statusIcons.querySelector('.viewer-status-bookmark'), label + ': reading and bookmark icons must remain on the cover');
    check(near(statusBounds.top, coverBounds.top + 6) && near(statusBounds.right, coverBounds.right - 6), label + ': status icons must stay inside the cover top-right corner');
    check(statusBounds.left >= coverBounds.left && statusBounds.bottom <= coverBounds.bottom, label + ': status icons must fit within the cover');
    check(Math.abs(progressBounds.bottom - coverImageBounds.bottom) <= 0.25, label + ': reading progress must sit flush inside the displayed cover bottom (image bottom: ' + coverImageBounds.bottom + ', progress bottom: ' + progressBounds.bottom + ')');
    check(Math.abs(progressBounds.left - coverImageBounds.left) <= 0.25 && Math.abs(progressBounds.right - coverImageBounds.right) <= 0.25, label + ': reading progress must span the full displayed cover width');
    check(progressBounds.top >= coverImageBounds.top && progressBounds.bottom <= coverImageBounds.bottom + 0.25, label + ': reading progress must remain inside the displayed cover image');
    check(Math.abs(progressBounds.height - 4) <= 0.25, label + ': reading progress must remain 4px high');
    check(progressbar?.getAttribute('aria-valuenow') === '17', label + ': reading progress must expose its percentage');
    check(near(rect(progressFill).width, progressFill.parentElement.clientWidth * 0.17), label + ': reading progress fill must match the percentage');
    check(!panel().querySelector('.viewer-detail-reading-status, .detail-panel-status-row'), label + ': the previous standalone reading status must be removed');
    check(content().classList.contains('is-detail-right') === (position === 'right'), label + ': content orientation differs from selected position');
    if (position === 'right') {
        check(listBounds.right <= panelBounds.left, label + ': list overlaps the right detail panel');
        check(near(listBounds.top, panelBounds.top), label + ': right detail panel must start alongside the list');
        check(near(listBounds.bottom, panelBounds.bottom), label + ': list and detail panel must share their bottom edge');
        check(listBounds.width >= 178, label + ': detail panel leaves insufficient list space');
        const detailContent = panel().querySelector('.folder-detail-content');
        const heading = panel().querySelector('.detail-heading');
        const headingBounds = rect(heading);
        const infoBounds = rect(panel().querySelector('.detail-info-card'));
        const detailBounds = rect(detailContent);
        const detailStyle = getComputedStyle(detailContent);
        const headerWidth = detailContent.clientWidth - parseFloat(detailStyle.paddingLeft) - parseFloat(detailStyle.paddingRight);
        const expectedCoverWidth = Math.min(180, Math.max(136, headerWidth * 0.44)) - 10;
        check(near(coverBounds.width, expectedCoverWidth), label + ': right cover must be 10px narrower than its previous width');
        check(near(headingBounds.top, coverBounds.top), label + ': title and tags must start alongside the cover');
        check(headingBounds.left >= coverBounds.right, label + ': detail heading must stay to the right of the cover');
        check(infoBounds.top >= Math.max(coverBounds.bottom, headingBounds.bottom), label + ': metadata fields must stay below the cover and heading');
        check(near(infoBounds.left, coverBounds.left) && near(infoBounds.right, headingBounds.right), label + ': metadata fields must span both header columns');
        const caption = panel().querySelector('.detail-cover-caption');
        const captionBounds = rect(caption);
        check(captionBounds.top >= infoBounds.bottom, label + ': the cover caption must follow the metadata card');
        check(near(captionBounds.left, infoBounds.left) && near(captionBounds.right, infoBounds.right), label + ': the cover caption must span the metadata card width');
        check(getComputedStyle(caption).textAlign === 'center', label + ': the cover caption must be centered');
        check(heading.textContent.includes(book.series) && heading.textContent.includes(book.title), label + ': the header must include the series and title');
        check(heading.textContent.includes('사이버펑크') && heading.textContent.includes('LongUnbrokenMetadataTagForOverflowVerification'), label + ': the header must include genres and tags');
        check(headingBounds.right <= detailBounds.right + 1, label + ': the heading escapes the detail content');
        check(detailContent.scrollWidth <= detailContent.clientWidth + 1, label + ': the detail heading creates horizontal overflow');
        const footer = panel().querySelector('.detail-panel-layer:not(.is-outgoing) .detail-panel-footer');
        const footerBounds = rect(footer);
        const scrollBounds = rect(panel().querySelector('.folder-detail-scroll'));
        check(near(footerBounds.bottom, panelBounds.bottom), label + ': reading controls must stay at the detail panel bottom');
        check(scrollBounds.bottom <= footerBounds.top + 1, label + ': scrolling details must not extend behind the reading controls');
        check(footer.querySelector('.detail-open-button') && footer.querySelector('.detail-more-button'), label + ': the fixed footer needs reading and more buttons');
    } else {
        check(listBounds.bottom <= panelBounds.top, label + ': list overlaps the bottom detail panel');
        check(near(listBounds.left, panelBounds.left) && near(listBounds.right, panelBounds.right), label + ': bottom detail panel must span the list width');
    }
    check(panelBounds.right <= contentBounds.right + 1 && panelBounds.bottom <= contentBounds.bottom + 1, label + ': detail panel escapes its content area');
    check(content().scrollWidth <= content().clientWidth + 1, label + ': content area overflows horizontally');
    check(content().scrollHeight <= content().clientHeight + 1, label + ': content area overflows vertically');
}
const detailSize = position => rect(panel())[position === 'right' ? 'width' : 'height'];
async function waitForIntermediateSize(position, expandedSize, label) {
    await until(() => panel().hidden || (detailSize(position) > 2 && detailSize(position) < expandedSize - 2), label + ': no intermediate panel size was rendered');
    check(!panel().hidden && detailSize(position) > 2 && detailSize(position) < expandedSize - 2, label + ': panel skipped the size animation');
    return detailSize(position);
}
async function waitForExpandedSize(position, expandedSize, label) {
    try {
        await until(() => !panel().hidden && toggle().getAttribute('aria-expanded') === 'true' && near(detailSize(position), expandedSize), label + ': panel did not reach its saved size');
    } catch (error) {
        throw new Error(error.message + ': ' + JSON.stringify({ expectedSize: expandedSize, actualSize: detailSize(position), hidden: panel().hidden, style: panel().getAttribute('style') }));
    }
    await frame();
    await frame();
    check(panel().getAttribute('aria-hidden') !== 'true' && !panel().inert, label + ': expanded details remain inaccessible');
}
async function collapsePanel(position, preference, expandedSize) {
    const label = preference + ' ' + position + ' collapse';
    clickVisibleButton(toggle());
    await until(() => toggle().getAttribute('aria-expanded') === 'false', label + ': toggle did not change state');
    let intermediateSize = 0;
    if (preference === 'full') {
        check(!panel().hidden, label + ': details were hidden before the closing animation');
        check(panel().getAttribute('aria-hidden') === 'true' && panel().inert, label + ': closing details must stop receiving interaction immediately');
        check(panel().textContent.includes(book.title), label + ': closing animation removed the detail content too early');
        intermediateSize = await waitForIntermediateSize(position, expandedSize, label);
    } else {
        check(panel().hidden && detailSize(position) === 0, label + ': reduced motion must collapse immediately');
    }
    await until(() => panel().hidden, label + ': details did not become hidden after closing');
    return intermediateSize;
}
async function expandPanel(position, preference, expandedSize) {
    const label = preference + ' ' + position + ' expand';
    clickVisibleButton(toggle());
    await until(() => toggle().getAttribute('aria-expanded') === 'true' && !panel().hidden, label + ': details did not begin opening');
    const intermediateSize = preference === 'full'
        ? await waitForIntermediateSize(position, expandedSize, label)
        : detailSize(position);
    if (preference === 'reduced') check(near(intermediateSize, expandedSize), label + ': reduced motion must expand immediately');
    await waitForExpandedSize(position, expandedSize, label);
    return intermediateSize;
}
async function verifyInterruptedDisclosure(position, expandedSize) {
    clickVisibleButton(toggle());
    await until(() => toggle().getAttribute('aria-expanded') === 'false', position + ': interrupted close did not start');
    await waitForIntermediateSize(position, expandedSize, position + ' rapid reverse');
    clickVisibleButton(toggle());
    await waitForExpandedSize(position, expandedSize, position + ' rapid reverse');
    check(document.activeElement === toggle(), position + ': reversing the animation lost toggle focus');
    clickVisibleButton(toggle());
    await until(() => toggle().getAttribute('aria-expanded') === 'false', position + ': reduced-motion interruption did not start');
    await waitForIntermediateSize(position, expandedSize, position + ' closing motion change');
    applyMotionPreference('reduced');
    await frame();
    await frame();
    check(panel().hidden && detailSize(position) === 0, position + ': reducing motion did not finish the closing animation immediately');
    await expandPanel(position, 'reduced', expandedSize);
    applyMotionPreference('full');
    await frame();
    await collapsePanel(position, 'full', expandedSize);
    clickVisibleButton(toggle());
    await until(() => toggle().getAttribute('aria-expanded') === 'true' && !panel().hidden, position + ': interrupted open did not start');
    await waitForIntermediateSize(position, expandedSize, position + ' opening motion change');
    applyMotionPreference('reduced');
    await frame();
    await frame();
    check(!panel().hidden && near(detailSize(position), expandedSize) && !panel().inert, position + ': reducing motion did not finish the opening animation immediately');
    applyMotionPreference('full');
    await frame();
}
window.runFolderDetailPositionTests = async () => {
    const measurements = [];
    for (const preference of ['full', 'reduced']) {
        applyMotionPreference(preference);
        await resizeWindow(1200, 800);
        await mount({ libraries: [], folder_view_mode: 'table', folder_last_path: '/fixture', folder_detail_panel_height: 245 });
        await verifyButtons('bottom', preference);
        verifyLayout('bottom', preference + ' default');
        const footerHeight = rect(document.querySelector('.right-bottom-bar')).height;
        const panelToggle = toggle();
        const bottomHeight = detailSize('bottom');
        const bottomClosingSize = await collapsePanel('bottom', preference, bottomHeight);
        check(toggle() === panelToggle, 'Collapsing bottom details replaced the toggle element');
        check(document.activeElement === toggle(), 'Collapsing bottom details lost keyboard focus');
        await verifyButtons('bottom', preference + ' collapsed');
        const bottomOpeningSize = await expandPanel('bottom', preference, bottomHeight);
        check(toggle() === panelToggle, 'Expanding bottom details replaced the toggle element');
        check(document.activeElement === toggle(), 'Expanding bottom details lost keyboard focus');
        verifyLayout('bottom', preference + ' expanded');
        if (preference === 'full') await verifyInterruptedDisclosure('bottom', bottomHeight);
        if (preference === 'reduced') await capture('bottom-wide');
        await setPosition('right');
        await verifyButtons('right', preference);
        verifyLayout('right', preference + ' right');
        check(saves.some(patch => patch.folder_detail_panel_position === 'right'), 'Right placement was not saved');
        const originalWidth = rect(panel()).width;
        const listWidth = rect(list()).width;
        const rightClosingSize = await collapsePanel('right', preference, originalWidth);
        check(toggle() === panelToggle, 'Collapsing right details replaced the toggle element');
        check(document.activeElement === toggle(), 'Collapsing right details lost keyboard focus');
        await verifyButtons('right', preference + ' collapsed');
        check(rect(list()).width > listWidth + originalWidth - 4, 'Collapsed right details did not return their width to the list');
        check(rect(toggle()).width > 0 && rect(toggle()).height > 0, 'Collapsed details hide their expand control');
        const rightOpeningSize = await expandPanel('right', preference, originalWidth);
        check(toggle() === panelToggle, 'Expanding right details replaced the toggle element');
        check(document.activeElement === toggle(), 'Expanding right details lost keyboard focus');
        verifyLayout('right', preference + ' expanded');
        check(near(rect(panel()).width, originalWidth), 'Expanding right details lost their width');
        if (preference === 'full') await verifyInterruptedDisclosure('right', originalWidth);
        const separator = document.querySelector('.folder-detail-resizer-row.is-right [role="separator"]');
        check(separator?.getAttribute('aria-orientation') === 'vertical', 'Right details need a vertical resize separator');
        const start = rect(separator);
        separator.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: start.x + start.width / 2, clientY: start.y + 100 }));
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: start.x + start.width / 2 - 72, clientY: start.y + 100 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: start.x + start.width / 2 - 72, clientY: start.y + 100 }));
        await until(() => persisted.folder_detail_panel_width > originalWidth + 60, 'Dragging right details did not save a larger width');
        const savedWidth = persisted.folder_detail_panel_width;
        await until(() => near(rect(panel()).width, savedWidth), 'Dragged width was not rendered');
        check(!document.body.classList.contains('is-resizing-panel'), 'Resizing left the page in drag mode');
        await setPosition('bottom');
        await until(() => near(rect(panel()).height, bottomHeight), 'Switching back to bottom lost the saved bottom height');
        verifyLayout('bottom', preference + ' returned');
        check(persisted.folder_detail_panel_position === 'bottom', 'Bottom placement was not saved');
        await setPosition('right');
        await mount({ ...persisted });
        await verifyButtons('right', preference + ' restored');
        verifyLayout('right', preference + ' restored');
        check(near(rect(panel()).width, savedWidth), 'Remounting did not restore the saved width');
        if (preference === 'reduced') await verifyCoverPreview();
        if (preference === 'reduced') await capture('right-wide');
        await resizeWindow(760, 650);
        await until(() => rect(panel()).width < savedWidth - 20, 'Shrinking the window did not constrain the right panel width');
        verifyLayout('right', preference + ' narrow');
        await verifyButtons('right', preference + ' narrow');
        check(near(rect(document.querySelector('.right-bottom-bar')).height, footerHeight), 'Narrow controls must not add rows to the bottom bar');
        const scroll = panel().querySelector('.folder-detail-scroll');
        check(scroll.scrollHeight > scroll.clientHeight + 100, 'Long metadata must overflow inside the detail scroll area');
        const footer = panel().querySelector('.detail-panel-layer:not(.is-outgoing) .detail-panel-footer');
        const fixedControls = [footer, footer.querySelector('.detail-open-button'), footer.querySelector('.detail-more-button')];
        const initialControlBounds = fixedControls.map(rect);
        const verifyFixedControls = () => {
            for (const [index, control] of fixedControls.entries()) {
                const bounds = rect(control);
                check(near(bounds.top, initialControlBounds[index].top) && near(bounds.bottom, initialControlBounds[index].bottom), 'Right reading controls moved while scrolling details');
            }
        };
        scroll.scrollTop = scroll.scrollHeight;
        await frame();
        check(scroll.scrollTop > 100, 'Long metadata cannot be scrolled');
        verifyFixedControls();
        check(scroll.scrollWidth <= scroll.clientWidth + 1, 'Long metadata creates horizontal detail overflow');
        check(persisted.folder_detail_panel_width === savedWidth, 'A temporary window resize overwrote the saved panel width');
        measurements.push({ preference, bottomHeight, savedWidth, narrowWidth: rect(panel()).width, scrollTop: scroll.scrollTop,
            bottomClosingSize, bottomOpeningSize, rightClosingSize, rightOpeningSize });
        if (preference === 'reduced') await capture('right-narrow-scrolled');
        scroll.scrollTop = 0;
        await frame();
        verifyFixedControls();
        if (preference === 'reduced') await capture('right-narrow');
        await resizeWindow(1200, 800);
        await until(() => near(rect(panel()).width, savedWidth), 'Growing the window did not restore the saved panel width');
    }
    root.unmount();
    return measurements;
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
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1200, height: 800, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', async (_event, level, message) => {
        if (level >= 2) console.error(message);
        if (message === 'FOLDER_DETAIL_RESIZE') {
            const { width, height } = await window.webContents.executeJavaScript('window.detailResizeRequest');
            window.setContentSize(width, height);
            await window.webContents.executeJavaScript('window.continueDetailResize()');
        }
        if (message === 'FOLDER_DETAIL_KEY') {
            const request = await window.webContents.executeJavaScript('window.detailKeyRequest');
            window.webContents.focus();
            window.webContents.sendInputEvent({ type: 'keyDown', ...request });
            if (request.keyCode === 'Enter' || request.keyCode === 'Space') {
                window.webContents.sendInputEvent({ type: 'char', ...request });
            }
            window.webContents.sendInputEvent({ type: 'keyUp', ...request });
            await window.webContents.executeJavaScript('window.continueDetailKey()');
        }
        if (message === 'FOLDER_DETAIL_CAPTURE') {
            const screenshot = await window.webContents.capturePage();
            const name = await window.webContents.executeJavaScript('window.detailCaptureName');
            const path = require('node:path');
            const target = path.parse(${JSON.stringify(process.env.BOOKMANAGER_DETAIL_SCREENSHOT || '/tmp/bookmanager-folder-detail.png')});
            require('node:fs').writeFileSync(path.join(target.dir, target.name + '-' + name + target.ext), screenshot.toPNG());
            await window.webContents.executeJavaScript('window.continueDetailCapture()');
        }
    });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runFolderDetailPositionTests()');
    console.log('FOLDER_DETAIL_POSITION_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Folder detail position renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/FOLDER_DETAIL_POSITION_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        const measurements = JSON.parse(payload);
        assert.deepEqual(measurements.map(item => item.preference), ['full', 'reduced']);
        for (const measurement of measurements) t.diagnostic(JSON.stringify(measurement));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
