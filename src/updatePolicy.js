function parseVersion(value) {
    const match = String(value || '').trim().match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    if (!leftParts || !rightParts) return 0;

    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] > rightParts[index] ? 1 : -1;
        }
    }
    return 0;
}

export function shouldOpenUpdatePage(response) {
    return response === 'yes';
}

export function resolveUpdateInfo(currentVersion, releasesResult) {
    const releases = Array.isArray(releasesResult)
        ? releasesResult
        : releasesResult?.releases || [];
    const candidates = releases
        .filter(release => !release?.draft && !release?.prerelease)
        .map(release => ({
            version: parseVersion(release.tag || release.name)?.join('.'),
            url: release.url || '',
        }))
        .filter(release => release.version);
    candidates.sort((left, right) => compareVersions(right.version, left.version));
    const latest = candidates[0];

    if (!latest || compareVersions(latest.version, currentVersion) <= 0) {
        return { available: false, latestVersion: '', url: '' };
    }
    return {
        available: true,
        latestVersion: latest.version,
        url: latest.url,
    };
}
