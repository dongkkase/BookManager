import { installConsolePipeGuard } from './utils/consolePipeGuard.js';

installConsolePipeGuard();

await import('./main.js');
