import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      const scriptUrl =
        registration.active?.scriptURL ||
        registration.waiting?.scriptURL ||
        registration.installing?.scriptURL ||
        '';
      if (scriptUrl.includes('dev-sw') || scriptUrl.includes('@vite')) {
        void registration.unregister();
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
