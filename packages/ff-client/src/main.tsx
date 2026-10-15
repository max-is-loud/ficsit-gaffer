// Browser entry point: mounts <App /> into #root under StrictMode and loads the
// global stylesheet.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles/app.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Root element not found.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
