import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ViewerSessionManager } from './viewerSessions.js';

test('뷰어 세션은 같은 폴더의 이전권/다음권 가능 여부를 계산한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-adjacent-'));
    try {
        const firstPath = path.join(root, '01.pdf');
        const secondPath = path.join(root, '02.pdf');
        const thirdPath = path.join(root, '03.pdf');
        const ignoredPath = path.join(root, 'cover.jpg');
        fs.writeFileSync(firstPath, '');
        fs.writeFileSync(secondPath, '');
        fs.writeFileSync(thirdPath, '');
        fs.writeFileSync(ignoredPath, '');

        const manager = new ViewerSessionManager();
        const first = manager.create(firstPath);
        assert.deepEqual(first.adjacent, { hasPrevious: false, hasNext: true });
        assert.throws(() => manager.createAdjacent(first.id, -1), /No adjacent book\./);

        const second = manager.createAdjacent(first.id, 1);
        assert.equal(second.filePath, path.resolve(secondPath));
        assert.deepEqual(second.adjacent, { hasPrevious: true, hasNext: true });
        assert.equal(
            manager.resolveDocumentRequest(`bookmanager-document://session/${encodeURIComponent(first.id)}/01.pdf`).filePath,
            path.resolve(firstPath),
        );

        const third = manager.createAdjacent(second.id, 1);
        assert.equal(third.filePath, path.resolve(thirdPath));
        assert.deepEqual(third.adjacent, { hasPrevious: true, hasNext: false });
        assert.throws(() => manager.createAdjacent(third.id, 1), /No adjacent book\./);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
