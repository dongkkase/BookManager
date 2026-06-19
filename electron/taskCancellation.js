export class TaskCancellationRegistry {
    constructor() {
        this.tasks = new Map();
    }

    start(ownerId, taskId) {
        const key = `${ownerId}:${taskId}`;
        const controller = {
            cancelled: false,
            cancel() {
                this.cancelled = true;
            },
            shouldCancel() {
                return this.cancelled;
            },
        };
        this.tasks.set(key, controller);
        return controller;
    }

    cancel(ownerId, taskId) {
        const controller = this.tasks.get(`${ownerId}:${taskId}`);
        if (!controller) return false;
        controller.cancel();
        return true;
    }

    cancelAll(ownerId) {
        let cancelledCount = 0;
        const prefix = `${ownerId}:`;

        for (const [key, controller] of this.tasks) {
            if (!key.startsWith(prefix)) continue;
            controller.cancel();
            cancelledCount += 1;
        }

        return cancelledCount;
    }

    hasActive(ownerId) {
        const prefix = `${ownerId}:`;
        return [...this.tasks.keys()].some(key => key.startsWith(prefix));
    }

    async waitForIdle(ownerId, timeoutMs = 30000) {
        const startedAt = Date.now();

        while (this.hasActive(ownerId)) {
            if (Date.now() - startedAt >= timeoutMs) return false;
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        return true;
    }

    finish(ownerId, taskId, controller) {
        const key = `${ownerId}:${taskId}`;
        if (this.tasks.get(key) === controller) this.tasks.delete(key);
    }
}
