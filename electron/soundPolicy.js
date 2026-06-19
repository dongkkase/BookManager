import path from 'node:path';

const SOUND_EXTENSIONS = new Set(['.mp3', '.wav']);

export function normalizeSoundFilename(value) {
    const filename = String(value || '').trim();
    if (!filename || path.basename(filename) !== filename) return '';
    return SOUND_EXTENSIONS.has(path.extname(filename).toLowerCase()) ? filename : '';
}

export function createSoundCommand(platform, soundPath) {
    if (platform === 'darwin') {
        return {
            command: 'afplay',
            args: [soundPath],
            env: {},
        };
    }
    if (platform === 'win32') {
        return {
            command: 'powershell.exe',
            args: [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                [
                    'Add-Type -AssemblyName presentationCore',
                    '$player = New-Object System.Windows.Media.MediaPlayer',
                    '$player.Open([Uri]$env:BOOKMANAGER_SOUND_PATH)',
                    'Start-Sleep -Milliseconds 300',
                    '$player.Play()',
                    'Start-Sleep -Milliseconds ([Math]::Max(500, [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds + 200))',
                    '$player.Close()',
                ].join('; '),
            ],
            env: { BOOKMANAGER_SOUND_PATH: soundPath },
        };
    }
    return {
        command: 'ffplay',
        args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', soundPath],
        env: {},
    };
}
