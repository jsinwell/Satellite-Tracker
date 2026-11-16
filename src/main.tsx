import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './app/boot';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing the #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Started here rather than in an effect: loading is a one-off for the page,
// not something tied to a component's lifetime.
void boot();
