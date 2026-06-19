export function selectRandomResource(resources, random = Math.random) {
    if (!Array.isArray(resources) || resources.length === 0) return '';
    const value = Number(random());
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0;
    return resources[Math.floor(safeValue * resources.length)];
}
