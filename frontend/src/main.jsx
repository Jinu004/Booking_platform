import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'
import App from './App.jsx';
import { ClerkProvider } from "@clerk/clerk-react";
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

ReactDOM.createRoot(document.getElementById("root")).render(
  <ClerkProvider publishableKey={clerkPubKey}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </ClerkProvider>
);
