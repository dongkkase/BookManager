import assert from 'node:assert/strict';
import test from 'node:test';
import { READER_PAPER_SIZES, normalizeReaderPaperSize, readerPageFrameSize } from './viewerReaderPageSize.js';

test('책 판형은 한 쪽과 펼친 두 쪽 모두 창 안에서 같은 비율을 유지한다', () => {
    for (const paper of READER_PAPER_SIZES.filter(paper => paper.width)) {
        for (const flowMode of ['single', 'spread']) {
            for (const [width, height] of [[1600, 900], [700, 1100], [480, 640], [2560, 1440]]) {
                const size = readerPageFrameSize({ viewport: { width, height }, flowMode, paperSize: paper.id });
                const columns = flowMode === 'spread' ? 2 : 1;
                assert.ok(Math.abs(size.width / size.height - paper.width / paper.height) < 1e-10);
                assert.ok(size.width * columns <= width - 28 + 1e-8);
                assert.ok(size.height <= height - 28 + 1e-8);
                assert.ok(Math.abs(size.width * columns - (width - 28)) < 1e-8 || Math.abs(size.height - (height - 28)) < 1e-8);
            }
        }
    }
});

test('높이가 제한된 창에서 한장보기와 두장보기의 낱장 크기가 같다', () => {
    const options = { viewport: { width: 1800, height: 900 }, paperSize: 'shinguk' };
    assert.deepEqual(readerPageFrameSize({ ...options, flowMode: 'single' }), readerPageFrameSize({ ...options, flowMode: 'spread' }));
    assert.deepEqual(readerPageFrameSize(options), readerPageFrameSize({ ...options, widthFit: true }));
});

test('설정이 없거나 유효하지 않으면 기본 판형을 사용한다', () => {
    for (const value of [undefined, null, '', 'unknown']) assert.equal(normalizeReaderPaperSize(value), 'shinguk');
    for (const paper of READER_PAPER_SIZES) assert.equal(normalizeReaderPaperSize(paper.id), paper.id);
    const fallback = readerPageFrameSize();
    assert.deepEqual(readerPageFrameSize({ viewport: { width: Infinity, height: -10 } }), fallback);
    assert.ok(Math.abs(fallback.width / fallback.height - 152 / 225) < 1e-10);
});

test('스크롤 보기와 화면 맞춤은 기존 크기 계산을 유지한다', () => {
    const viewport = { width: 1600, height: 900 };
    for (const paper of READER_PAPER_SIZES) {
        assert.deepEqual(readerPageFrameSize({ viewport, flowMode: 'scroll', paperSize: paper.id }), { width: 900, height: 872 });
    }
    assert.deepEqual(readerPageFrameSize({ viewport, flowMode: 'spread', paperSize: 'screen' }), { width: 680, height: 872 });
    assert.deepEqual(readerPageFrameSize({ viewport, flowMode: 'spread', paperSize: 'screen', widthFit: true }), { width: 786, height: 872 });
});
