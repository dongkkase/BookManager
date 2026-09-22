import { parentPort, workerData } from 'node:worker_threads';
import { saveProjectPackage, openProjectPackage, exportEpubPackage } from './package.js';

try {
    const { operation, filePath, project, assetDirectory } = workerData;
    const progress = value => parentPort.postMessage({ type: 'progress', value });
    let result;
    if (operation === 'open') result = await openProjectPackage(filePath, assetDirectory);
    else if (operation === 'textImport') result = await (await import('./textImport.js')).readTextImport(filePath, workerData.encoding);
    else if (operation === 'save') await saveProjectPackage(filePath, project, assetDirectory, progress);
    else if (operation === 'export') await exportEpubPackage(filePath, project, assetDirectory, progress);
    else throw new Error('Unknown EPUB editor operation');
    parentPort.postMessage({ type: 'result', result });
} catch (error) {
    parentPort.postMessage({ type: 'error', code: error.code || 'FILE_FAILED', message: error.message });
}
