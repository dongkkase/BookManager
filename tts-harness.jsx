import React from 'react';
import { createRoot } from 'react-dom/client';
import EpubEditorTool from './src/features/fileTools/epubEditor/EpubEditorTool.jsx';
import { createProject, paragraph, validateProject } from './electron/epubEditor/model.js';
import { setLanguage } from './src/utils/i18n.js';
setLanguage('ko');
let snapshot;
window.electronAPI = {
    epubEditor: async request => {
        if (request.action === 'list') return { ok: true, projects: [] };
        if (request.action === 'paragraphFormatList') return { ok: true, formats: [] };
        if (request.action === 'create') {
            const project = createProject();
            project.metadata.title = 'TTS 검증';
            project.chapters[0].content = { type: 'doc', content: [paragraph('CPU (중요한 설명) C++ 3명. CPU를 읽습니다.'), paragraph('다음 문단입니다.')] };
            return { ok: true, sessionId: 'tts-test', savedRevision: -1, project };
        }
        if (request.project) {
            validateProject(request.project);
            snapshot = structuredClone(request.project);
            const log = document.querySelector('#test-result');
            if (log) log.textContent = JSON.stringify({action: request.action, dictionary: snapshot.tts?.dictionary, content: snapshot.chapters[0].content});
            return { ok: true, revision: request.project.revision };
        }
        return { ok: true };
    },
    onEpubEditorProgress: () => () => {},
    onEpubEditorFlush: () => () => {},
};
createRoot(document.getElementById('root')).render(<><div style={{height:'calc(100vh - 48px)'}}><EpubEditorTool onBack={() => {}} showToast={() => {}} /></div><output id="test-result" style={{display:'block',height:48,overflow:'auto',fontSize:10}}>아직 저장하지 않음</output></>);
