import { createRoot } from 'react-dom/client';
import { DocumentProvider } from './context/DocumentContext';
import { HighlightsProvider } from './context/HighlightsContext';
import { SettingsProvider } from './context/SettingsContext';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <SettingsProvider>
    <DocumentProvider>
      <HighlightsProvider>
        <App />
      </HighlightsProvider>
    </DocumentProvider>
  </SettingsProvider>
);
