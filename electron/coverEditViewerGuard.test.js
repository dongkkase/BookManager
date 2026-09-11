import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoverEditViewerGuard } from './coverEditViewerGuard.js';

test('open readers prevent cover edits, including NFC and NFD variants', async () => {
    let called = false;
    const guard = createCoverEditViewerGuard(() => ['/books/표지.cbz'.normalize('NFD')]);
    await assert.rejects(guard.run('/books/표지.cbz', () => { called = true; }), { code: 'COVER_VIEWER_OPEN' });
    assert.equal(called, false);
    assert.equal(await guard.run('/books/other.cbz', () => 'saved'), 'saved');
});

test('saving prevents new viewer opens and duplicate edits until success or failure', async () => {
    const guard = createCoverEditViewerGuard(() => []);
    let finish;
    const pending = guard.run('/books/book.cbz', () => new Promise(resolve => { finish = resolve; }));
    assert.throws(() => guard.assertCanOpen('/books/book.cbz'), { code: 'COVER_EDIT_BUSY' });
    assert.doesNotThrow(() => guard.assertCanOpen('/books/other.cbz'));
    await assert.rejects(guard.run('/books/book.cbz', () => {}), { code: 'COVER_EDIT_BUSY' });
    finish('saved');
    assert.equal(await pending, 'saved');
    assert.doesNotThrow(() => guard.assertCanOpen('/books/book.cbz'));
    await assert.rejects(guard.run('/books/book.cbz', () => { throw new Error('failed'); }), /failed/);
    assert.doesNotThrow(() => guard.assertCanOpen('/books/book.cbz'));
});
