import React, { useState } from 'react';
import { SignIn } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const isBypass = import.meta.env.VITE_BYPASS_AUTH === 'true';
  const navigate = useNavigate();
  const [bypassLoading, setBypassLoading] = useState(false);

  const handleBypassLogin = () => {
    setBypassLoading(true);
    setTimeout(() => {
      localStorage.setItem('dev_bypass_auth', 'true');
      window.location.href = '/dashboard';
    }, 500);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h1 className="text-5xl font-extrabold text-white mb-2 tracking-tight">BookingAI</h1>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-10 px-4 shadow-xl sm:rounded-xl sm:px-10 flex flex-col items-center justify-center">
          
          {isBypass ? (
            <div className="w-full space-y-6 text-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Welcome Back</h2>
                <p className="mt-2 text-sm text-gray-500">
                  AI-Powered Clinic Management
                </p>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <p className="text-sm font-medium text-yellow-800">
                  Development Mode Active
                </p>
                <p className="text-xs text-yellow-600 mt-1">Clerk auth is currently bypassed.</p>
              </div>
              
              <button
                onClick={handleBypassLogin}
                disabled={bypassLoading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                {bypassLoading ? 'Authenticating...' : 'Enter Dashboard (Dev Mode)'}
              </button>
            </div>
          ) : (
            <div className="w-full space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">AI-Powered Clinic Management</h2>
                <p className="text-sm text-gray-500 mt-1">Please sign in to continue</p>
              </div>
              <div className="flex justify-center w-full">
                <SignIn path="/login" routing="path" signUpUrl="/signup" />
              </div>
            </div>
          )}

        </div>
        <p className="mt-8 text-center text-sm text-slate-400">
          &copy; {new Date().getFullYear()} BookingAI Platform. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default Login;
