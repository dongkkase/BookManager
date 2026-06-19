export function normalizeResultStats(stats = {}) {
    return {
        error: Array.isArray(stats.error) ? stats.error.map(String) : [],
        success: Array.isArray(stats.success) ? stats.success.map(String) : [],
        skip: Array.isArray(stats.skip) ? stats.skip.map(String) : [],
    };
}

export function formatResultLog(stats = {}) {
    const normalized = normalizeResultStats(stats);
    const sections = [];

    if (normalized.error.length > 0) {
        sections.push(`[ERRORS]\n${normalized.error.join('\n')}`);
    }
    if (normalized.success.length > 0) {
        sections.push(`[SUCCESS]\n${normalized.success.join('\n')}`);
    }
    if (normalized.skip.length > 0) {
        sections.push(`[SKIPPED]\n${normalized.skip.join('\n')}`);
    }

    return sections.join('\n\n');
}

export function canContinueResult(result, outputPaths = []) {
    return !result?.cancelled
        && Array.isArray(outputPaths)
        && outputPaths.filter(Boolean).length > 0;
}

export async function filterExistingResultPaths(paths = [], exists) {
    if (!Array.isArray(paths) || typeof exists !== 'function') return [];
    const checks = await Promise.all(paths.map(async filePath => ({
        filePath,
        exists: Boolean(filePath) && await exists(filePath),
    })));
    return checks.filter(check => check.exists).map(check => check.filePath);
}
