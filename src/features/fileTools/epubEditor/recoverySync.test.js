import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, paragraph } from '../../../../electron/epubEditor/model.js';
import { applyProjectChanges } from '../../../../electron/epubEditor/projectChanges.js';
import { createRecoverySync } from './recoverySync.js';

const edit = (project, index) => ({ ...project, revision: project.revision + 1, chapters: project.chapters.map((chapter, i) => i === index ? { ...chapter, content: { type: 'doc', content: [paragraph(`edit ${project.revision}`)] } } : chapter) });

test('recovery serializes concurrent requests and transmits only chapters changed since acknowledgment', async () => {
    const initial = createProject('essay');
    let stored = initial;
    let active = 0;
    const requests = [];
    const sync = createRecoverySync(initial, async payload => {
        assert.equal(active++, 0);
        requests.push(payload);
        await new Promise(resolve => setTimeout(resolve, 10));
        stored = applyProjectChanges(stored, payload.changes);
        active -= 1;
        return { revision: stored.revision };
    });
    const first = edit(initial, 0);
    const second = edit(first, 1);
    const results = await Promise.all([sync(first), sync(second), sync(second)]);
    assert.deepEqual(results.map(item => item.revision), [1, 2, 2]);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(item => item.changes.chapters.length), [1, 1]);
    assert.deepEqual(stored, second);
});

test('failed recovery retains the baseline so subsequent changes also include unsaved edits', async () => {
    const initial = createProject('essay');
    let calls = 0;
    const sync = createRecoverySync(initial, async ({ changes }) => {
        if (++calls === 1) throw Object.assign(new Error(), { code: 'ENOSPC' });
        assert.equal(changes.baseRevision, 0);
        assert.equal(changes.chapters.length, 2);
        return { revision: changes.project.revision };
    });
    const first = edit(initial, 0);
    await assert.rejects(sync(first), { code: 'ENOSPC' });
    assert.deepEqual(await sync(edit(first, 1)), { revision: 2 });
});

test('a concurrent explicit save triggers a full resync before incremental recovery resumes', async () => {
    const initial = createProject('essay');
    const next = edit(initial, 0);
    const requests = [];
    const sync = createRecoverySync(initial, async payload => {
        requests.push(payload);
        if (requests.length === 1) throw Object.assign(new Error(), { code: 'RECOVERY_CONFLICT' });
        return { revision: payload.project?.revision ?? payload.changes.project.revision };
    });
    await sync(next);
    await sync(edit(next, 1));
    assert.equal(requests[1].project, next);
    assert.equal(requests[2].changes.baseRevision, 1);
    assert.equal(requests[2].changes.chapters.length, 1);
});

test('explicit saves wait for pending recovery, survive its failure and become the next delta baseline', async () => {
    const initial = createProject('essay');
    const first = edit(initial, 0);
    const second = edit(first, 1);
    let calls = 0;
    let recoveryFinished = false;
    const sync = createRecoverySync(initial, async ({ changes }) => {
        if (++calls === 1) {
            await new Promise(resolve => setTimeout(resolve, 10));
            recoveryFinished = true;
            throw Object.assign(new Error(), { code: 'ENOSPC' });
        }
        assert.equal(changes.baseRevision, second.revision);
        assert.equal(changes.chapters.length, 1);
        return { revision: changes.project.revision };
    });
    const recovering = assert.rejects(sync(first), { code: 'ENOSPC' });
    const saving = sync.save(second, async () => {
        assert.equal(recoveryFinished, true);
        return { revision: second.revision };
    });
    const next = sync(edit(second, 2));
    await Promise.all([recovering, saving, next]);
});
