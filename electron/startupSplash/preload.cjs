const { ipcRenderer } = require('electron');

let pendingStage = null;

function renderStage(stage) {
    if (!stage || typeof stage.label !== 'string' || ![1, 2, 3].includes(stage.value)) return;
    pendingStage = stage;
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = stage.label;
    document.getElementById('stage').textContent = `${stage.value} / 3`;
    document.getElementById('fill').style.width = `${stage.value / 3 * 100}%`;
    const progress = document.getElementById('progress');
    progress.setAttribute('aria-valuenow', String(stage.value));
    progress.setAttribute('aria-valuetext', stage.label);
}

ipcRenderer.on('bookmanager:startup-stage', (_event, stage) => renderStage(stage));
window.addEventListener('DOMContentLoaded', () => renderStage(pendingStage), { once: true });
