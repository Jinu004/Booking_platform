import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'
import App from './App.jsx';
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered');

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
