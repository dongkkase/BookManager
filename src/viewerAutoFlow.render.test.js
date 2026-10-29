import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('자동 보기는 창 크기 변경 후에도 선택과 읽기 위치를 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-auto-flow-')));
    let server;
    try {
        const objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] /Count 6 >>',
            ...Array.from({ length: 6 }, (_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${index === 3 ? '900 600' : '480 700'}] /Resources << >> >>`),
        ];
        let pdf = '%PDF-1.4\n';
        const offsets = [0];
        objects.forEach((object, index) => {
            offsets.push(Buffer.byteLength(pdf));
            pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
        });
        const xref = Buffer.byteLength(pdf);
        pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
        pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
        pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        await fs.writeFile(path.join(directory, 'fixture.pdf'), pdf);
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { for (let index = 0; index < 8; index += 1) await frame(); };
async function until(predicate, message) {
    const deadline = performance.now() + 12000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message + ': ' + document.body.innerText.slice(0, 400));
}
const pages = Array.from({ length: 8 }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = index === 3 ? 960 : 480;
    canvas.height = 700;
    const context = canvas.getContext('2d');
    context.fillStyle = ['#487c99', '#399d70', '#b78944'][index % 3];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.font = '90px sans-serif';
    context.fillText(String(index + 1), 180, 360);
    const pageUrl = canvas.toDataURL();
    return { index, name: index + '.png', width: canvas.width, height: canvas.height, pageUrl, size: 512 * 1024 };
});
const webtoonPages = Array.from({ length: 7 }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = index === 0 ? 350 : 1200;
    const context = canvas.getContext('2d');
    context.fillStyle = index % 2 ? '#399d70' : '#487c99';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.font = '32px sans-serif';
    context.fillText(String(index + 1), 100, 180);
    const pageUrl = canvas.toDataURL();
    return { index, name: index + '.png', width: canvas.width, height: canvas.height, pageUrl, size: atob(pageUrl.split(',')[1]).length };
});
const mixedWidthSources = Object.fromEntries(Object.entries({
    regular: [[750, 1000], [530, 1234], [900, 1600]],
    large: [[1200, 1600], [900, 1234], [1500, 2200]],
    delayed: [[1200, 1000], [530, 1234], [900, 1600]],
}).map(([kind, dimensions]) => [kind, dimensions.map(([width, height], index) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = ['#487c99', '#399d70', '#b78944'][index];
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fff';
    context.font = '72px sans-serif';
    context.fillText(width + '×' + height, 35, 120);
    const pageUrl = canvas.toDataURL();
    return { name: index + '.png', pageUrl, size: atob(pageUrl.split(',')[1]).length };
})]));
const shortVariableMetrics = [
    [580, 837, 376111], [690, 2252, 131708], [690, 1972, 100952],
    [690, 2000, 147937], [690, 1346, 99270], [690, 2156, 183892],
    [690, 1892, 160007], [690, 2312, 175914], [690, 1534, 72157],
    [690, 2180, 140573], [690, 2508, 135851], [690, 1728, 94247],
    [690, 1551, 84867], [690, 2248, 114269], [690, 2216, 142663],
    [690, 540, 16014], [1200, 1200, 522525],
];
const shortVariablePages = shortVariableMetrics.map(([width, height, size], index) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = ['#487c99', '#399d70', '#b78944'][index % 3];
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fff';
    context.font = '48px sans-serif';
    context.fillText('Page ' + (index + 1), 40, 180);
    return { index, name: String(index).padStart(4, '0') + '.png', size, pageUrl: canvas.toDataURL() };
});
window.useComicProtocol = false;
window.protocolPageFixtures = () => [['comic', pages], ['webtoon', webtoonPages], ['short-variable', shortVariablePages], ...Object.entries(mixedWidthSources).map(([kind, items]) => ['mixed-' + kind, items])].flatMap(([kind, items]) => items.map(page => ({ path: '/' + kind + '/' + page.name, base64: page.pageUrl.split(',')[1] })));
const mixedWidthPages = kind => Array.from({ length: 20 }, (_, index) => {
    const sourceKind = kind === 'ordinary' ? 'regular' : kind;
    const sourceIndex = kind === 'delayed' && index > 0 ? 1 + (index % 2) : index % 3;
    const source = mixedWidthSources[sourceKind][sourceIndex];
    return { index, name: 'mixed-' + index + '.png', size: kind === 'ordinary' ? 512 * 1024 : source.size, pageUrl: 'bookmanager-comic://fixture/mixed-' + sourceKind + '/' + source.name };
});
const listComicPages = id => {
    const kind = id.startsWith('webtoon-') ? 'webtoon' : 'comic';
    const items = kind === 'webtoon' ? webtoonPages : pages;
    return window.useComicProtocol ? items.map(page => ({ ...page, pageUrl: 'bookmanager-comic://fixture/' + kind + '/' + page.name })) : items;
};
const sizedArchivePages = (count, size, extraBytes = 0) => Array.from({ length: count }, (_, index) => ({
    ...listComicPages('comic')[index % pages.length],
    index,
    name: 'sized-' + index + '.png',
    size: size + (index === 0 ? extraBytes : 0),
}));
const text = Array.from({ length: 160 }, (_, paragraph) => Array.from({ length: 14 }, (_, sentence) => '문단' + paragraph + '문장' + sentence + ' 읽던 내용을 유지합니다.').join(' ')).join('\\n\\n');
let loadSession;
let currentType;
let savedAnchor = '';
let selectedIndex = 0;
let mount = 0;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getConfig: async () => ({ language: 'ko', motion_preference: 'reduced' }),
    listComicPages: async id => {
        if (id === 'format-webtoon-only') return { pages: listComicPages('comic'), format: 'Webtoon', readingDirection: 'ltr' };
        if (id.startsWith('direction-webtoon-')) return { pages: listComicPages('comic'), format: 'GraphicNovel', readingDirection: 'webtoon' };
        if (id === 'short-variable-pages') return { pages: shortVariablePages.map(page => ({ ...page, pageUrl: 'bookmanager-comic://fixture/short-variable/' + page.name })) };
        if (id.startsWith('mixed-width-')) return { pages: mixedWidthPages(id.slice('mixed-width-'.length)) };
        if (id.startsWith('archive-small')) return { pages: sizedArchivePages(20, 90 * 1024) };
        if (id === 'archive-threshold') return { pages: sizedArchivePages(20, 128 * 1024) };
        if (id === 'archive-above-threshold') return { pages: sizedArchivePages(20, 128 * 1024, 1) };
        if (id === 'archive-nineteen-pages') return { pages: sizedArchivePages(19, 90 * 1024) };
        return { pages: listComicPages(id) };
    },
    getText: async () => ({ text }),
    getEpubText: async () => ({ chapters: [{ name: 'chapter.xhtml', title: 'Chapter', text }], toc: [], fonts: [] }),
    getDocumentData: async () => ({ documentUrl: '/fixture.pdf' }),
    listBundledFonts: async () => [],
    listSystemFonts: async () => [],
};
const root = createRoot(document.getElementById('root'));
const button = label => [...document.querySelectorAll('.viewer-toolbar button')].find(node => node.dataset.tooltip?.startsWith(label));
const stage = () => document.querySelector('.viewer-comic-stage, .viewer-pdf-stage, .viewer-reader-stage');
const activeLayer = () => stage()?.querySelector('.viewer-page-transition-layer:not([aria-hidden="true"])');
const indexes = () => [...(activeLayer()?.querySelectorAll('[data-page-index], [data-pdf-page-index], [data-reader-page-index]') || [])].map(node => Number(node.dataset.pageIndex ?? node.dataset.pdfPageIndex ?? node.dataset.readerPageIndex));
const pageBodyText = node => {
    const clone = node?.cloneNode(true);
    clone?.querySelectorAll('h2').forEach(heading => heading.remove());
    return clone?.textContent.replace(/\\s/g, '') || '';
};
const bodyText = () => [...(activeLayer()?.querySelectorAll('.viewer-reader-page-body') || [])].map(pageBodyText).join('');
const firstBodyText = () => pageBodyText(activeLayer()?.querySelector('.viewer-reader-page-body'));
const prefs = () => JSON.parse(localStorage.getItem('bookmanager-viewer-prefs:' + currentType) || '{}');
const displayedZoom = () => Number.parseFloat(button('확대/축소')?.textContent || '');
const comicWidths = () => [...document.querySelectorAll('.viewer-comic-scroll .viewer-comic-image')].map(image => image.getBoundingClientRect().width).filter(width => width > 0);
async function expectIndexes(expected, label) {
    await until(() => !stage()?.classList.contains('has-page-effect') && JSON.stringify(indexes()) === JSON.stringify(expected), label + ': expected ' + expected);
}
async function expectLayout(spread, selection = 'auto') {
    await until(() => stage() && stage().classList.contains('is-spread') === spread && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), currentType + ': incorrect layout');
    await settle();
    check(button(selection === 'auto' ? '자동 보기' : '한장보기')?.classList.contains('is-active'), currentType + ': selected mode was lost');
    check(!button(selection === 'auto' ? '한장보기' : '자동 보기')?.classList.contains('is-active'), currentType + ': conflicting selected modes');
    await until(() => prefs().flowMode === selection, currentType + ': persisted mode was replaced by the resolved layout');
}
window.startAutoFlow = async ({ type, pageEffect = 'none', bookmarkedPage }) => {
    currentType = type;
    localStorage.clear();
    localStorage.setItem('bookmanager-viewer-prefs:' + type, JSON.stringify({ flowMode: 'auto', spreadCoverFirst: true, slideNavOpen: false, readerSettings: { pageEffect } }));
    loadSession = null;
    mount += 1;
    root.render(<ViewerApp key={mount} />);
    await until(() => loadSession, 'Missing session listener');
    if (Number.isInteger(bookmarkedPage)) localStorage.setItem('bookmanager-viewer-bookmarks:/fixture/' + type + mount, JSON.stringify([{ id: 'second-page', pageIndex: bookmarkedPage, flowMode: 'auto', label: 'Second page', createdAt: 'fixture' }]));
    await loadSession({ id: type + '-' + mount, type, filePath: '/fixture/' + type + mount, fileName: 'Auto flow fixture', preview: true });
    await expectLayout(true);
    if (pageEffect === 'page') return;
    if (type === 'comic') {
        await expectIndexes([0], 'Cover must appear alone');
        button('다음장').click();
        await expectIndexes([1, 2], 'Portrait pages must form a spread');
        button('다음장').click();
        await expectIndexes([3], 'Landscape page must appear alone');
        button('다음장').click();
        await expectIndexes([4, 5], 'Pages after a landscape page must form a spread');
        button('이전장').click();
        await expectIndexes([3], 'Backward navigation must visit the landscape page');
        button('이전장').click();
        await expectIndexes([1, 2], 'Backward navigation must return to the preceding spread');
        button('처음으로').click();
        await expectIndexes([0], 'Jumping to the cover must reset the selected page');
        button('다음장').click();
        await expectIndexes([1, 2], 'Forward navigation must select the first page of the spread');
    } else {
        button('다음장').click();
        await until(() => indexes()[0] >= 2 && !stage()?.classList.contains('has-page-effect'), type + ': next spread failed');
    }
    savedAnchor = firstBodyText().slice(0, 45);
    selectedIndex = indexes()[0];
};
window.checkNarrowAutoFlow = async ({ pageEffect = 'none', navigate = true } = {}) => {
    await expectLayout(false);
    if (pageEffect === 'page') return;
    if (currentType === 'comic' || currentType === 'pdf') await expectIndexes([selectedIndex], currentType + ': narrow layout changed the selected page');
    else check(bodyText().includes(savedAnchor), currentType + ': narrow layout lost the reading anchor ' + JSON.stringify({ navigate, savedAnchor, indexes: indexes(), visible: bodyText().slice(0, 180) }));
    if (navigate) {
        const previousIndex = indexes()[0];
        button('다음장').click();
        await until(() => indexes()[0] > previousIndex && !stage()?.classList.contains('has-page-effect'), currentType + ': single-page navigation failed');
        selectedIndex = indexes()[0];
        savedAnchor = firstBodyText().slice(0, 45);
    }
};
window.checkWideAutoFlow = async ({ pageEffect = 'none' } = {}) => {
    await expectLayout(true);
    if (pageEffect === 'page') return;
    if (currentType === 'comic' || currentType === 'pdf') check(indexes().includes(selectedIndex), currentType + ': wide layout lost the selected page');
    else check(bodyText().includes(savedAnchor), currentType + ': wide layout lost the reading anchor ' + JSON.stringify({ savedAnchor, indexes: indexes(), visible: bodyText().slice(0, 180) }));
};
window.chooseManualSingle = async () => {
    button('한장보기').click();
    await expectLayout(false, 'single');
};
window.checkManualSingle = async () => {
    await expectLayout(false, 'single');
    return currentType;
};
window.checkManualTextToAuto = async () => {
    await window.startAutoFlow({ type: 'text' });
    button('한장보기').click();
    await expectLayout(false, 'single');
    button('처음으로').click();
    await expectIndexes([0], 'Manual text must start at the first page');
    for (let index = 1; index <= 3; index += 1) {
        button('다음장').click();
        await expectIndexes([index], 'Manual text navigation');
    }
    savedAnchor = firstBodyText().slice(0, 45);
    button('자동 보기').click();
    await expectLayout(true);
    check(bodyText().includes(savedAnchor), 'Entering auto from manual text lost the reading position');
    return 'text-manual-to-auto';
};
window.selectReaderSecondPage = async ({ type }) => {
    await window.startAutoFlow({ type, bookmarkedPage: 1 });
    button('처음으로').click();
    await expectIndexes([0, 1], type + ': first spread was not selected');
    savedAnchor = pageBodyText(activeLayer().querySelectorAll('.viewer-reader-page-body')[1]).slice(0, 45);
    button('책갈피').click();
    await until(() => document.querySelector('.viewer-bookmark-list button'), 'Second-page bookmark missing');
    document.querySelector('.viewer-bookmark-list button').click();
    await until(() => !document.querySelector('.viewer-bookmark-list button'), 'Bookmark menu did not close');
    await expectIndexes([0, 1], type + ': selecting the second page changed its spread');
    await settle();
    check(bodyText().includes(savedAnchor), type + ': second-page bookmark lost its text');
};
window.checkPdfLandscape = async () => {
    await window.startAutoFlow({ type: 'pdf' });
    button('처음으로').click();
    await expectIndexes([0, 1], 'PDF first spread');
    button('다음장').click();
    await expectIndexes([2], 'PDF portrait before landscape must stand alone');
    button('다음장').click();
    await expectIndexes([3], 'PDF landscape must stand alone');
    button('다음장').click();
    await expectIndexes([4, 5], 'PDF portraits after landscape must form a spread');
    button('이전장').click();
    await expectIndexes([3], 'PDF previous navigation must visit landscape');
    button('이전장').click();
    await expectIndexes([2], 'PDF previous navigation must visit unpaired portrait');
    document.querySelector('.viewer-slide-toggle').click();
    const thumbs = () => [...document.querySelectorAll('.viewer-slide-thumb.is-pdf')];
    await until(() => thumbs().length === 4, 'PDF thumbnail grouping did not follow landscape pages');
    check(JSON.stringify(thumbs().map(node => node.lastElementChild.textContent)) === JSON.stringify(['1–2', '3', '4', '5–6']), 'PDF thumbnail page labels do not match visible spreads');
    thumbs()[2].click();
    await expectIndexes([3], 'PDF landscape thumbnail must select the landscape page');
    button('끝으로').click();
    await expectIndexes([4, 5], 'PDF End must use the final spread');
    check(button('끝으로').disabled, 'PDF End must stop at the final spread');
    button('처음으로').click();
    await expectIndexes([0, 1], 'PDF Home must use the first spread');
    await window.startAutoFlow({ type: 'pdf', pageEffect: 'page' });
    document.querySelector('.viewer-slide-toggle').click();
    await until(() => thumbs().length === 4, 'PDF book effect thumbnail grouping is incomplete');
    thumbs()[2].click();
    await until(() => stage()?.querySelectorAll('[data-source-page-index="3"][data-spread-segment]').length === 2, 'PDF landscape must fill both leaves with the book effect');
    check(button('자동 보기')?.classList.contains('is-active'), 'PDF book effect changed the selected auto mode');
    return 'pdf-landscape';
};
window.checkWebtoonAutoFlow = async () => {
    currentType = 'comic';
    localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({ flowMode: 'auto', spreadCoverFirst: true, slideNavOpen: false, readerSettings: { pageEffect: 'none' } }));
    const filePath = '/fixture/long-pages.cbz';
    localStorage.removeItem('bookmanager-viewer-bookmarks:' + filePath);
    localStorage.setItem('bookmanager-viewer-state:' + filePath, JSON.stringify({ pageIndex: 2, pageCount: 7, scrollPercent: 40 }));
    await loadSession({ id: 'webtoon-resume', type: 'comic', filePath, fileName: 'Long pages.cbz', preview: true });
    await until(() => document.querySelector('.viewer-comic-scroll') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), 'Tall comic pages were not classified as scroll');
    await until(() => {
        const content = document.querySelector('.viewer-content');
        const maximum = content.scrollHeight - content.clientHeight;
        return maximum > 0 && Math.abs(content.scrollTop / maximum - 0.4) < 0.02;
    }, 'Webtoon auto detection lost the saved scroll position');
    check(button('자동 보기')?.classList.contains('is-active'), 'Webtoon classification changed the selected auto mode');
    check(prefs().flowMode === 'auto', 'Webtoon classification persisted scroll instead of auto');
    await window.checkWebtoonWidthLimit({ reduced: true });
    button('책갈피').click();
    await until(() => document.querySelector('.viewer-bookmark-menu button'), 'Bookmark menu did not open');
    [...document.querySelectorAll('.viewer-bookmark-menu button')].find(node => node.textContent.startsWith('책갈피 추가')).click();
    await until(() => document.querySelector('.viewer-bookmark-list button'), 'Webtoon bookmark was not added');
    const bookmark = JSON.parse(localStorage.getItem('bookmanager-viewer-bookmarks:' + filePath))[0];
    check(bookmark.flowMode === 'auto' && Math.abs(bookmark.scrollPercent - 40) <= 1, 'Webtoon bookmark did not store the selected mode and scroll position');
    button('책갈피').click();
    button('한장보기').click();
    await expectLayout(false, 'single');
    check(!document.querySelector('.viewer-comic-scroll'), 'Webtoon classification overrides manual single mode');
    button('처음으로').click();
    await expectIndexes([0], 'Manual webtoon must navigate away before restoring its bookmark');
    button('책갈피').click();
    await until(() => document.querySelector('.viewer-bookmark-list button'), 'Saved webtoon bookmark missing');
    document.querySelector('.viewer-bookmark-list button').click();
    await until(() => {
        const content = document.querySelector('.viewer-content');
        const maximum = content.scrollHeight - content.clientHeight;
        return document.querySelector('.viewer-comic-scroll') && maximum > 0 && Math.abs(content.scrollTop / maximum - 0.4) < 0.02;
    }, 'Automatic flow restoration overwrote the webtoon bookmark scroll position');
    check(button('자동 보기')?.classList.contains('is-active'), 'Webtoon bookmark did not restore auto mode');
    button('한장보기').click();
    await expectLayout(false, 'single');
    button('자동 보기').click();
    await until(() => document.querySelector('.viewer-comic-scroll'), 'Returning to auto did not restore webtoon scrolling');
    await until(() => prefs().flowMode === 'auto', 'Returning to auto was not saved');
    await loadSession({ id: 'ordinary-after-webtoon', type: 'comic', filePath: '/fixture/ordinary-pages.cbz', fileName: 'Ordinary pages.cbz', preview: true });
    await expectLayout(true);
    await expectIndexes([0], 'New ordinary book inherited webtoon classification');
    check(!document.querySelector('.viewer-comic-scroll'), 'Webtoon classification leaked into the next book');
    check(displayedZoom() === 100 && prefs().zoom === 100, 'Automatic webtoon zoom reduction leaked into the next ordinary book');
    button('한장보기').click();
    await expectLayout(false, 'single');
    await loadSession({ id: 'webtoon-manual', type: 'comic', filePath: '/fixture/manual-long-pages.cbz', fileName: 'Manual long pages.cbz', preview: true });
    await expectLayout(false, 'single');
    check(!document.querySelector('.viewer-comic-scroll'), 'New webtoon ignored the saved manual mode');
    button('자동 보기').click();
    await until(() => document.querySelector('.viewer-comic-scroll'), 'Auto did not classify a webtoon opened in manual mode');
    return window.useComicProtocol ? 'webtoon-protocol' : 'webtoon-data';
};
window.checkArchiveSizeAutoFlow = async () => {
    currentType = 'comic';
    localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({ flowMode: 'auto', spreadCoverFirst: true, slideNavOpen: false, readerSettings: { pageEffect: 'none' } }));
    const originalFetch = window.fetch;
    let sampleRequests = 0;
    window.fetch = (input, ...args) => {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        if (url.startsWith('bookmanager-comic:')) sampleRequests += 1;
        return originalFetch.call(window, input, ...args);
    };
    const open = id => loadSession({ id, type: 'comic', filePath: '/fixture/' + id + '.cbz', fileName: 'Ordinary page images.cbz', preview: true });
    const expectAutoScroll = async label => {
        await until(() => document.querySelector('.viewer-comic-scroll') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), label);
        check(button('자동 보기')?.classList.contains('is-active'), label + ': auto mode was replaced');
        await until(() => prefs().flowMode === 'auto', label + ': selected mode was not persisted');
    };
    try {
        await open('archive-small-auto');
        await expectAutoScroll('Small archive must scroll even when its images look like ordinary pages');
        check(sampleRequests === 0, 'Archive size must be checked before fetching image samples');
        button('한장보기').click();
        await expectLayout(false, 'single');
        check(!document.querySelector('.viewer-comic-scroll'), 'Archive size overrides manual single mode');
        await open('archive-small-manual');
        await expectLayout(false, 'single');
        check(sampleRequests === 0, 'Opening a small archive in manual mode must not fetch classification samples');
        button('자동 보기').click();
        await expectAutoScroll('Archive size was lost when changing a manually opened book to auto');
        check(sampleRequests === 0, 'Changing to auto must retain the archive-size shortcut');
        await open('archive-threshold');
        await expectAutoScroll('Archive at the average-byte threshold must scroll');
        check(sampleRequests === 0, 'Threshold archive unexpectedly fetched classification samples');
        await open('archive-above-threshold');
        await expectLayout(true);
        check(!document.querySelector('.viewer-comic-scroll'), 'Archive above the size threshold must use image classification');
        check(sampleRequests > 0, 'Archive above the threshold must fall back to image samples');
        const previousSampleRequests = sampleRequests;
        await open('archive-nineteen-pages');
        await expectAutoScroll('Small average image size must enable scrolling without a minimum page count');
        check(sampleRequests === previousSampleRequests, 'A small archive with fewer than twenty images must not fetch classification samples');
        return 'archive-size';
    } finally {
        window.fetch = originalFetch;
    }
};
window.checkWebtoonReadingDirectionAutoFlow = async () => {
    currentType = 'comic';
    loadSession = null;
    mount += 1;
    root.render(<ViewerApp key={mount} />);
    await until(() => loadSession, 'Missing metadata webtoon fixture listener');
    localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({ flowMode: 'auto', viewMode: 'fit', zoom: 100, spreadCoverFirst: true, slideNavOpen: false, readerSettings: { pageEffect: 'none' } }));
    const originalFetch = window.fetch;
    let sampleRequests = 0;
    window.fetch = (input, ...args) => {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        if (url.startsWith('bookmanager-comic:')) sampleRequests += 1;
        return originalFetch.call(window, input, ...args);
    };
    const open = id => loadSession({ id, type: 'comic', filePath: '/fixture/' + id + '.cbz', fileName: 'Ordinary proportions.cbz', preview: true });
    const expectAutoScroll = async label => {
        await until(() => document.querySelector('.viewer-comic-scroll') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), label);
        await until(() => prefs().flowMode === 'auto', label + ': selected auto mode was not persisted');
        check(button('자동 보기')?.classList.contains('is-active'), label + ': selected auto mode was lost');
        await window.checkWebtoonWidthLimit({ reduced: true });
        check(sampleRequests === 0, label + ': webtoon reading direction must bypass image sample fetches');
    };
    const expectManual = async mode => {
        await until(() => stage() && stage().classList.contains('is-spread') === (mode === 'spread') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), 'Webtoon reading direction overrode manual ' + mode);
        await until(() => prefs().flowMode === mode, 'Manual ' + mode + ' was not persisted');
        await settle();
        check(!document.querySelector('.viewer-comic-scroll'), 'Webtoon reading direction forced scrolling in manual ' + mode);
        check(button(mode === 'spread' ? '두장보기' : '한장보기')?.classList.contains('is-active'), 'Selected manual ' + mode + ' was lost');
        check(prefs().readingDirection === 'ltr', 'Webtoon metadata must preserve a valid horizontal reading direction in manual mode');
        check(sampleRequests === 0, 'Manual metadata webtoon unexpectedly fetched classification samples');
    };
    try {
        check(pages.length === 8 && pages.every(page => page.size === 512 * 1024 && page.height / page.width < 2), 'Metadata fixture must require the explicit reading-direction shortcut');
        await open('format-webtoon-only');
        await expectLayout(true);
        check(!document.querySelector('.viewer-comic-scroll'), 'Webtoon format alone must not enable automatic scrolling');
        check(sampleRequests > 0, 'Webtoon format alone must still inspect ordinary image samples');
        sampleRequests = 0;
        await open('direction-webtoon-auto');
        await expectAutoScroll('Webtoon reading direction must select scroll even with GraphicNovel format and ordinary image proportions');
        for (const mode of ['single', 'spread']) {
            button(mode === 'spread' ? '두장보기' : '한장보기').click();
            await expectManual(mode);
            await open('direction-webtoon-manual-' + mode);
            await expectManual(mode);
            button('자동 보기').click();
            await expectAutoScroll('Metadata must remain available when returning from manual ' + mode + ' to auto');
        }
        await open('direction-ordinary-after-webtoon');
        await expectLayout(true);
        await expectIndexes([0], 'Next ordinary book must return to its cover');
        check(!document.querySelector('.viewer-comic-scroll'), 'Webtoon reading direction leaked into the next ordinary book');
        check(sampleRequests > 0, 'Next ordinary book must run its own image classification');
        check(displayedZoom() === 100 && prefs().zoom === 100, 'Metadata webtoon zoom reduction leaked into the next ordinary book');
        return 'webtoon-reading-direction';
    } finally {
        window.fetch = originalFetch;
    }
};
window.prepareWebtoonWidthLimit = async ({ viewMode = 'fit' } = {}) => {
    currentType = 'comic';
    loadSession = null;
    mount += 1;
    root.render(<ViewerApp key={mount} />);
    await until(() => loadSession, 'Missing fresh session listener for width-limit fixture');
    localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({ flowMode: 'auto', viewMode, zoom: 100, slideNavOpen: false, readerSettings: { pageEffect: 'none' } }));
    await loadSession({ id: 'webtoon-width-' + innerWidth + '-' + viewMode, type: 'comic', filePath: '/fixture/webtoon-width-' + viewMode + '.cbz', fileName: 'Webtoon width', preview: true });
    await until(() => document.querySelector('.viewer-comic-scroll') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), 'Width-limit webtoon is not ready');
};
window.checkWebtoonWidthLimit = async ({ reduced }) => {
    await until(() => {
        const widths = comicWidths();
        return widths.length > 0 && Math.max(...widths) <= 800.5
            && (reduced ? displayedZoom() > 0 && displayedZoom() < 100 : displayedZoom() === 100)
            && prefs().zoom === 100;
    }, 'Auto webtoon must cap displayed width at 800px by updating the actual zoom: ' + JSON.stringify({ reduced, viewport: innerWidth, viewMode: prefs().viewMode, zoom: displayedZoom(), savedZoom: prefs().zoom, widths: comicWidths() }));
    await settle();
    check(Math.max(...comicWidths()) <= 800.5, 'Auto webtoon expanded beyond the width limit after settling');
    check(prefs().zoom === 100, 'Automatic reduction must preserve the saved user zoom');
    if (!reduced) check(displayedZoom() === 100 && prefs().zoom === 100, 'Webtoon already below 800px must retain 100% zoom');
};
window.resetWebtoonZoomManually = async () => {
    button('확대/축소').click();
    await until(() => document.querySelector('.viewer-zoom-reset'), 'Zoom reset is unavailable');
    document.querySelector('.viewer-zoom-reset').click();
    await until(() => displayedZoom() === 100 && prefs().zoom === 100, 'Manual zoom reset was overwritten');
    button('확대/축소').click();
    await until(() => !document.querySelector('.viewer-zoom-menu'), 'Zoom menu did not close after manual reset');
};
window.checkManualWebtoonZoom = async () => {
    await settle();
    await until(() => comicWidths().some(width => width > 800), 'Explicit manual zoom must be allowed above 800px');
    check(displayedZoom() === 100 && prefs().zoom === 100, 'Resizing must preserve the manually selected webtoon zoom');
};
const webtoonCenterPosition = () => {
    const content = document.querySelector('.viewer-content');
    const centerY = content.getBoundingClientRect().top + content.clientHeight / 2;
    for (const image of document.querySelectorAll('.viewer-comic-scroll .viewer-comic-image')) {
        const rect = image.getBoundingClientRect();
        if (!image.complete || rect.height <= 0 || centerY < rect.top || centerY >= rect.bottom) continue;
        return { index: Number(image.closest('[data-page-index]').dataset.pageIndex), ratioY: (centerY - rect.top) / rect.height, height: rect.height, centerY, top: rect.top };
    }
    return null;
};
let webtoonCenterBeforeResize = null;
window.captureWebtoonResizePosition = async () => {
    const content = document.querySelector('.viewer-content');
    content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 0 }));
    content.scrollTop = (content.scrollHeight - content.clientHeight) * 0.4;
    await settle();
    await until(() => webtoonCenterPosition(), 'No loaded webtoon image at the viewport center');
    check(Math.abs(content.scrollTop / (content.scrollHeight - content.clientHeight) - 0.4) < 0.01, 'Webtoon resize fixture did not reach the middle of the document');
    webtoonCenterBeforeResize = webtoonCenterPosition();
    check(webtoonCenterBeforeResize.index > 0, 'Webtoon resize fixture must inspect body content after the cover');
};
window.checkWebtoonResizePosition = async () => {
    await window.checkWebtoonWidthLimit({ reduced: true });
    await settle();
    const after = webtoonCenterPosition();
    const before = webtoonCenterBeforeResize;
    const errorPixels = after ? Math.abs(after.ratioY - before.ratioY) * after.height : Infinity;
    check(after?.index === before.index && errorPixels <= 1.1, 'Automatic width reduction moved the reading position: ' + JSON.stringify({ before, after, errorPixels }));
    return { pageIndex: after.index, beforeRatioY: before.ratioY, afterRatioY: after.ratioY, errorPixels };
};
window.checkOrdinaryComicZoom = async () => {
    await loadSession({ id: 'ordinary-width-check', type: 'comic', filePath: '/fixture/ordinary-width.cbz', fileName: 'Ordinary width', preview: true });
    await expectLayout(true);
    check(displayedZoom() === 100 && prefs().zoom === 100, 'Webtoon width limiting must not reduce ordinary comic zoom');
};
const loadedMixedImages = () => [...document.querySelectorAll('.viewer-comic-scroll .viewer-comic-image')].filter(image => image.complete && image.naturalWidth > 0);
async function expectMixedWidth(expectedWidth, expectedZoom, savedZoom = expectedZoom) {
    await until(() => {
        const images = loadedMixedImages();
        return images.length === 20 && images.every(image => Math.abs(image.getBoundingClientRect().width - expectedWidth) <= 1.1)
            && (expectedZoom === null ? displayedZoom() < 100 : displayedZoom() === expectedZoom);
    }, 'Mixed-width webtoon did not settle to its shared width: ' + JSON.stringify({ expectedWidth, expectedZoom, zoom: displayedZoom(), widths: comicWidths() }));
    await settle();
    const images = loadedMixedImages();
    const widths = images.map(image => image.getBoundingClientRect().width);
    check(Math.max(...widths) - Math.min(...widths) <= 0.05, 'Mixed-width webtoon pages must have identical displayed widths');
    for (const image of images) {
        const rect = image.getBoundingClientRect();
        const expectedHeight = rect.width * image.naturalHeight / image.naturalWidth;
        check(Math.abs(rect.height - expectedHeight) <= 1.1, 'Shared width changed the original aspect ratio: ' + JSON.stringify({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: rect.width, height: rect.height, expectedHeight }));
    }
    check(prefs().zoom === savedZoom, 'Shared-width auto reduction changed the saved user zoom');
}
window.checkMixedWebtoonWidths = async () => {
    currentType = 'comic';
    const open = kind => loadSession({ id: 'mixed-width-' + kind, type: 'comic', filePath: '/fixture/mixed-width-' + kind + '.cbz', fileName: 'Mixed-width fixture', preview: true });
    const fresh = async kind => {
        loadSession = null;
        mount += 1;
        root.render(<ViewerApp key={mount} />);
        await until(() => loadSession, 'Missing mixed-width fixture listener');
        localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({ flowMode: 'auto', viewMode: 'actual', zoom: 100, spreadCoverFirst: true, slideNavOpen: false, readerSettings: { pageEffect: 'none' } }));
        await open(kind);
    };
    await fresh('regular');
    await expectMixedWidth(530, 100);
    for (let index = 0; index < 10; index += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
        await frame();
    }
    await expectMixedWidth(795, 150);
    await open('ordinary');
    await expectLayout(true);
    await until(() => stage()?.querySelector('.viewer-comic-image')?.naturalWidth === 750, 'Ordinary cover image is not ready');
    const ordinaryWidth = stage().querySelector('.viewer-comic-image').getBoundingClientRect().width;
    check(Math.abs(ordinaryWidth - 1125) <= 1.1 && displayedZoom() === 150, 'Shared webtoon width leaked into an ordinary comic: ' + ordinaryWidth);
    await fresh('delayed');
    const trace = [];
    const deadline = performance.now() + 12000;
    while (loadedMixedImages().length < 20 && performance.now() < deadline) {
        const snapshot = { loaded: loadedMixedImages().length, zoom: displayedZoom(), widths: [...new Set(comicWidths())] };
        if (snapshot.loaded > 0 && JSON.stringify(snapshot) !== JSON.stringify(trace.at(-1))) trace.push(snapshot);
        await frame();
    }
    await expectMixedWidth(530, 100);
    check(trace.some(snapshot => snapshot.loaded === 1), 'Delayed fixture must load the 1200px cover before body images');
    await open('large');
    await expectMixedWidth(800, null, 100);
    check(Math.max(...comicWidths()) <= 800.5, 'Mixed-width webtoon wider than 800px was not capped');
    return { delayedTrace: trace, finalLargeWidth: Math.max(...comicWidths()), finalLargeZoom: displayedZoom() };
};
window.checkShortVariableWebtoon = async () => {
    currentType = 'comic';
    loadSession = null;
    mount += 1;
    root.render(<ViewerApp key={mount} />);
    await until(() => loadSession, 'Missing short variable-page fixture listener');
    localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({ flowMode: 'auto', viewMode: 'fit', zoom: 100, slideNavOpen: false, readerSettings: { pageEffect: 'none' } }));
    const totalEncodedBytes = shortVariablePages.reduce((sum, page) => sum + page.size, 0);
    check(shortVariablePages.length === 17 && totalEncodedBytes === 2698957, 'Variable-page fixture must preserve the original entry size metadata');
    check(totalEncodedBytes / shortVariablePages.length > 128 * 1024, 'Variable-page fixture must not take the small-file shortcut');
    const requestedSamples = [];
    const originalFetch = window.fetch;
    window.fetch = (input, ...args) => {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        if (url.startsWith('bookmanager-comic://fixture/short-variable/')) requestedSamples.push(url);
        return originalFetch.call(window, input, ...args);
    };
    try {
        await loadSession({ id: 'short-variable-pages', type: 'comic', filePath: '/fixture/short-variable-pages.zip', fileName: 'Variable page proportions.zip', preview: true });
        await until(() => document.querySelector('.viewer-comic-scroll') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), 'Seventeen pages with ratio changes in one sampled region must automatically scroll');
        await window.checkWebtoonWidthLimit({ reduced: true });
        check(button('자동 보기')?.classList.contains('is-active') && prefs().flowMode === 'auto', 'Ratio classification must preserve the selected auto mode');
        check(requestedSamples.length === 12, 'Ratio classification must inspect the twelve sampled image headers');
        await until(() => [...document.querySelectorAll('.viewer-comic-scroll .viewer-comic-image')].filter(image => image.complete && image.naturalWidth > 0).length === 17, 'Synthetic page headers were not decoded');
        for (const image of document.querySelectorAll('.viewer-comic-scroll .viewer-comic-image')) {
            const index = Number(image.closest('[data-page-index]').dataset.pageIndex);
            check(image.naturalWidth === shortVariableMetrics[index][0] && image.naturalHeight === shortVariableMetrics[index][1], 'Synthetic PNG header dimensions do not match the source metadata');
        }
        return { pageCount: shortVariablePages.length, averageKiB: totalEncodedBytes / shortVariablePages.length / 1024, requestedSamples: requestedSamples.length, width: Math.max(...comicWidths()), zoom: displayedZoom() };
    } finally {
        window.fetch = originalFetch;
    }
};
let scrollMenuBaselineTop = 0;
let scrollMenuInitialZoom = 100;
window.openScrollZoomMenus = async () => {
    currentType = 'comic';
    localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({ flowMode: 'auto', zoom: 100, slideNavOpen: false, readerSettings: { pageEffect: 'none' } }));
    await loadSession({ id: 'archive-small-menus-' + innerWidth, type: 'comic', filePath: '/fixture/menus-' + innerWidth + '.cbz', fileName: 'Scroll controls', preview: true });
    await until(() => document.querySelector('.viewer-scroll-menu') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), 'Scroll menu is not ready');
    await settle();
    scrollMenuBaselineTop = document.querySelector('.viewer-scroll-menu').getBoundingClientRect().top;
    button('확대/축소').click();
    await until(() => document.querySelector('.viewer-zoom-range'), 'Zoom menu did not open');
    await settle();
    scrollMenuInitialZoom = Number(document.querySelector('.viewer-zoom-range').value);
};
window.inspectScrollZoomMenus = () => {
    const zoom = document.querySelector('.viewer-zoom-menu').getBoundingClientRect();
    const scroll = document.querySelector('.viewer-scroll-menu').getBoundingClientRect();
    check(scroll.top >= zoom.bottom, 'Scroll and zoom menus overlap: ' + JSON.stringify({ width: innerWidth, zoom: zoom.toJSON(), scroll: scroll.toJSON() }));
    const points = {};
    for (const [name, selector] of [['range', '.viewer-zoom-range'], ['reset', '.viewer-zoom-reset']]) {
        const target = document.querySelector(selector);
        const rect = target.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width * (name === 'range' ? 0.7 : 0.5));
        const y = Math.round(rect.top + rect.height / 2);
        const hit = document.elementFromPoint(x, y);
        check(hit === target || target.contains(hit), 'Zoom ' + name + ' is covered at width ' + innerWidth + ': ' + hit?.className);
        points[name] = { x, y };
    }
    return points;
};
window.confirmZoomRangeChanged = async () => {
    await until(() => Number(document.querySelector('.viewer-zoom-range')?.value) !== scrollMenuInitialZoom, 'Visible zoom range could not be adjusted');
};
window.closeScrollZoomMenus = async () => {
    await until(() => Number(document.querySelector('.viewer-zoom-range')?.value) === 100, 'Visible zoom reset could not be clicked');
    await settle();
    check(displayedZoom() === 100 && prefs().zoom === 100, 'Manual reset must remain at 100% after automatic width limiting');
    button('확대/축소').click();
    await until(() => !document.querySelector('.viewer-zoom-menu'), 'Zoom menu did not close');
    await until(() => Math.abs(document.querySelector('.viewer-scroll-menu').getBoundingClientRect().top - scrollMenuBaselineTop) <= 1, 'Scroll menu did not return to its original position after closing zoom');
    return 'scroll-zoom-' + innerWidth;
};
`);
        const appHtml = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
        const contentSecurityPolicy = appHtml.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i)?.[0];
        assert.ok(contentSecurityPolicy, 'The renderer fixture must use the application content security policy.');
        await fs.writeFile(path.join(directory, 'index.html'), '<head>' + contentSecurityPolicy + '</head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, protocol } = require('electron');
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-comic', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const protocolPages = new Map();
    let protocolRequests = 0;
    protocol.handle('bookmanager-comic', async request => {
        protocolRequests += 1;
        const pathname = new URL(request.url).pathname;
        if (pathname.startsWith('/mixed-delayed/') && !pathname.endsWith('/0.png')) await new Promise(resolve => setTimeout(resolve, 700));
        const bytes = protocolPages.get(pathname);
        return bytes ? new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'Content-Length': String(bytes.length) } }) : new Response('Not found', { status: 404 });
    });
    const window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL('http://127.0.0.1:${server.httpServer.address().port}/');
    for (const fixture of await window.webContents.executeJavaScript('window.protocolPageFixtures()')) protocolPages.set(fixture.path, Buffer.from(fixture.base64, 'base64'));
    const call = (name, options = {}) => window.webContents.executeJavaScript('window.' + name + '(' + JSON.stringify(options) + ')');
    const resize = async (width, height) => {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript('new Promise(resolve => { const check = () => innerWidth === ' + width + ' && innerHeight === ' + height + ' ? resolve() : requestAnimationFrame(check); check(); })');
    };
    const results = [];
    for (const type of ['comic', 'pdf', 'text', 'epub']) {
        await resize(1440, 960);
        await call('startAutoFlow', { type });
        await resize(640, 900);
        await call('checkNarrowAutoFlow');
        await resize(1440, 960);
        await call('checkWideAutoFlow');
        await resize(640, 900);
        await call('checkNarrowAutoFlow', { navigate: false });
        await call('chooseManualSingle');
        await resize(1440, 960);
        results.push(await call('checkManualSingle'));
    }
    await call('startAutoFlow', { type: 'comic', pageEffect: 'page' });
    await resize(640, 900);
    await call('checkNarrowAutoFlow', { pageEffect: 'page' });
    await resize(1440, 960);
    await call('checkWideAutoFlow', { pageEffect: 'page' });
    results.push('comic-page-effect');
    results.push(await call('checkManualTextToAuto'));
    for (const type of ['text', 'epub']) {
        await call('selectReaderSecondPage', { type });
        await resize(640, 900);
        await call('checkNarrowAutoFlow', { navigate: false });
        await resize(1440, 960);
        await call('checkWideAutoFlow');
        results.push(type + '-second-page');
    }
    results.push(await call('checkPdfLandscape'));
    results.push(await call('checkWebtoonAutoFlow'));
    await window.webContents.executeJavaScript('window.useComicProtocol = true');
    results.push(await call('checkWebtoonAutoFlow'));
    results.push(await call('checkArchiveSizeAutoFlow'));
    results.push(await call('checkWebtoonReadingDirectionAutoFlow'));
    await resize(640, 960);
    await call('prepareWebtoonWidthLimit');
    await call('checkWebtoonWidthLimit', { reduced: false });
    await resize(1440, 960);
    await call('checkWebtoonWidthLimit', { reduced: true });
    await call('captureWebtoonResizePosition');
    await resize(1600, 960);
    const centerResult = await call('checkWebtoonResizePosition');
    console.log('WEBTOON_CENTER_RESULT=' + JSON.stringify(centerResult));
    results.push('webtoon-resize-anchor');
    await resize(1440, 960);
    await call('checkOrdinaryComicZoom');
    await call('prepareWebtoonWidthLimit');
    await call('checkWebtoonWidthLimit', { reduced: true });
    await call('resetWebtoonZoomManually');
    await resize(1600, 960);
    await call('checkManualWebtoonZoom');
    await resize(640, 960);
    await call('prepareWebtoonWidthLimit');
    await call('checkWebtoonWidthLimit', { reduced: false });
    await call('resetWebtoonZoomManually');
    await resize(1440, 960);
    await call('checkManualWebtoonZoom');
    results.push('webtoon-same-zoom-override');
    await resize(1440, 960);
    await call('prepareWebtoonWidthLimit', { viewMode: 'actual' });
    await call('checkWebtoonWidthLimit', { reduced: false });
    results.push('webtoon-width-limit');
    const mixedWidthResult = await call('checkMixedWebtoonWidths');
    console.log('MIXED_WIDTH_RESULT=' + JSON.stringify(mixedWidthResult));
    results.push('webtoon-mixed-widths');
    const shortVariableResult = await call('checkShortVariableWebtoon');
    console.log('SHORT_VARIABLE_RESULT=' + JSON.stringify(shortVariableResult));
    results.push('webtoon-short-variable-pages');
    for (const width of [1440, 1024, 640]) {
        await resize(width, 960);
        await call('openScrollZoomMenus');
        if (process.env.BOOKMANAGER_SCROLL_ZOOM_SCREENSHOT) require('fs').writeFileSync(process.env.BOOKMANAGER_SCROLL_ZOOM_SCREENSHOT + '-' + width + '.png', (await window.webContents.capturePage()).toPNG());
        const points = await call('inspectScrollZoomMenus');
        const click = point => {
            window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
            window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
        };
        click(points.range);
        await call('confirmZoomRangeChanged');
        click(points.reset);
        results.push(await call('closeScrollZoomMenus'));
    }
    if (protocolRequests < 6) throw new Error('Comic protocol samples were not requested');
    console.log('AUTO_FLOW_RESULT=' + JSON.stringify(results));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Auto flow renderer timed out: ' + result)); }, 90000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/AUTO_FLOW_RESULT=(.+)/)[1]);
        assert.deepEqual(report, ['comic', 'pdf', 'text', 'epub', 'comic-page-effect', 'text-manual-to-auto', 'text-second-page', 'epub-second-page', 'pdf-landscape', 'webtoon-data', 'webtoon-protocol', 'archive-size', 'webtoon-reading-direction', 'webtoon-resize-anchor', 'webtoon-same-zoom-override', 'webtoon-width-limit', 'webtoon-mixed-widths', 'webtoon-short-variable-pages', 'scroll-zoom-1440', 'scroll-zoom-1024', 'scroll-zoom-640']);
        t.diagnostic(JSON.stringify(report));
        t.diagnostic(output.result.match(/WEBTOON_CENTER_RESULT=(.+)/)[1]);
        t.diagnostic(output.result.match(/MIXED_WIDTH_RESULT=(.+)/)[1]);
        t.diagnostic(output.result.match(/SHORT_VARIABLE_RESULT=(.+)/)[1]);
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
