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
