import React from 'react';

export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-blue-900 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-4">BookingAI</h1>
        <div className="flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
        <p className="text-blue-200 mt-4 text-sm">
          Loading your dashboard...
        </p>
      </div>
    </div>
  );
}
