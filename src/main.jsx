import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
const app = import.meta.env.VITE_REACT_STRICT_MODE === 'true'
  ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
  : <App />;

root.render(app);
