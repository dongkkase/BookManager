export * from './imageEditing.shared.js';

function rendererError(code, message) {
    return Object.assign(new Error(message || code), { code });
}

export async function createImageEditRenderer(blob) {
    if (!(blob instanceof Blob) || typeof Worker === 'undefined') throw rendererError('IMAGE_EDIT_UNSUPPORTED');
    let worker;
    try {
        worker = new Worker(new URL('./imageEditing.worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
        throw rendererError('IMAGE_EDIT_UNSUPPORTED', error.message);
    }
    let closed = false;
    let sequence = 0;
    let activeRender = null;
    let latestPreview = null;
    const finalRenders = [];
    const pending = new Map();
    const stop = (error) => {
        if (closed) return;
        closed = true;
        worker.terminate();
        for (const request of pending.values()) request.reject(error);
        pending.clear();
        finalRenders.length = 0;
        latestPreview = null;
        activeRender = null;
    };
    const send = (request) => {
        if (request.type === 'render') activeRender = request.id;
        try {
            worker.postMessage({ id: request.id, type: request.type, ...request.value });
        } catch (error) {
            pending.delete(request.id);
            if (activeRender === request.id) activeRender = null;
            request.reject(rendererError('IMAGE_EDIT_RENDER', error.message));
            drain();
        }
    };
    const drain = () => {
        if (closed || activeRender !== null) return;
        const next = finalRenders.shift();
        if (next) send(next);
        else if (latestPreview) {
            const preview = latestPreview;
            latestPreview = null;
            send(preview);
        }
    };
    worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (activeRender === data.id) activeRender = null;
        if (data.error) request.reject(rendererError(data.error.code || 'IMAGE_EDIT_RENDER', data.error.message));
        else request.resolve(data.result);
        drain();
    };
    worker.onerror = event => stop(rendererError('IMAGE_EDIT_RENDER', event.message));
    worker.onmessageerror = () => stop(rendererError('IMAGE_EDIT_RENDER'));
    const request = (type, value) => {
        if (closed) return Promise.reject(rendererError('IMAGE_EDIT_CLOSED'));
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const item = { id, type, value, resolve, reject };
            pending.set(id, item);
            if (type !== 'render') send(item);
            else if (value.options.maxDimension !== undefined) {
                if (latestPreview) {
                    pending.delete(latestPreview.id);
                    latestPreview.reject(rendererError('IMAGE_EDIT_SUPERSEDED'));
                }
                latestPreview = item;
                drain();
            } else {
                finalRenders.push(item);
                drain();
            }
        });
    };
    try {
        const dimensions = await request('init', { blob });
        return {
            ...dimensions,
            render: (settings, options = {}) => request('render', { settings, options }),
            destroy: () => stop(rendererError('IMAGE_EDIT_CLOSED')),
        };
    } catch (error) {
        stop(error);
        throw error;
    }
}
