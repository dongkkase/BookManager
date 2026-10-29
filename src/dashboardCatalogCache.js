import { summarizeDashboardCatalog } from './readingDashboardState.js';
import { createDailyRecommendationIndex } from './dailyRecommendationState.js';
import { recommendationPreferenceOptions, recommendationPreferencesKey } from './recommendationPreferencesState.js';

const EMPTY_FILES = [];
const catalogCache = new WeakMap();

function cachedCatalog(files) {
    const source = Array.isArray(files) ? files : EMPTY_FILES;
    let cached = catalogCache.get(source);
    if (!cached) {
        cached = { source };
        catalogCache.set(source, cached);
    }
    return cached;
}

// Catalog snapshots are immutable; a replacement array invalidates every derived value.
export function dashboardCatalogSummary(files, limit = 6) {
    const cached = cachedCatalog(files);
    const maxItems = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 6;
    if (cached.summary?.limit !== maxItems) {
        cached.summary = { limit: maxItems, value: summarizeDashboardCatalog(cached.source, maxItems) };
    }
    return cached.summary.value;
}

export function dashboardRecommendationIndex(files, platform = '', preferences) {
    const cached = cachedCatalog(files);
    const preferencesKey = recommendationPreferencesKey(preferences);
    if (cached.recommendation?.platform !== platform || cached.recommendation.preferencesKey !== preferencesKey) {
        cached.recommendation = {
            platform, preferencesKey,
            value: createDailyRecommendationIndex(cached.source, platform, preferences),
        };
    }
    return cached.recommendation.value;
}

export function dashboardRecommendationOptions(files) {
    const cached = cachedCatalog(files);
    cached.options ??= recommendationPreferenceOptions(cached.source);
    return cached.options;
}
