import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');

if ('serviceWorker' in navigator) {
  const isLocalHost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]';

  if (import.meta.env.DEV || isLocalHost) {
    // Clear any previously registered local PWA service worker so local dev/preview never serves stale builds!
    navigator.serviceWorker.getRegistrations?.().then((regs) => {
      for (const reg of regs) reg.unregister().catch(() => undefined);
    }).catch(() => undefined);
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore SW registration failures on non-HTTPS previews
      });
    });
  }
}
