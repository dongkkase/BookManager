import assert from 'node:assert/strict';
import test from 'node:test';
import {
    bundledFontOptionsFromFaces,
    fileUrlFromPath,
    installBundledFontFaces,
} from './bundledFonts.js';

function createFakeDocument() {
    const nodes = new Map();
    const head = {
        children: [],
        appendChild(node) {
            this.children.push(node);
            nodes.set(node.id, node);
            node.remove = () => {
                this.children = this.children.filter(child => child !== node);
                nodes.delete(node.id);
            };
        },
    };
    return {
        head,
        getElementById(id) {
            return nodes.get(id) || null;
        },
        createElement(tagName) {
            return { tagName, id: '', textContent: '', remove() {} };
        },
    };
}

test('bundled font select options include Default and unique families', () => {
    assert.deepEqual(bundledFontOptionsFromFaces([
        { family: 'Nanum Gothic' },
        { family: 'Nanum Gothic' },
        { family: 'Jua' },
        { family: '' },
    ]), [
        { value: 'Default', label: 'Default' },
        { value: 'Jua', label: 'Jua' },
        { value: 'Nanum Gothic', label: 'Nanum Gothic' },
    ]);
});

test('local font paths are converted to encoded file URLs', () => {
    assert.equal(
        fileUrlFromPath('C:\\Fonts\\Nanum Gothic#Bold.ttf'),
        'file:///C:/Fonts/Nanum%20Gothic%23Bold.ttf',
    );
    assert.equal(fileUrlFromPath('/tmp/Noto Sans KR.ttf'), 'file:///tmp/Noto%20Sans%20KR.ttf');
});

test('bundled font faces are installed into a replaceable style element', () => {
    const documentRef = createFakeDocument();

    installBundledFontFaces([
        {
            family: 'Nanum Gothic',
            path: 'C:\\Fonts\\Nanum Gothic.ttf',
            weight: 700,
            style: 'normal',
            format: 'truetype',
        },
    ], documentRef);

    assert.equal(documentRef.head.children.length, 1);
    assert.match(documentRef.head.children[0].textContent, /font-family: 'Nanum Gothic';/);
    assert.match(documentRef.head.children[0].textContent, /file:\/\/\/C:\/Fonts\/Nanum%20Gothic\.ttf/);
    assert.match(documentRef.head.children[0].textContent, /font-weight: 700;/);

    installBundledFontFaces([], documentRef);
    assert.equal(documentRef.head.children.length, 0);
});
