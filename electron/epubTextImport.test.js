import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MAX_TEXT_IMPORT_BYTES, readTextImport, textImportDocument } from './epubEditor/textImport.js';
import { MAX_TEXT_IMPORT_CHARACTERS, MAX_TEXT_IMPORT_PARAGRAPHS, MAX_TEXT_PARAGRAPH_CHARACTERS, TEXT_CHAPTER_CHARACTERS, TEXT_CHAPTER_PARAGRAPHS, splitTextImportDocument } from './epubEditor/textImportLimits.js';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { textContent, validateProject } from './epubEditor/model.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-text-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, write: async (bytes, name = '텍본.txt') => { const file = path.join(root, name); await fs.writeFile(file, bytes); return file; } };
}

test('text reader detects UTF-8, BOM, UTF-16 and Korean legacy encoding', async t => {
    const { write } = await fixture(t);
    const text = '가나다\r\n본문';
    const utf16be = Buffer.from(text, 'utf16le').swap16();
    for (const [bytes, encoding, expected] of [
        [Buffer.from(text), 'utf-8', text],
        [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]), 'utf-8-bom', text],
        [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]), 'utf-16le', text],
        [Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be]), 'utf-16be', text],
        [Buffer.from([0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9]), 'euc-kr', '가나다'],
    ]) {
        const result = await readTextImport(await write(bytes));
        assert.equal(result.encoding, encoding);
        assert.equal(textContent(result.document), expected.replace(/\r\n/g, '\n'));
        assert.equal(result.title, '텍본');
    }
});

test('manual encoding recovers BOM-less UTF-16 and validates Japanese and CP949 bytes', async t => {
    const { write } = await fixture(t);
    const file = await write(Buffer.from('가나다\nABC', 'utf16le'));
    assert.equal((await readTextImport(file, 'utf-16le')).preview, '가나다\nABC');
    const japanese = await write(Buffer.from([0x93, 0xfa, 0x96, 0x7b]), 'japanese.txt');
    assert.equal((await readTextImport(japanese, 'shift_jis')).preview, '日本');
    const korean = await write(Buffer.from([0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9]));
    assert.equal((await readTextImport(korean, 'utf-8')).error, 'TEXT_ENCODING');
    assert.equal((await readTextImport(korean, 'euc-kr')).preview, '가나다');
});

test('plain text import preserves blank lines, tabs and literal markup with bounded preview', () => {
    const result = textImportDocument('\uFEFF앞\r\n\r\n\t<script>문자</script>\f뒤');
    assert.equal(result.preview, '앞\n\n\t<script>문자</script>\n\n뒤');
    assert.equal(result.paragraphs, 5);
    assert.equal(result.document.content[1].content.length, 0);
    assert.equal(new Set(result.document.content.map(node => node.attrs.id)).size, 5);
    assert.equal(textImportDocument('가'.repeat(4100)).preview.length, 4000);
});

test('empty, binary, invalid encoding and oversized files are rejected before import', async t => {
    const { write, root } = await fixture(t);
    for (const [text, code] of [[' \r\n\t', 'TEXT_EMPTY'], ['GIF\u0000data', 'TEXT_NOT_PLAIN'], ['a'.repeat(MAX_TEXT_IMPORT_CHARACTERS + 1), 'TEXT_TOO_LARGE'], [Array(MAX_TEXT_IMPORT_PARAGRAPHS + 1).fill('a').join('\n'), 'TEXT_TOO_LARGE'], ['가'.repeat(MAX_TEXT_PARAGRAPH_CHARACTERS + 1), 'TEXT_PARAGRAPH_TOO_LARGE']]) assert.throws(() => textImportDocument(text), { code });
    assert.equal((await readTextImport(await write(Buffer.from([0xef, 0xbb, 0xbf, 0xff])))).error, 'TEXT_ENCODING');
    const large = await write('x');
    await fs.truncate(large, MAX_TEXT_IMPORT_BYTES + 1);
    await assert.rejects(readTextImport(large), { code: 'TEXT_TOO_LARGE' });
    await assert.rejects(readTextImport(await write('text', 'book.pdf')), { code: 'TEXT_FILE_REQUIRED' });
    await assert.rejects(readTextImport(path.join(root, 'missing.txt')), { code: 'ENOENT' });
    await assert.rejects(readTextImport(large, 'unknown'), { code: 'TEXT_ENCODING' });
});

test('large text is partitioned at paragraph boundaries without changing text, blank lines or IDs', () => {
    const original = `${'가'.repeat(TEXT_CHAPTER_CHARACTERS)}\n\n${'문단\n'.repeat(TEXT_CHAPTER_PARAGRAPHS)}끝 😀`;
    const result = textImportDocument(original);
    const parts = splitTextImportDocument(result.document);
    assert.equal(result.chapterCount, 3);
    assert.equal(parts.map(textContent).join('\n'), original);
    assert.deepEqual(parts.flatMap(part => part.content), result.document.content);
    assert.ok(parts.every(part => part.content.length <= TEXT_CHAPTER_PARAGRAPHS));
    assert.equal(parts[0].content.length, 1);
    const longParagraph = textImportDocument('가'.repeat(TEXT_CHAPTER_CHARACTERS + 1));
    assert.equal(longParagraph.chapterCount, 1);
    assert.equal(longParagraph.document.content.length, 1);
});

test('20 MiB Korean legacy text exceeds old character limits but imports with a bounded preview', async t => {
    const { write } = await fixture(t);
    const line = Buffer.alloc(301);
    line[300] = 10;
    for (let index = 0; index < 300; index += 2) { line[index] = 0xb0; line[index + 1] = 0xa1; }
    const lines = Math.ceil(20 * 1024 * 1024 / line.length);
    const bytes = Buffer.alloc(lines * line.length);
    for (let index = 0; index < lines; index += 1) line.copy(bytes, index * line.length);
    const file = await write(bytes);
    const result = await readTextImport(file);
    assert.equal(result.error, undefined);
    assert.equal(result.encoding, 'euc-kr');
    assert.equal(result.characters, lines * 151);
    assert.equal(result.paragraphs, lines + 1);
    assert.equal(result.preview.length, 4000);
    assert.ok(result.chapterCount > 1);
    assert.equal(result.document.content[lines - 1].content[0].text, '가'.repeat(150));
    assert.deepEqual(result.document.content[lines].content, []);
    assert.equal((await readTextImport(file, 'utf-8')).error, 'TEXT_ENCODING');
});

test('decoding preserves multibyte characters across chunks and rejects incomplete final characters', async t => {
    const { write } = await fixture(t);
    for (const text of [`${'a'.repeat(65535)}한글😀`, `${'a'.repeat(32767)}😀한글`]) {
        for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
            const bytes = encoding === 'utf-8' ? Buffer.from(text) : Buffer.from(text, 'utf16le');
            if (encoding === 'utf-16be') bytes.swap16();
            const file = await write(bytes);
            assert.equal(textContent((await readTextImport(file, encoding)).document), text);
            await fs.writeFile(file, bytes.subarray(0, bytes.length - 1));
            assert.equal((await readTextImport(file, encoding)).error, 'TEXT_ENCODING');
        }
    }
});

test('worker import keeps original project intact and binds encoding reload to its owner session', async t => {
    const { write, root } = await fixture(t);
    const service = new EpubEditorService(path.join(root, 'app'));
    t.after(() => service.dispose());
    const session = await service.create(1, 'blank', 'ko');
    const before = structuredClone(session.project);
    const filePath = await write('불러온 본문');
    const read = await service.readText(1, session.sessionId, { filePath, operationId: 'read1' });
    assert.equal(read.preview, '불러온 본문');
    assert.equal(read.filePath, undefined);
    const decoded = await service.readText(1, session.sessionId, { sourceId: read.sourceId, encoding: 'utf-8', operationId: 'read2' });
    assert.equal(decoded.preview, read.preview);
    assert.deepEqual(session.project, before);
    validateProject({ ...before, chapters: [{ ...before.chapters[0], content: read.document }] });
    await assert.rejects(service.readText(2, session.sessionId, { sourceId: read.sourceId, operationId: 'wrongowner' }), { code: 'SESSION_CLOSED' });
    await assert.rejects(service.readText(1, session.sessionId, { sourceId: 'other', operationId: 'wrongsource' }), { code: 'TEXT_SOURCE_MISSING' });
    await service.readText(1, session.sessionId, { filePath, operationId: 'newsource' });
    await assert.rejects(service.readText(1, session.sessionId, { sourceId: read.sourceId, operationId: 'stalesource' }), { code: 'TEXT_SOURCE_MISSING' });
});

test('IPC uses the native text picker, honors cancellation and ignores renderer paths', async t => {
    const { root, write } = await fixture(t);
    const selected = await write('선택한 본문');
    const forbidden = await write('다른 본문', 'other.txt');
    let handler;
    let canceled = true;
    let calls = 0;
    const sender = new EventEmitter();
    Object.assign(sender, { id: 7, isDestroyed: () => false, send: () => {} });
    const controller = registerEpubEditorIpc({
        ipcMain: { handle: (channel, fn) => { handler = fn; } }, app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null },
        dialog: { showOpenDialog: async (window, options) => { calls += 1; assert.deepEqual(options.filters[0].extensions, ['txt']); return { canceled, filePaths: [selected] }; } },
    });
    t.after(() => controller.dispose());
    const session = await handler({ sender }, { action: 'create', template: 'blank', language: 'ko' });
    const payload = { action: 'readText', sessionId: session.sessionId, operationId: 'picker', filePath: forbidden };
    assert.deepEqual(await handler({ sender }, payload), { ok: true, canceled: true });
    canceled = false;
    const read = await handler({ sender }, payload);
    assert.equal(read.preview, '선택한 본문');
    const reloaded = await handler({ sender }, { ...payload, sourceId: read.sourceId, encoding: 'utf-8' });
    assert.equal(reloaded.preview, '선택한 본문');
    assert.equal(calls, 2);
});
