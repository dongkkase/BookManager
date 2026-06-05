export interface FileMetadata {
  path: string;
  mtime: number;
  size: number;
  ext: string;
  resolution: string;
  title: string;
  series: string;
  series_group: string;
  volume: string;
  number: string;
  writer: string;
  creators: string;
  publisher: string;
  imprint: string;
  genre: string;
  volume_count: string;
  page_count: string;
  format: string;
  manga: string;
  language: string;
  rating: string;
  age_rating: string;
  publish_date: string;
  summary: string;
  characters: string;
  teams: string;
  locations: string;
  story_arc: string;
  tags: string;
  notes: string;
  web: string;
  thumb_path: string;
}

export interface SearchApiResult {
  b_id?: string;
  Title: string;
  Writer: string;
  Penciller?: string;
  Publisher: string;
  Summary: string;
  Series: string;
  Web: string;
  CoverUrl: string;
  Tags: string;
  Genre: string;
  LocalizedSeries: string;
  Count: string;
  Rating: string;
  RatingScore?: string;
  CommunityRating?: string;
  AgeRating?: string;
  PubDate?: string;
  Year?: string;
  Month?: string;
  Day?: string;
  Volume?: string;
  Number?: string;
  Characters?: string;
  PageCount?: string;
}

export interface DuplicateTarget {
  full_path: string;
  path: string;
  name: string;
  size: number;
}

// Task 관련 타입
export interface TaskInfo {
  taskId: string;
  name: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskProgress {
  taskId: string;
  progress: number;
  message: string;
  status?: string;
}

// Archive 관련 타입
export interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  modifiedTime: string;
}

export interface ComicInfo {
  series: string;
  number: string;
  volume: string;
  title: string;
  writer: string;
  penciller: string;
  inker: string;
  colorist: string;
  letterer: string;
  coverArtist: string;
  summary: string;
  notes: string;
  genre: string;
  publishers: string;
  imprints: string;
  characters: string;
  teams: string;
  locations: string;
  storyArc: string;
  date: string;
  web: string;
  ageRating: string;
  rating: string;
  language: string;
  pageCount: string;
  format: string;
  manga: string;
  pageCountOverride: string;
  blackAndWhite: string;
  scannedBy: string;
}

// Image 관련 타입
export interface ImageOptimizeOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: string;
}

// File System 관련 타입
export interface FileSystemStats {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  birthtime: string;
  birthtimeMs: number;
  mtime: string;
  mtimeMs: number;
  ctime: string;
  ctimeMs: number;
}

// Server 관련 타입
export interface ServerStatus {
  running: boolean;
  protocol?: string;
  port?: number;
  url?: string;
  error?: string;
}

// Update 관련 타입
export interface UpdateInfo {
  available: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloading?: boolean;
  progress?: number;
  error?: string;
}

// Dialog 관련 타입
export interface OpenDirectoryOptions {
  title?: string;
  defaultPath?: string;
  message?: string;
  buttonLabel?: string;
}

export interface OpenFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  properties?: string[];
}

export interface SaveFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface MessageDialogOptions {
  type?: 'info' | 'warning' | 'error' | 'question';
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

export interface MessageDialogResult {
  response: number;
  checkboxChecked?: boolean;
}
