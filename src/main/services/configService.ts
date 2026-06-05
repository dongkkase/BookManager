import { app } from 'electron';
import { join } from 'path';
import fs from 'fs-extra';
import os from 'os';
import { AppConfig } from '../../shared/types';

export type { AppConfig };

class ConfigService {
  private configPath: string;
  private config: AppConfig;
  private defaultThreads: number;
  private safeMaxThreads: number;

  constructor() {
    this.configPath = join(app.getPath('userData'), 'config.json');
    
    const totalCores = os.cpus().length || 4;
    this.safeMaxThreads = totalCores <= 4 ? Math.max(1, totalCores - 1) : Math.max(1, totalCores - 2);
    this.defaultThreads = Math.max(1, Math.floor(totalCores * 0.5));

    this.config = this.getDefaultConfig();
    this.loadConfig();
  }

  private getDefaultConfig(): AppConfig {
    return {
      lang: app.getLocale().startsWith('ko') ? 'ko' : 'en',
      target_format: 'none',
      backup_on: false,
      flatten_folders: false,
      webp_conversion: false,
      img_quality: 100,
      jpg_quality: 85,
      max_threads: this.defaultThreads,
      play_sound: true,
      viewer_path: '',
      dup_check_folders: [],
      font_family: 'Default',
      font_scale: 100,
      btn_primary: '#0078d7',
      start_num: 0,
      completion_sound: 'Default.wav',
      folder_view_mode: 'detail',
      folder_last_path: '',
      folder_main_splitter: '',
      folder_right_splitter: '',
      width: 1458,
      height: 980,
      is_maximized: false,
      last_tab_index: 0,
    };
  }

  public loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data);
        this.config = { ...this.config, ...parsed };
        
        // Ensure max_threads is within safe limits
        this.config.max_threads = Math.min(this.config.max_threads, this.safeMaxThreads);
      } else {
        this.saveConfig();
      }
    } catch (e) {
      console.error('Failed to load config', e);
    }
  }

  public saveConfig(newConfig?: Partial<AppConfig>): void {
    if (newConfig) {
      this.config = { ...this.config, ...newConfig };
    }
    try {
      fs.writeJsonSync(this.configPath, this.config, { spaces: 4 });
    } catch (e) {
      console.error('Failed to save config', e);
    }
  }

  public getConfig(): AppConfig {
    return this.config;
  }
}

// Lazy initialization - only create instance when app is ready
let _configService: ConfigService | null = null;

export function getConfigService(): ConfigService {
  if (!_configService) {
    _configService = new ConfigService();
  }
  return _configService;
}

// For backward compatibility - but only use after app.whenReady()
export const configService = {
  getConfig: () => getConfigService().getConfig(),
  saveConfig: (newConfig?: Partial<AppConfig>) => getConfigService().saveConfig(newConfig),
  loadConfig: () => getConfigService().loadConfig(),
};
