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
        const controllers = this.tasks.get(key) || new Set();
        controllers.add(controller);
        this.tasks.set(key, controllers);
        return controller;
    }

    cancel(ownerId, taskId) {
        const controllers = this.tasks.get(`${ownerId}:${taskId}`);
        if (!controllers || controllers.size === 0) return false;
        for (const controller of controllers) controller.cancel();
        return true;
    }

    cancelAll(ownerId) {
        let cancelledCount = 0;
        const prefix = `${ownerId}:`;

        for (const [key, controllers] of this.tasks) {
            if (!key.startsWith(prefix)) continue;
            for (const controller of controllers) {
                controller.cancel();
                cancelledCount += 1;
            }
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
        const controllers = this.tasks.get(key);
        if (!controllers) return;
        controllers.delete(controller);
        if (controllers.size === 0) this.tasks.delete(key);
    }
}
