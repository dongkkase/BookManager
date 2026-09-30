import { projectChanges } from '../../../../electron/epubEditor/projectChanges.js';

export function createRecoverySync(initial, send) {
    let baseline = initial;
    let queue = Promise.resolve();
    const enqueue = task => {
        queue = queue.catch(() => {}).then(task);
        return queue;
    };
    const sync = snapshot => {
        const recover = async () => {
            if (baseline && snapshot.revision <= baseline.revision) return { revision: baseline.revision };
            let result;
            try { result = await send(baseline ? { changes: projectChanges(baseline, snapshot) } : { project: snapshot }); }
            catch (error) {
                if (error.code !== 'RECOVERY_CONFLICT') throw error;
                result = await send({ project: snapshot });
            }
            baseline = result.revision === snapshot.revision ? snapshot : null;
            return result;
        };
        return enqueue(recover);
    };
    sync.save = (snapshot, write) => enqueue(async () => {
        const result = await write();
        if (!result.canceled && !result.recoveryWarning && result.revision === snapshot.revision) baseline = snapshot;
        return result;
    });
    return sync;
}
