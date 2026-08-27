import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
const isViewerWindow = new URLSearchParams(window.location.search).get('viewer') === '1';

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

  root.render(app);
}

if (isViewerWindow) {
  import('./ViewerApp.jsx')
    .then(module => renderRoot(module.default))
    .catch(error => {
      console.error('[BookManager] Viewer failed to load.', error);
      root.render(<div className="app-error">뷰어를 시작하지 못했습니다.</div>);
    });
} else {
  renderRoot(App);
}
