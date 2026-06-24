import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const WINDOWS_UPDATE_LOG_NAME = 'install-update.log';

const UPDATE_SPECS = Object.freeze({
    darwin: {
        assetName: 'BookManager-mac.zip',
        entryName: 'BookManager.app',
    },
    win32: {
        assetName: 'BookManager-win.zip',
        entryName: 'BookManager.exe',
    },
});

export function getPlatformUpdateSpec(platform = process.platform) {
    return UPDATE_SPECS[platform] || null;
}

export function findUpdateAsset(assets = [], platform = process.platform) {
    const spec = getPlatformUpdateSpec(platform);
    if (!spec || !Array.isArray(assets)) return null;
    return assets.find(asset => String(asset?.name || '').toLowerCase() === spec.assetName.toLowerCase()) || null;
}

export function isAllowedUpdateDownloadUrl(value, expectedAssetName) {
    try {
        const url = new URL(value);
        const pathname = decodeURIComponent(url.pathname || '');
        return url.protocol === 'https:'
            && url.hostname === 'github.com'
            && pathname.startsWith('/dongkkase/BookManager/releases/download/')
            && path.posix.basename(pathname) === expectedAssetName;
    } catch {
        return false;
    }
}

export function resolveCurrentMacAppPath(exePath) {
    let currentPath = path.resolve(String(exePath || ''));
    while (currentPath && currentPath !== path.dirname(currentPath)) {
        if (currentPath.endsWith('.app')) return currentPath;
        currentPath = path.dirname(currentPath);
    }
    return '';
}

export function resolveUpdateTargetPath({ app, env = process.env, exePath = '', platform = process.platform } = {}) {
    const currentExePath = exePath || app?.getPath?.('exe') || process.execPath;
    if (platform === 'win32') {
        return env.PORTABLE_EXECUTABLE_FILE || currentExePath;
    }
    if (platform === 'darwin') {
        return resolveCurrentMacAppPath(currentExePath);
    }
    return '';
}

export function assertTargetDirectoryWritable(targetPath, { processId = process.pid } = {}) {
    const targetDir = path.dirname(targetPath);
    const probePath = path.join(targetDir, `.bookmanager-update-write-test-${processId}-${Date.now()}.tmp`);
    fs.writeFileSync(probePath, '');
    fs.rmSync(probePath, { force: true });
}

function downloadFile(url, destinationPath, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error('Too many redirects'));
            return;
        }

        const target = new URL(url);
        if (target.protocol !== 'https:') {
            reject(new Error('Only HTTPS update downloads are allowed'));
            return;
        }

        const request = https.get(target, {
            headers: {
                'User-Agent': 'BookManager',
                'Accept': 'application/octet-stream',
            },
        }, response => {
            const statusCode = response.statusCode || 0;
            if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
                response.resume();
                const redirectedUrl = new URL(response.headers.location, target).toString();
                downloadFile(redirectedUrl, destinationPath, redirectCount + 1).then(resolve, reject);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(new Error(`HTTP ${statusCode}`));
                return;
            }

            const file = fs.createWriteStream(destinationPath);
            response.on('error', error => {
                file.destroy();
                reject(error);
            });
            file.on('error', reject);
            file.on('finish', () => file.close(resolve));
            response.pipe(file);
        });

        request.setTimeout(60000, () => request.destroy(new Error('Update download timeout')));
        request.on('error', reject);
    });
}

async function extractUpdateArchive(zipPath, extractDir, platform = process.platform) {
    fs.mkdirSync(extractDir, { recursive: true });
    if (platform === 'darwin') {
        await execFileAsync('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir]);
        return;
    }
    if (platform === 'win32') {
        await execFileAsync('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            '& { param($zipPath, $extractDir) Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force }',
            zipPath,
            extractDir,
        ], { windowsHide: true });
        return;
    }
    throw new Error(`Unsupported update platform: ${platform}`);
}

function resolveExtractedUpdatePath(extractDir, platform = process.platform) {
    const spec = getPlatformUpdateSpec(platform);
    if (!spec) return '';
    return path.join(extractDir, spec.entryName);
}

function createMacUpdaterScript() {
    return `#!/bin/sh
APP_PID="$1"
SOURCE_PATH="$2"
TARGET_PATH="$3"

while kill -0 "$APP_PID" 2>/dev/null; do
    sleep 1
done

for ATTEMPT in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60; do
    BACKUP_PATH="$TARGET_PATH.backup-$(date +%Y%m%d%H%M%S)-$ATTEMPT"
    if [ -d "$TARGET_PATH" ]; then
        mv "$TARGET_PATH" "$BACKUP_PATH" || {
            sleep 1
            continue
        }
    fi

    if /usr/bin/ditto "$SOURCE_PATH" "$TARGET_PATH"; then
        rm -rf "$BACKUP_PATH"
        xattr -dr com.apple.quarantine "$TARGET_PATH" 2>/dev/null || true
        open "$TARGET_PATH"
        exit 0
    fi

    rm -rf "$TARGET_PATH"
    if [ -d "$BACKUP_PATH" ]; then
        mv "$BACKUP_PATH" "$TARGET_PATH"
    fi
    sleep 1
done

exit 1
`;
}

export function createWindowsUpdaterScript() {
    return `param(
    [int]$TargetProcessId,
    [string]$SourcePath,
    [string]$TargetPath,
    [string]$LogPath
)

$ErrorActionPreference = 'Stop'

function Write-UpdateLog {
    param([string]$Message)
    if (-not $LogPath) {
        return
    }
    try {
        $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
        Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message" -Encoding UTF8
    } catch {}
}

function Get-FileHashValue {
    param([string]$FilePath)
    try {
        return (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash
    } catch {
        Write-UpdateLog "hash unavailable: $($_.Exception.Message)"
        return ''
    }
}

function Restore-Backup {
    param([string]$BackupPath)
    try {
        if (Test-Path -LiteralPath $TargetPath) {
            Remove-Item -LiteralPath $TargetPath -Force
        }
        if (Test-Path -LiteralPath $BackupPath) {
            Move-Item -LiteralPath $BackupPath -Destination $TargetPath -Force
        }
    } catch {
        Write-UpdateLog "restore failed: $($_.Exception.Message)"
    }
}

Write-UpdateLog "start pid=$TargetProcessId source=$SourcePath target=$TargetPath"

try {
    if ($TargetProcessId -gt 0) {
        Wait-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
    }
} catch {
    Write-UpdateLog "wait skipped: $($_.Exception.Message)"
}
Start-Sleep -Milliseconds 1200

if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    Write-UpdateLog "source missing"
    exit 2
}

$sourceHash = Get-FileHashValue $SourcePath

$updated = $false
for ($attempt = 1; $attempt -le 60 -and -not $updated; $attempt += 1) {
    $backupPath = "$($TargetPath).backup-$(Get-Date -Format yyyyMMddHHmmss)-$attempt"
    try {
        Write-UpdateLog "attempt $attempt"
        if (Test-Path -LiteralPath $TargetPath) {
            Move-Item -LiteralPath $TargetPath -Destination $backupPath -Force
        }
        Copy-Item -LiteralPath $SourcePath -Destination $TargetPath -Force
        $targetHash = Get-FileHashValue $TargetPath
        if ($sourceHash -and $targetHash -and $sourceHash -ne $targetHash) {
            throw "copied file hash mismatch"
        }
        if (Test-Path -LiteralPath $backupPath) {
            Remove-Item -LiteralPath $backupPath -Force
        }
        $updated = $true
        Write-UpdateLog "copy complete"
    } catch {
        Write-UpdateLog "attempt $attempt failed: $($_.Exception.Message)"
        Restore-Backup $backupPath
        Start-Sleep -Seconds 1
    }
}

if (-not $updated) {
    Write-UpdateLog "update failed"
    exit 1
}

try {
    Start-Process -FilePath $TargetPath -WorkingDirectory (Split-Path -Parent $TargetPath)
    Write-UpdateLog "restart launched"
} catch {
    Write-UpdateLog "restart failed: $($_.Exception.Message)"
    exit 3
}
`;
}

function writeUpdaterScript(updateDir, platform = process.platform) {
    if (platform === 'darwin') {
        const scriptPath = path.join(updateDir, 'install-update.sh');
        fs.writeFileSync(scriptPath, createMacUpdaterScript(), { mode: 0o755 });
        return scriptPath;
    }
    if (platform === 'win32') {
        const scriptPath = path.join(updateDir, 'install-update.ps1');
        fs.writeFileSync(scriptPath, createWindowsUpdaterScript(), 'utf8');
        return scriptPath;
    }
    return '';
}

export function createWindowsUpdaterLaunchArgs({ scriptPath, sourcePath, targetPath, logPath, processId = process.pid }) {
    return [
        '/d',
        '/s',
        '/c',
        'start',
        '',
        '/min',
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-TargetProcessId',
        String(processId),
        '-SourcePath',
        sourcePath,
        '-TargetPath',
        targetPath,
        '-LogPath',
        logPath,
    ];
}

function launchUpdaterScript({ scriptPath, sourcePath, targetPath, platform = process.platform, processId = process.pid }) {
    const logPath = platform === 'win32'
        ? path.join(path.dirname(scriptPath), WINDOWS_UPDATE_LOG_NAME)
        : '';
    const child = platform === 'win32'
        ? spawn('cmd.exe', createWindowsUpdaterLaunchArgs({
            scriptPath,
            sourcePath,
            targetPath,
            logPath,
            processId,
        }), { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn('/bin/sh', [
            scriptPath,
            String(processId),
            sourcePath,
            targetPath,
        ], { detached: true, stdio: 'ignore' });
    child.unref();
}

export async function installAppUpdate(options = {}, runtime = {}) {
    const platform = runtime.platform || process.platform;
    const spec = getPlatformUpdateSpec(platform);
    if (!spec) return { success: false, code: 'UNSUPPORTED_PLATFORM' };

    const electronApp = runtime.app;
    if (!runtime.allowUnpackaged && electronApp?.isPackaged === false) {
        return { success: false, code: 'NOT_PACKAGED' };
    }

    const asset = findUpdateAsset(options.assets, platform);
    if (!asset?.downloadUrl) return { success: false, code: 'ASSET_NOT_FOUND' };
    if (!isAllowedUpdateDownloadUrl(asset.downloadUrl, spec.assetName)) {
        return { success: false, code: 'DOWNLOAD_URL_BLOCKED' };
    }

    const targetPath = resolveUpdateTargetPath({
        app: electronApp,
        env: runtime.env || process.env,
        exePath: runtime.exePath,
        platform,
    });
    if (!targetPath || !fs.existsSync(targetPath)) {
        return { success: false, code: 'TARGET_NOT_FOUND' };
    }
    if (platform === 'win32') {
        try {
            assertTargetDirectoryWritable(targetPath, { processId: runtime.processId || process.pid });
        } catch (error) {
            return {
                success: false,
                code: 'TARGET_NOT_WRITABLE',
                message: error.message || String(error),
            };
        }
    }

    const updateDir = fs.mkdtempSync(path.join(runtime.tempRoot || os.tmpdir(), 'bookmanager-update-'));
    let keepUpdateDir = false;
    try {
        const zipPath = path.join(updateDir, spec.assetName);
        const extractDir = path.join(updateDir, 'extracted');
        await downloadFile(asset.downloadUrl, zipPath);
        await extractUpdateArchive(zipPath, extractDir, platform);

        const sourcePath = resolveExtractedUpdatePath(extractDir, platform);
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return { success: false, code: 'EXTRACTED_APP_NOT_FOUND' };
        }

        const scriptPath = writeUpdaterScript(updateDir, platform);
        if (!scriptPath) return { success: false, code: 'UNSUPPORTED_PLATFORM' };
        launchUpdaterScript({
            scriptPath,
            sourcePath,
            targetPath,
            platform,
            processId: runtime.processId || process.pid,
        });
        keepUpdateDir = true;
        if (runtime.quit !== false && electronApp?.quit) {
            setTimeout(() => electronApp.quit(), 100);
        }
        return { success: true };
    } catch (error) {
        return {
            success: false,
            code: 'UPDATE_FAILED',
            message: error.message || String(error),
        };
    } finally {
        if (!keepUpdateDir) {
            fs.rmSync(updateDir, { recursive: true, force: true });
        }
    }
}
