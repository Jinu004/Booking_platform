import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css'
import App from './App.jsx';
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';

Sentry.init({
  dsn: "https://4e4fbd4d0bf1025ff3892ff51ed8d870@o4512141900578816.ingest.de.sentry.io/4512142217904208",
  beforeSend(event) {
    const redact = (str) => {
      if (typeof str !== 'string') return str;
      return str
        .replace(/\b\d{10,15}\b/g, '[redacted-phone]')
        .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[redacted-email]');
    };
    if (event.exception?.values) {
      event.exception.values.forEach(ex => {
        if (ex.value) ex.value = redact(ex.value);
      });
    }
    if (event.message) event.message = redact(event.message);
    return event;
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('swUpdateAvailable', { detail: reg }))
          }
        })
      })

      // Request push permission after login
      if ('PushManager' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const res = await fetch('/api/v1/push/vapid-key');
          const { publicKey } = await res.json();

          const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: publicKey
          });

          const token = localStorage.getItem('auth_token');
          if (token) {
            await fetch('/api/v1/push/subscribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ subscription })
            });
          }
        }
      }
    } catch (err) {
      console.log('SW registration failed:', err);
    }
  });
}
