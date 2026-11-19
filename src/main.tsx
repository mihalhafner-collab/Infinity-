import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {isNativeAndroidApp} from './services/nativeBridge.ts';
import './utils/invoicePdf.ts';

const WEB_APP_BUNDLE_VERSION = '2026-11-19-v4-infinity';
const WEB_APP_VERSION_KEY = 'hafner_web_bundle_version';

if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && !isNativeAndroidApp()) {
  const previousVersion = localStorage.getItem(WEB_APP_VERSION_KEY);
  if (previousVersion !== WEB_APP_BUNDLE_VERSION) {
    localStorage.setItem(WEB_APP_VERSION_KEY, WEB_APP_BUNDLE_VERSION);
    if ('caches' in window) {
      void caches.keys().then((keys) => {
        for (const key of keys) {
          void caches.delete(key);
        }
      });
    }
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          void registration.update();
        }
      });
    }
  } else if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        const scriptUrl =
          registration.active?.scriptURL ||
          registration.waiting?.scriptURL ||
          registration.installing?.scriptURL ||
          '';
        if (import.meta.env.DEV && (scriptUrl.includes('dev-sw') || scriptUrl.includes('@vite'))) {
          void registration.unregister();
        } else {
          void registration.update();
        }
      }
    });
  }

  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    let swReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloading) return;
      swReloading = true;
      window.location.reload();
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);

