const FIXED_MODELS = new Map([
    ['system', 'system'],
    ['supertonic', 'supertonic-3'],
    ['google', 'google-cloud-default'],
]);
const OPENAI_MODELS = new Set(['gpt-4o-mini-tts', 'tts-1']);

export function reportViewerTtsUsage({ sessionId, engine, model } = {}, target = globalThis.window) {
    try {
        const resolvedModel = engine === 'openai'
            ? (OPENAI_MODELS.has(model) ? model : '')
            : FIXED_MODELS.get(engine);
        if (typeof sessionId !== 'string' || !sessionId || !resolvedModel) return false;
        if (typeof target?.viewerAPI?.reportTtsUsage !== 'function') return false;
        Promise.resolve(target.viewerAPI.reportTtsUsage({ sessionId, engine, model: resolvedModel })).catch(() => {});
        return true;
    } catch {
        return false;
    }
}
