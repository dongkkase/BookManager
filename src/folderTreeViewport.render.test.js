import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('폴더 트리는 모션 효과가 켜져 있어도 스크롤 위치와 가상 행 높이를 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-tree-viewport-test-'));
    try {
        const renderer = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FolderTree from './src/components/folder/FolderTree.jsx';
import { fontVarsForConfig } from './src/fontPolicy.js';
import './src/styles/global.css';
import './src/styles/FolderTab.css';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function frames(count) { for (let index = 0; index < count; index += 1) await frame(); }
const folderPath = 'C:/Books';
const children = Array.from({ length: 2400 }, (_, index) => ({
    path: folderPath + '/' + index,
    name: 'Folder ' + index + (index % 19 === 0 ? ' long folder name'.repeat(20) : ''),
    childFolderCount: 0,
}));
const roots = [{ path: folderPath, name: 'Books', childFolderCount: children.length }];
const entries = { [folderPath]: { status: 'ready', children } };
function Fixture() {
    const [expanded, setExpanded] = useState(new Set([folderPath]));
    return <div className="folder-tab"><div className="folder-main-area">
        <aside className="folder-left-panel" style={{ width: 300 }}>
            <div className="sidebar-container"><div className="folder-sidebar">
                <section className="sidebar-section sidebar-section-library">
                    <div className="nav-header">Libraries</div><ul className="nav-list"><li>Books</li></ul>
                </section>
                <section className="sidebar-section sidebar-section-folders">
                    <div className="nav-header">Folders</div>
                    <FolderTree roots={roots} entries={entries} expandedPaths={expanded}
                        onToggle={selected => setExpanded(current => {
                            const next = new Set(current);
                            if (next.has(selected)) next.delete(selected);
                            else next.add(selected);
                            return next;
                        })} t={key => key} />
                </section>
            </div></div>
        </aside>
    </div></div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
window.runFolderTreeViewportTest = async () => {
    check(matchMedia('(prefers-reduced-motion: no-preference)').matches, 'The test must enable motion effects');
    await document.fonts.ready;
    await frames(5);
    const list = document.querySelector('.folder-tree-list');
    check(list && list.clientHeight > 0, 'The actual folder sidebar must have a viewport');
    check(list.scrollWidth > list.clientWidth, 'Long folder names must exercise horizontal overflow');
    const measurements = [];
    function sample(label, expectedScrollTop) {
        const rows = [...list.querySelectorAll('.folder-tree-row')];
        const probeHeight = list.querySelector('.folder-tree-row-height-probe').getBoundingClientRect().height;
        check(rows.length > 0 && rows.length < 100, label + ': the tree must virtualize its rows');
        for (const spacer of list.querySelectorAll('.folder-tree-spacer')) {
            const actual = spacer.getBoundingClientRect().height;
            const expected = parseFloat(spacer.style.height);
            check(Math.abs(actual - expected) <= 0.1,
                label + ': spacer height must update immediately; expected ' + expected + ', got ' + actual);
        }
        for (const row of rows) {
            check(Math.abs(row.getBoundingClientRect().height - probeHeight) <= 0.1,
                label + ': row height must match the measurement probe');
        }
        const rect = list.getBoundingClientRect();
        const style = getComputedStyle(list);
        const top = rect.top + list.clientTop + parseFloat(style.paddingTop);
        const bottom = rect.top + list.clientTop + list.clientHeight - parseFloat(style.paddingBottom);
        check(rows[0].getBoundingClientRect().top <= top + 1,
            label + ': rendered rows leave the top of the viewport blank');
        check(rows.at(-1).getBoundingClientRect().bottom >= bottom - 1,
            label + ': rendered rows leave the bottom of the viewport blank');
        check(Math.abs(list.scrollTop - expectedScrollTop) <= 1,
            label + ': scroll position drifted from ' + expectedScrollTop + ' to ' + list.scrollTop);
        return { label, scrollTop: list.scrollTop, rowHeight: probeHeight, renderedRows: rows.length };
    }
    measurements.push(sample('initial', 0));
    for (const position of [500, 2000, 15000, 40000, 1000]) {
        list.scrollTop = position;
        const expectedScrollTop = list.scrollTop;
        await frames(3);
        for (let index = 0; index < 24; index += 1) {
            await frame();
            const measurement = sample('scroll ' + position + ' frame ' + index, expectedScrollTop);
            if (index === 23) measurements.push(measurement);
        }
    }
    const oldHeight = list.querySelector('.folder-tree-row-height-probe').getBoundingClientRect().height;
    const padding = parseFloat(getComputedStyle(list).paddingTop);
    const anchorRow = (list.scrollTop - padding) / oldHeight;
    const fonts = fontVarsForConfig({ font_scale: 150 });
    for (const [property, value] of Object.entries(fonts)) document.documentElement.style.setProperty(property, value);
    const newHeight = list.querySelector('.folder-tree-row-height-probe').getBoundingClientRect().height;
    const expectedHeight = parseFloat(fonts['--control-height-sm']) + 4;
    check(Math.abs(newHeight - expectedHeight) <= 0.1,
        'Font scale must update the measurement probe immediately; expected ' + expectedHeight + ', got ' + newHeight);
    await frames(3);
    const expectedScrollTop = Math.round(anchorRow * expectedHeight + padding);
    for (let index = 0; index < 24; index += 1) {
        await frame();
        const measurement = sample('font scale frame ' + index, expectedScrollTop);
        if (index === 23) measurements.push(measurement);
    }
    return measurements;
};
`;
        await build({
            stdin: { contents: renderer, loader: 'jsx', resolveDir: projectRoot },
            bundle: true,
            outfile: path.join(directory, 'renderer.js'),
            loader: { '.ttf': 'file' },
            logLevel: 'silent',
        });
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        });
        const result = await window.webContents.executeJavaScript('window.runFolderTreeViewportTest()');
        process.stdout.write('FOLDER_TREE_VIEWPORT_RESULT=' + JSON.stringify(result) + '\\n');
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error));
        app.exit(1);
    }
});
`);
        const executable = createRequire(import.meta.url)('electron');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(executable, [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error('Folder tree viewport test timed out: ' + output)); }, 30000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/FOLDER_TREE_VIEWPORT_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const measurements = JSON.parse(payload);
        assert.equal(measurements.length, 7);
        for (const measurement of measurements) t.diagnostic(JSON.stringify(measurement));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
