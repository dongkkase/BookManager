/**
 * IPC 채널 상수
 * Main Process와 Renderer Process 간 통신 채널 정의
 */
export const IPC_CHANNELS = {
  // === Config 관련 ===
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',

  // === DB 관련 ===
  DB_GET_FILE_INFO: 'db:getFileInfo',
  DB_UPSERT_FILE_INFO: 'db:upsertFileInfo',
  DB_GET_ALL_FILES: 'db:getAllFiles',
  DB_CLEAR_DUP_CACHE: 'db:clearDupCache',

  // === Task 관련 ===
  TASK_REGISTER: 'task:register',
  TASK_CANCEL: 'task:cancel',
  TASK_PAUSE: 'task:pause',
  TASK_RESUME: 'task:resume',
  TASK_GET_INFO: 'task:getInfo',
  TASK_GET_ALL_INFO: 'task:getAllInfo',
  TASK_PROGRESS: 'task:progress', // Main -> Renderer (send)

  // === Archive 관련 ===
  ARCHIVE_LIST: 'archive:list',
  ARCHIVE_EXTRACT: 'archive:extract',
  ARCHIVE_EXTRACT_COVER: 'archive:extractCover',
  ARCHIVE_READ_FILE: 'archive:readFile',
  ARCHIVE_READ_COMIC_INFO: 'archive:readComicInfo',
  ARCHIVE_INJECT_COMIC_INFO: 'archive:injectComicInfo',
  ARCHIVE_COMPRESS: 'archive:compress',
  ARCHIVE_RENAME_INNER: 'archive:renameInner',

  // === Image 관련 ===
  IMAGE_OPTIMIZE: 'image:optimize',
  IMAGE_GET_DIMENSIONS: 'image:getDimensions',

  // === Dialog 관련 ===
  DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  DIALOG_SHOW_MESSAGE: 'dialog:showMessage',

  // === Shell 관련 ===
  SHELL_OPEN_PATH: 'shell:openPath',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // === File System 관련 ===
  FS_READ_DIR: 'fs:readDir',
  FS_EXISTS: 'fs:exists',
  FS_STAT: 'fs:stat',

  // === Sound 관련 ===
  SOUND_PLAY: 'sound:play',

  // === Server 관련 ===
  SERVER_START: 'server:start',
  SERVER_STOP: 'server:stop',
  SERVER_STATUS: 'server:status',

  // === Update 관련 ===
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
} as const;

/**
 * IPC 채널 타입
 */
export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
