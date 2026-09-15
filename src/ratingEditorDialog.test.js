import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { initialRating, ratingStarFill, supportsRatingEditor } from './ratingPolicy.js';

const compiled = transformSync(fs.readFileSync(new URL('./components/folder/RatingEditorDialog.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];

function fixture(options = {}) {
    const slots = [];
    let cursor = 0;
    let tree;
    const calls = { saved: [], closed: 0 };
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => { slots[index] = value; }];
        },
        useRef: initial => slots[cursor++] ||= { current: initial },
        useId: () => 'rating-dialog',
        useEffect: () => {},
    };
    const mocks = {
        react,
        '../CoverArtwork': { CoverArtwork: 'CoverArtwork' },
        './detailPanelCommon': { detailMetadataValue: (file, ...keys) => keys.map(key => file[key]).find(value => value !== undefined) || '' },
        '../../ratingPolicy': { initialRating, ratingStarFill },
        '../../styles/RatingEditorDialog.css': {},
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
        assert.ok(name in mocks, name);
        return mocks[name];
    });
    const render = () => {
        cursor = 0;
        tree = module.exports.RatingEditorDialog({
            file: { full_path: '/library/book.cbz', path: '/unused.cbz', title: 'Book', series: 'Series', rating: options.rating },
            t: key => key,
            onSave: async request => { calls.saved.push(request); return options.save ? options.save(request) : { success: true }; },
            onClose: () => { calls.closed += 1; },
        });
        return tree;
    };
    render();
    return {
        render, calls,
        all: () => nodes(tree),
        radio: value => nodes(tree).find(node => node.type === 'input' && node.props.value === value),
        submit: () => nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    };
}

test('unrated dialog starts with five empty stars and disallows saving zero', async () => {
    const f = fixture();
    assert.equal(f.all().filter(node => node.type === 'input').length, 10);
    assert.equal(f.all().filter(node => node.type === 'input' && node.props.checked).length, 0);
    assert.deepEqual(f.all().filter(node => node.type === 'rect').map(node => node.props.width), Array(5).fill(0));
    assert.equal(f.all().find(node => node.props.type === 'submit').props.disabled, true);
    await f.submit();
    assert.equal(f.calls.saved.length, 0);
});

test('half-star hover only previews, selection submits the chosen 1–10 score to the current item', async () => {
    const f = fixture();
    const half = f.all().find(node => node.type === 'label' && nodes(node).some(child => child.type === 'input' && child.props.value === 7));
    half.props.onMouseEnter();
    f.render();
    assert.equal(f.radio(7).props.checked, false);
    assert.deepEqual(f.all().filter(node => node.type === 'rect').map(node => node.props.width), [48, 48, 48, 24, 0]);
    f.radio(7).props.onChange();
    f.render();
    assert.equal(f.radio(7).props.checked, true);
    await f.submit();
    assert.deepEqual(f.calls.saved, [{ filePath: '/library/book.cbz', rating: 7 }]);
    assert.equal(f.calls.closed, 1);
});

test('one centered description follows the selected score, while hovering only previews the stars', () => {
    const f = fixture();
    const description = () => f.all().filter(node => node.props.className?.split(' ').includes('rating-editor-label'));
    assert.equal(description().length, 1);
    assert.deepEqual(description()[0].props.children, ['rating_unrated']);
    for (const [rating, label] of [[1, 'very_bad'], [2, 'very_bad'], [3, 'bad'], [4, 'bad'], [5, 'normal'], [6, 'normal'], [7, 'good'], [8, 'good'], [9, 'very_good'], [10, 'very_good']]) {
        f.radio(rating).props.onChange();
        f.render();
        assert.equal(description().length, 1);
        assert.deepEqual(description()[0].props.children, [`rating_${label}`]);
    }
    const half = f.all().find(node => node.type === 'label' && nodes(node).some(child => child.type === 'input' && child.props.value === 1));
    half.props.onMouseEnter();
    f.render();
    assert.deepEqual(description()[0].props.children, ['rating_very_good']);
    assert.equal(f.radio(10).props.checked, true);
    assert.deepEqual(f.all().filter(node => node.type === 'rect').map(node => node.props.width), [24, 0, 0, 0, 0]);
});

test('saving blocks duplicate submissions and failures keep the modal open for retry', async () => {
    let resolve;
    const f = fixture({ rating: 4, save: () => new Promise(callback => { resolve = callback; }) });
    const pending = f.submit();
    f.render();
    assert.ok(f.all().filter(node => node.type === 'input').every(node => node.props.disabled));
    await f.submit();
    assert.equal(f.calls.saved.length, 1);
    resolve({ success: false, error: 'Database unavailable' });
    await pending;
    f.render();
    assert.equal(f.calls.closed, 0);
    assert.ok(f.all().some(node => node.props.role === 'alert'));
    assert.equal(f.all().find(node => node.props.type === 'submit').props.disabled, false);
});

test('rating entrypoints support book and audio files, excluding directories', () => {
    for (const extension of ['cbz', 'cbr', 'cb7', 'zip', '7z', 'rar', 'epub', 'pdf', 'txt', 'mp3', 'm4b', 'flac']) {
        assert.equal(supportsRatingEditor({ path: `/books/item.${extension}` }), true);
    }
    assert.equal(supportsRatingEditor({ path: '/books/folder.cbz', isDirectory: true }), false);
    assert.equal(supportsRatingEditor({ path: '/books/image.png' }), false);
    assert.equal(initialRating(''), 0);
    assert.deepEqual(Array.from({ length: 5 }, (_, index) => ratingStarFill(1, index)), [50, 0, 0, 0, 0]);
    assert.deepEqual(Array.from({ length: 5 }, (_, index) => ratingStarFill(10, index)), [100, 100, 100, 100, 100]);
});
