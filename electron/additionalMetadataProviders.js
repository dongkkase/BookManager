import { searchCatalogMetadataProvider } from './catalogMetadataProviders.js';
import { searchWebMetadataProvider } from './webMetadataProviders.js';
import { searchAudioMetadataProvider } from './audioMetadataProviders.js';
import { normalizeHardcoverToken, normalizeMetadataProviderSettings } from './metadataProviderSettings.js';

const CATALOG_PROVIDERS = { 'Open Library': 'openlibrary', iTunes: 'itunes', Hardcover: 'hardcover', RanobeDB: 'ranobedb' };
const AUDIO_PROVIDERS = { Audible: 'audible', AudNexus: 'audnexus', 'Libro.fm': 'librofm' };
const ERROR_KEYS = {
    API_AUTH_REQUIRED: 'api_provider_auth_required',
    API_AUTH_FAILED: 'api_provider_auth_failed',
    API_RATE_LIMIT: 'api_provider_rate_limit',
    API_INVALID_RESPONSE: 'api_provider_invalid_response',
    METADATA_RESPONSE_INVALID: 'api_provider_invalid_response',
    API_ACCESS_BLOCKED: 'api_provider_blocked',
    METADATA_ACCESS_BLOCKED: 'api_provider_blocked',
};

export function additionalMetadataErrorMessage(error, api, translate) {
    return translate(ERROR_KEYS[error?.code] || 'api_provider_request_failed', { api });
}

export function createAdditionalMetadataContext(api, config = {}, apiKeys = {}) {
    const settings = normalizeMetadataProviderSettings(config.metadata_providers);
    const variants = {
        iTunes: [settings.itunes_country, settings.itunes_cover_resolution],
        Kobo: [settings.kobo_country, settings.kobo_language],
        Audible: [settings.audible_region],
        AudNexus: [settings.audible_region],
    };
    return {
        settings,
        cacheSuffix: `::providers-v1::${JSON.stringify(variants[api] || [])}`,
        errorCode: api === 'Hardcover' && !normalizeHardcoverToken(apiKeys.hardcover) ? 'API_AUTH_REQUIRED' : '',
    };
}

export async function searchAdditionalMetadataProvider(api, options, runtime) {
    if (Object.hasOwn(CATALOG_PROVIDERS, api)) {
        const items = await searchCatalogMetadataProvider(CATALOG_PROVIDERS[api], options, runtime);
        if (api === 'iTunes') items.hasNext = false;
        return items;
    }
    if (Object.hasOwn(AUDIO_PROVIDERS, api)) return searchAudioMetadataProvider(AUDIO_PROVIDERS[api], options, runtime);
    return searchWebMetadataProvider(api, options, runtime);
}
