import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Self-hosted fonts: the wall tablet has no Internet access, so nothing may be
// fetched from a CDN (a blocked Google Fonts request stalls a hard refresh).
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
