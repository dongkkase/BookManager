import { defaultSettings, normalizeSettings, estimateOptimization, resourceSettings, resourceRemovalSelected } from '../../../../electron/epubOptimizer/model.js';

export const resourcePageSize = 40;
export const fileName = path => String(path || '').split(/[\\/]/).pop();
export const isEpub = path => typeof path === 'string' && /\.epub$/i.test(path);
export const isCancelled = value => Boolean(value?.cancelled || ['CANCELLED', 'TASK_CANCELLED'].includes(value?.code));

export function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function createFile(path) {
    return { path, full_path: path, name: fileName(path), checked: true, settings: defaultSettings(), analysis: null, error: null, outcome: null };
}

export function presetSettings(preset) {
    const defaults = defaultSettings();
    if (preset === 'compact') return normalizeSettings({ ...defaults, jpegQuality: 72, maxDimension: 1600 });
    if (preset === 'lossless') return normalizeSettings({ ...defaults, images: false });
    return defaults;
}

export function copyGeneralSettings(files, sourcePath) {
    const source = files.find(file => file.path === sourcePath);
    if (!source) return files;
    return files.map(file => file.checked && file.path !== sourcePath ? {
        ...file,
        settings: normalizeSettings({ ...source.settings, resources: file.settings.resources }),
        settingsChanged: Boolean(file.outcome),
    } : file);
}

export function checkedEstimate(files) {
    return files.filter(file => file.checked && file.analysis && !file.error).reduce((sum, file) => {
        const estimate = estimateOptimization(file.analysis, file.settings);
        for (const key of ['originalSize', 'estimatedSize', 'minSize', 'maxSize', 'savedBytes', 'minSavedBytes', 'maxSavedBytes']) {
            sum[key] += Number(estimate[key]) || 0;
        }
        sum.count += 1;
        return sum;
    }, { count: 0, originalSize: 0, estimatedSize: 0, minSize: 0, maxSize: 0, savedBytes: 0, minSavedBytes: 0, maxSavedBytes: 0 });
}

export function resourceProcessing(resource, settings, analysis = {}) {
    if (resourceRemovalSelected(resource, settings)) return 'remove';
    if (resource.name === 'mimetype' && analysis.warnings?.some(warning => (typeof warning === 'string' ? warning : warning?.code) === 'NONSTANDARD_MIMETYPE')) return 'structure';
    if (resourceSettings(resource, settings, analysis).enabled && ['image', 'font'].includes(resource.kind)) return resource.kind;
    if (settings.recompress && resource.canRecompress === true && !resource.encrypted) return 'recompress';
    return 'keep';
}

export function filterResources(resources, filter, query, settings = defaultSettings(), analysis = {}) {
    const needle = query.trim().toLocaleLowerCase();
    return resources.filter(resource => {
        if (needle && !resource.name.toLocaleLowerCase().includes(needle)) return false;
        if (filter === 'all') return true;
        if (filter === 'unused') return resource.canRemove === true && !resource.isCover && !resource.encrypted && !resource.name.startsWith('META-INF/');
        if (filter === 'convert') return ['image', 'font'].includes(resourceProcessing(resource, settings, analysis));
        if (filter === 'remove') return resourceProcessing(resource, settings, analysis) === 'remove';
        return resource.kind === filter;
    });
}

export function sortResources(resources, order = 'size') {
    const sorted = [...resources];
    if (order === 'archive') return sorted;
    const compareNames = (left, right) => left.name.localeCompare(right.name, undefined, { numeric: true });
    return sorted.sort((left, right) => order === 'name' ? compareNames(left, right)
        : (Number(right.compressedSize) || 0) - (Number(left.compressedSize) || 0) || compareNames(left, right));
}

export function createResultLog(files, outcomes, text, errorText) {
    const stats = { success: [], skip: [], error: [] };
    const outputFiles = [];
    for (const file of files) {
        const outcome = outcomes.get(file.path);
        if (!outcome) continue;
        const lines = [file.name, file.path];
        if (outcome.backupPath) lines.push(`${text('backupPath')}: ${outcome.backupPath}`);
        const warnings = (outcome.warnings || []).map(warning => typeof warning === 'string' ? text(warning) || text('unavailable')
            : text(warning.code) || warning.message || text('unavailable'));
        if (outcome.status === 'saved') {
            lines.push(`${text('originalSize')}: ${formatBytes(outcome.originalSize)}`, `${text('actualSize')}: ${formatBytes(outcome.outputSize)}`,
                `${text('actualSavings')}: ${formatBytes(outcome.savedBytes)}`, `${text('outputPath')}: ${outcome.outputPath}`);
            if (outcome.removedResources?.length) {
                const size = outcome.removedResources.reduce((sum, resource) => sum + (Number(resource.compressedSize) || 0), 0);
                lines.push(text('removedResources', { count: outcome.removedResources.length, size: formatBytes(size) }),
                    ...outcome.removedResources.map(resource => `- ${resource.name}`));
            }
            lines.push(...warnings);
            stats.success.push(lines.join('\n'));
            outputFiles.push(outcome.outputPath);
        } else if (outcome.status === 'unchanged' || isCancelled(outcome)) {
            lines.push(text(outcome.status === 'unchanged' ? 'unchanged' : 'cancelled'), ...warnings);
            stats.skip.push(lines.join('\n'));
        } else {
            lines.push(errorText(outcome));
            stats.error.push(lines.join('\n'));
        }
    }
    return { stats, outputFiles, cancelled: [...outcomes.values()].some(isCancelled) };
}
