import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractContentTokens } from './contentTextExtractor.js';

test('TXT 추출은 source byte 상한까지만 읽고 일부 색인 상태를 반환한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-source-limit-'));
    try {
        const source = path.join(root, 'large.txt');
        fs.writeFileSync(source, 'alpha beta outside', 'utf8');

        const result = await extractContentTokens(source, { maxSourceBytes: 11 });

        assert.equal(result.status, 'truncated');
        assert.deepEqual(result.tokens, ['alpha', 'beta']);
        assert.equal(result.textBytes, 11);
        assert.match(result.warnings.join('\n'), /limited to 11 source bytes/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('추출 token은 개별 및 전체 byte 상한을 넘지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-token-limit-'));
    try {
        const tokenSizeSource = path.join(root, 'token-size.txt');
        const payloadSizeSource = path.join(root, 'payload-size.txt');
        fs.writeFileSync(tokenSizeSource, 'short exceedinglylong next', 'utf8');
        fs.writeFileSync(payloadSizeSource, 'one two three', 'utf8');

        const tokenSizeLimited = await extractContentTokens(tokenSizeSource, {
            maxTokenBytes: 5,
            maxTotalTokenBytes: 9,
        });
        assert.equal(tokenSizeLimited.status, 'truncated');
        assert.deepEqual(tokenSizeLimited.tokens, ['short', 'next']);
        assert.equal(tokenSizeLimited.tokens.every(token => Buffer.byteLength(token, 'utf8') <= 5), true);
        assert.equal(
            tokenSizeLimited.tokens.reduce((total, token) => total + Buffer.byteLength(token, 'utf8'), 0),
            9,
        );

        const payloadSizeLimited = await extractContentTokens(payloadSizeSource, {
            maxTokenBytes: 32,
            maxTotalTokenBytes: 6,
        });
        assert.equal(payloadSizeLimited.status, 'truncated');
        assert.deepEqual(payloadSizeLimited.tokens, ['one', 'two']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('1MiB 공백 없는 단일 token은 stack overflow 없이 제외된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-long-token-'));
    try {
        const source = path.join(root, 'long-token.txt');
        fs.writeFileSync(source, 'a'.repeat(1024 * 1024), 'utf8');

        const result = await extractContentTokens(source, {
            maxTokenBytes: 64,
            maxTotalTokenBytes: 1024,
        });

        assert.equal(result.status, 'truncated');
        assert.deepEqual(result.tokens, []);
        assert.equal(result.tokenCount, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF가 source byte 상한을 넘으면 parse하지 않고 unsupported로 제외한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-pdf-limit-'));
    try {
        const source = path.join(root, 'oversized.pdf');
        fs.writeFileSync(source, Buffer.alloc(2048, 0x41));

        const result = await extractContentTokens(source, { maxPdfSourceBytes: 1024 });

        assert.equal(result.status, 'unsupported');
        assert.deepEqual(result.tokens, []);
        assert.equal(result.tokenCount, 0);
        assert.match(result.warnings.join('\n'), /PDF.*(?:size|limit|1024)/i);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
