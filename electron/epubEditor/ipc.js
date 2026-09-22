import path from 'node:path';

export function registerEpubEditorIpc({ ipcMain, app, BrowserWindow, dialog, openViewerPreview }) {
    let servicePromise;
    const owners = new Set();
    const pendingUnloads = new Map();
    const service = () => servicePromise ||= import('./service.js').then(({ EpubEditorService }) => new EpubEditorService(path.join(app.getPath('userData'), 'epub-editor')));
    ipcMain.handle('tools:epubEditor', async (event, request = {}) => {
        const owner = event.sender.id;
        const window = BrowserWindow.fromWebContents(event.sender);
        const progress = value => { if (!event.sender.isDestroyed()) event.sender.send('tools:epubEditor:progress', { operationId: request.operationId, value }); };
        try {
            const editor = await service();
            if (!owners.has(owner)) {
                owners.add(owner);
                let closing = false;
                window?.on('close', closeEvent => { closing = !closeEvent.defaultPrevented; });
                event.sender.on('will-prevent-unload', () => {
                    pendingUnloads.set(owner, closing ? 'close' : 'reload');
                    closing = false;
                    if (!event.sender.isDestroyed()) event.sender.send('tools:epubEditor:flush');
                });
                event.sender.once('destroyed', () => { owners.delete(owner); pendingUnloads.delete(owner); void editor.dispose(owner); });
                event.sender.on('did-navigate', () => { pendingUnloads.delete(owner); void editor.dispose(owner); });
            }
            const { action, sessionId, project, operationId } = request;
            let result;
            if (action === 'list') result = { projects: await editor.recoveries() };
            else if (action === 'recoveryDelete') result = await editor.deleteRecovery(request.id);
            else if (action === 'recoveryDuplicate') result = await editor.duplicateRecovery(owner, request.id, request.language);
            else if (action === 'cssPresetList') result = await editor.cssPresets();
            else if (action === 'cssPresetSave') result = await editor.changeCssPreset(request.preset, request.revision);
            else if (action === 'cssPresetDelete') result = await editor.changeCssPreset({ id: request.presetId }, request.revision, true);
            else if (action === 'paragraphFormatList') result = await editor.paragraphFormats();
            else if (action === 'paragraphFormatSave') result = await editor.changeParagraphFormat(request.format, request.revision);
            else if (action === 'paragraphFormatDelete') result = await editor.changeParagraphFormat({ id: request.formatId }, request.revision, true);
            else if (action === 'templateList') result = await editor.contentTemplates();
            else if (action === 'templateSave') result = await editor.saveContentTemplate(owner, sessionId, request.template, request.revision, request.sourceTemplateId);
            else if (action === 'templateDelete') result = await editor.deleteContentTemplate(request.templateId, request.revision);
            else if (action === 'templateAsset') result = await editor.contentTemplateAsset(request.templateId, request.assetId);
            else if (action === 'templateImport') result = await editor.importContentTemplate(owner, sessionId, request.templateId, request.revision);
            else if (action === 'create') result = await editor.create(owner, request.template, request.language);
            else if (action === 'restore') result = await editor.restore(owner, request.id);
            else if (action === 'recover') result = await editor.recovery(owner, sessionId, project);
            else if (action === 'asset') result = await editor.asset(owner, sessionId, request.assetId);
            else if (action === 'editImage') result = await editor.editImage(owner, sessionId, request.assetId, request.data);
            else if (action === 'importAssets') result = await editor.importAssets(owner, sessionId, request.paths);
            else if (action === 'cancel') result = await editor.cancel(owner, operationId);
            else if (action === 'close') { await editor.close(owner, sessionId); result = {}; }
            else if (action === 'finishUnload') {
                const pending = pendingUnloads.get(owner);
                pendingUnloads.delete(owner);
                if (pending === 'close') window?.close();
                else if (pending === 'reload') event.sender.reload();
                result = {};
            }
            else if (action === 'readText') {
                editor.session(sessionId, owner);
                let filePath;
                if (!request.sourceId) {
                    const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Text', extensions: ['txt'] }] });
                    if (selected.canceled) return { ok: true, canceled: true };
                    filePath = selected.filePaths[0];
                }
                result = await editor.readText(owner, sessionId, { filePath, sourceId: request.sourceId, encoding: request.encoding, operationId });
            }
            else if (action === 'open') {
                const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'BookManager EPUB project', extensions: ['bmepub'] }] });
                if (selected.canceled) return { ok: true, canceled: true };
                result = await editor.open(owner, selected.filePaths[0], operationId, progress);
            } else if (action === 'addAsset') {
                editor.session(sessionId, owner);
                const kind = ['font', 'audio'].includes(request.kind) ? request.kind : 'image';
                const multiple = kind === 'image' && request.multiple === true;
                const selected = await dialog.showOpenDialog(window, { properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters: [{ name: kind === 'audio' ? 'Audio' : kind === 'font' ? 'Font' : 'Image', extensions: kind === 'audio' ? ['mp3', 'm4a'] : kind === 'font' ? ['ttf', 'otf', 'woff', 'woff2'] : ['png', 'jpg', 'jpeg'] }] });
                if (selected.canceled || !selected.filePaths?.length) return { ok: true, canceled: true };
                result = multiple ? await editor.importAssets(owner, sessionId, selected.filePaths, kind) : await editor.addAsset(owner, sessionId, selected.filePaths[0], kind);
            } else if (action === 'previewViewer') {
                if (typeof openViewerPreview !== 'function') throw Object.assign(new Error('VIEWER_UNAVAILABLE'), { code: 'VIEWER_UNAVAILABLE' });
                const preview = await editor.preview(owner, sessionId, project, operationId, progress);
                try {
                    if (event.sender.isDestroyed()) throw Object.assign(new Error('SESSION_CLOSED'), { code: 'SESSION_CLOSED' });
                    const opened = await openViewerPreview(preview.filePath, () => editor.releasePreview(preview.filePath));
                    if (!opened?.success) throw Object.assign(new Error('VIEWER_OPEN_FAILED'), { code: 'VIEWER_OPEN_FAILED' });
                    result = { revision: preview.revision };
                } catch (error) {
                    await editor.releasePreview(preview.filePath);
                    throw error;
                }
            } else if (action === 'save' || action === 'export') {
                const current = editor.session(sessionId, owner);
                let target = action === 'save' && !request.saveAs ? current.savedPath : null;
                if (!target) {
                    const extension = action === 'save' ? 'bmepub' : 'epub';
                    const title = String(project?.metadata?.title || 'book').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100).replace(/[. ]+$/, '') || 'book';
                    const selected = await dialog.showSaveDialog(window, { defaultPath: `${title}.${extension}`, filters: [{ name: action === 'save' ? 'BookManager EPUB project' : 'EPUB', extensions: [extension] }] });
                    if (selected.canceled || !selected.filePath) return { ok: true, canceled: true };
                    target = selected.filePath;
                    if (path.extname(target).toLowerCase() !== `.${extension}`) throw Object.assign(new Error('INVALID_TARGET'), { code: 'INVALID_TARGET' });
                }
                result = await editor.write(owner, sessionId, project, target, action, operationId, progress);
            } else throw Object.assign(new Error('INVALID_OPERATION'), { code: 'INVALID_OPERATION' });
            return { ok: true, ...result };
        } catch (error) {
            return { ok: false, error: { code: error.code || 'FILE_FAILED', message: error.message || String(error) } };
        }
    });
    return { dispose: async () => { if (servicePromise) await (await servicePromise).dispose(); } };
}
