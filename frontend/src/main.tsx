import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import App from './App';
import { WidgetApp } from './components/WidgetApp';
import { api } from './services/api';

const Root: React.FC = () => {
  const [mode, setMode] = useState<'loading' | 'main' | 'widget'>('loading');

  useEffect(() => {
    void api.isWidgetMode().then((isWidget) => {
      setMode(isWidget ? 'widget' : 'main');
    });
  }, []);

  if (mode === 'loading') {
    return null;
  }

  return mode === 'widget' ? <WidgetApp /> : <App />;
};

const container = document.getElementById('root');
const root = createRoot(container!);

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
