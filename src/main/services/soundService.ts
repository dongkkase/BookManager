import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 사운드 서비스
 * - 사운드 파일 재생 관리
 * - 사운드 설정 (음량, 활성화 여부)
 */
class SoundService {
  private enabled: boolean = true;
  private volume: number = 100;
  private soundCache: Map<string, string> = new Map();

  constructor() {
    this.loadSettings();
  }

  // 설정 로드
  private loadSettings(): void {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'sound-settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        this.enabled = settings.enabled ?? true;
        this.volume = settings.volume ?? 100;
      }
    } catch (error) {
      console.error('Sound settings load failed:', error);
    }
  }

  // 설정 저장
  public saveSettings(): void {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'sound-settings.json');
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ enabled: this.enabled, volume: this.volume }, null, 2)
      );
    } catch (error) {
      console.error('Sound settings save failed:', error);
    }
  }

  // 활성화 여부 설정
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.saveSettings();
  }

  // 활성화 여부 조회
  public isEnabled(): boolean {
    return this.enabled;
  }

  // 음량 설정
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    this.saveSettings();
  }

  // 음량 조회
  public getVolume(): number {
    return this.volume;
  }

  // 사운드 재생
  public async playSound(soundName: string): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      const soundPath = this.getSoundPath(soundName);
      if (!soundPath || !fs.existsSync(soundPath)) {
        console.warn(`Sound file not found: ${soundName}`);
        return false;
      }

      // 사운드 파일 재생 (macOS afplay 사용)
      const { exec } = require('child_process');
      return new Promise((resolve) => {
        exec(`afplay -v ${this.volume / 100} "${soundPath}"`, () => {
          resolve(true);
        });
      });
    } catch (error) {
      console.error(`Play sound failed: ${soundName}`, error);
      return false;
    }
  }

  // 사운드 파일 경로 조회
  private getSoundPath(soundName: string): string | null {
    if (this.soundCache.has(soundName)) {
      return this.soundCache.get(soundName)!;
    }

    const soundFiles: Record<string, string> = {
      success: 'success.wav',
      error: 'error.wav',
      warning: 'warning.wav',
      info: 'info.wav',
      click: 'click.wav',
    };

    const filename = soundFiles[soundName];
    if (!filename) {
      return null;
    }

    const soundPath = path.join(process.resourcesPath, 'sounds', filename);
    if (fs.existsSync(soundPath)) {
      this.soundCache.set(soundName, soundPath);
      return soundPath;
    }

    return null;
  }

  // 사용 가능한 사운드 목록 조회
  public getAvailableSounds(): string[] {
    return ['success', 'error', 'warning', 'info', 'click'];
  }
}

export const soundService = new SoundService();
