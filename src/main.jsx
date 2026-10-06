import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { TelemetryErrorBoundary } from './components/TelemetryErrorBoundary.jsx';
import { installTelemetryErrorHandlers, reportTelemetryError } from './telemetry.js';
import './styles/global.css';

const isViewerWindow = new URLSearchParams(window.location.search).get('viewer') === '1';
installTelemetryErrorHandlers({ source: isViewerWindow ? 'viewer' : 'renderer' });
const root = ReactDOM.createRoot(document.getElementById('root'));

if (isViewerWindow && document.head) {
  document.head.style.setProperty('display', 'none', 'important');
}

function renderRoot(Component) {
  const app = import.meta.env.VITE_REACT_STRICT_MODE === 'true'
    ? (
      <React.StrictMode>
        <Component />
      </React.StrictMode>
    )
    : <Component />;

    root.render(<TelemetryErrorBoundary source={isViewerWindow ? 'viewer-react' : 'renderer-react'}>{app}</TelemetryErrorBoundary>);
}

if (isViewerWindow) {
  import('./ViewerApp.jsx')
    .then(module => renderRoot(module.default))
    .catch(error => {
        reportTelemetryError(error, 'viewer-load');
      console.error('[BookManager] Viewer failed to load.', error);
      root.render(<div className="app-error">뷰어를 시작하지 못했습니다.</div>);
    });
} else {
  renderRoot(App);
}
