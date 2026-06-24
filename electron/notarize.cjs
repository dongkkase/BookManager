const path = require('node:path');
const { notarize } = require('@electron/notarize');

function resolveCredentials(env = process.env) {
    if (env.APPLE_KEYCHAIN_PROFILE) {
        return {
            keychainProfile: env.APPLE_KEYCHAIN_PROFILE,
            ...(env.APPLE_KEYCHAIN ? { keychain: env.APPLE_KEYCHAIN } : {}),
        };
    }

    if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
        return {
            appleApiKey: env.APPLE_API_KEY,
            appleApiKeyId: env.APPLE_API_KEY_ID,
            appleApiIssuer: env.APPLE_API_ISSUER,
        };
    }

    if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
        return {
            appleId: env.APPLE_ID,
            appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: env.APPLE_TEAM_ID,
        };
    }

    return null;
}

module.exports = async function notarizeAfterSign(context) {
    if (context.electronPlatformName !== 'darwin') return;

    const credentials = resolveCredentials();
    if (!credentials) {
        console.warn('[notarize] Apple notarization credentials are not configured. Skipping notarization.');
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);
    console.log(`[notarize] Submitting ${appPath}`);

    await notarize({
        tool: 'notarytool',
        appPath,
        ...credentials,
    });
};

module.exports.resolveCredentials = resolveCredentials;
