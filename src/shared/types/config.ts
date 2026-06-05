export interface AppConfig {
  lang: string;
  target_format: string;
  backup_on: boolean;
  flatten_folders: boolean;
  webp_conversion: boolean;
  img_quality: number;
  jpg_quality: number;
  max_threads: number;
  play_sound: boolean;
  viewer_path: string;
  dup_check_folders: string[];
  folder_view_mode: string;
  folder_last_path: string;
  folder_main_splitter: string;
  folder_right_splitter: string;
  width: number;
  height: number;
  is_maximized: boolean;
  last_tab_index: number;
  font_family: string;
  font_scale: number;
  btn_primary: string;
  start_num: number;
  completion_sound: string;
  [key: string]: any; // Allow dynamic fields if needed
}

export const DEFAULT_CONFIG: AppConfig = {
  lang: 'ko',
  target_format: 'none',
  backup_on: false,
  flatten_folders: false,
  webp_conversion: false,
  img_quality: 100,
  jpg_quality: 85,
  max_threads: 4,
  play_sound: true,
  viewer_path: '',
  dup_check_folders: [],
  folder_view_mode: 'detail',
  folder_last_path: '',
  folder_main_splitter: '',
  folder_right_splitter: '',
  width: 1458,
  height: 980,
  is_maximized: false,
  last_tab_index: 0,
  font_family: 'Default',
  font_scale: 100,
  btn_primary: '#0078d7',
  start_num: 0,
  completion_sound: 'Default.wav'
};
