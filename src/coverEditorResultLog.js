const errorTranslationKeys = {
    COVER_SOURCE_CHANGED: 'cover_editor_source_changed',
    IMAGE_SOURCE_CHANGED: 'cover_editor_image_changed',
    COVER_VIEWER_OPEN: 'cover_editor_viewer_open',
    COVER_METADATA_IMAGE_UNAVAILABLE: 'cover_editor_metadata_image_unavailable',
};

function errorMessage(value, t) {
    const key = errorTranslationKeys[value?.code];
    return key ? t(key) : value?.error || t('cover_editor_failed');
}

function fileDescription(entry, sourcePath) {
    const name = entry?.name || sourcePath.split(/[\\/]/).pop();
    return [...new Set([name, sourcePath].filter(Boolean))];
}

export function createCoverEditorResultLog({ entries = [], outcomes = [], checkedPaths } = {}, t) {
    const stats = { success: [], skip: [], error: [] };
    const outputFiles = [];
    const entriesByPath = new Map(entries.map(entry => [entry.filePath, entry]));
    const entryOrder = new Map(entries.map((entry, index) => [entry.filePath, index]));
    const checked = new Set(checkedPaths ?? entries.map(entry => entry.filePath));
    const attemptedPaths = new Set();
    const records = outcomes.map(outcome => {
        const sourcePath = outcome.sourcePath || outcome.filePath || '';
        attemptedPaths.add(sourcePath);
        return { sourcePath, outcome };
    });

    for (const entry of entries) {
        if (entry.error && checked.has(entry.filePath) && !attemptedPaths.has(entry.filePath)) {
            records.push({ sourcePath: entry.filePath, inspection: entry });
            attemptedPaths.add(entry.filePath);
        }
    }
    records.sort((left, right) => (entryOrder.get(left.sourcePath) ?? entries.length) - (entryOrder.get(right.sourcePath) ?? entries.length));

    let cancelled = false;
    for (const { sourcePath, outcome, inspection } of records) {
        const lines = fileDescription(entriesByPath.get(sourcePath), sourcePath);
        if (inspection) {
            const failure = typeof inspection.error === 'object' ? inspection.error : inspection;
            lines.push(`${t('cover_editor_batch_inspect_failed')}: ${errorMessage(failure, t)}`);
            stats.error.push(lines.join('\n'));
        } else if (outcome.cancelled) {
            cancelled = true;
            lines.push(t('cover_editor_batch_cancelled'));
            stats.skip.push(lines.join('\n'));
        } else if (outcome.success) {
            lines.push(t('cover_editor_saved'));
            if (outcome.filePath && outcome.filePath !== sourcePath) {
                lines.push(`${t('cover_editor_result_path')}: ${outcome.filePath}`);
            }
            if (outcome.backupPath) lines.push(`${t('cover_editor_backup_path')}: ${outcome.backupPath}`);
            if (outcome.warning) lines.push(`${t('cover_editor_refresh_warning')}: ${outcome.warning}`);
            if (outcome.readingWarning) lines.push(outcome.readingWarning);
            if (outcome.readingAdjustmentUncertain) lines.push(t('cover_editor_reading_check'));
            stats.success.push(lines.join('\n'));
            if (outcome.filePath && !outputFiles.includes(outcome.filePath)) outputFiles.push(outcome.filePath);
        } else {
            lines.push(errorMessage(outcome, t));
            stats.error.push(lines.join('\n'));
        }
    }
    return { stats, outputFiles, cancelled };
}
