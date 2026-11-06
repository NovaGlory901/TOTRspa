import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import theme from './theme.js';
import App from './App.jsx';
import './style.css';

theme.setUser(''); // sign-in screen: look like the last person on this device did

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
