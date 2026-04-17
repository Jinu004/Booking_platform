import React, { useState } from 'react';
import { SignIn } from '@clerk/clerk-react';

const Login = () => {
  const isBypass = import.meta.env.VITE_BYPASS_AUTH === 'true';
  const [bypassLoading, setBypassLoading] = useState(false);

  const handleBypassLogin = () => {
    setBypassLoading(true);
    // Simulate setting mock auth context then redirect
    setTimeout(() => {
      // Typically, context/store would handle this. 
      // For now we set a localStorage flag and redirect.
      localStorage.setItem('dev_bypass_auth', 'true');
      window.location.href = '/dashboard';
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h1 className="text-4xl font-extrabold text-indigo-600 mb-2">BookingAI</h1>
        <h2 className="mt-6 text-2xl font-bold text-gray-900">Sign in to your account</h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 flex flex-col items-center justify-center">
          
          {isBypass ? (
            <div className="w-full space-y-6 text-center">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                <p className="text-sm text-yellow-700">
                  Development Mode: Fast Auth Bypass is enabled.
                </p>
              </div>
              <button
                onClick={handleBypassLogin}
                disabled={bypassLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {bypassLoading ? 'Authenticating...' : 'Login as Admin (Dev Mode)'}
              </button>
            </div>
          ) : (
            <div className="w-full">
               <SignIn path="/login" routing="path" signUpUrl="/signup" />
            </div>
          )}

        </div>
        <p className="mt-6 text-center text-sm text-gray-500">
          Powered by BookingAI
        </p>
      </div>
    </div>
  );
};

export default Login;
