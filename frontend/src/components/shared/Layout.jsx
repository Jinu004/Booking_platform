import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const Layout = () => {
  return (
    <div className="flex h-screen w-full bg-gray-50 overflow-hidden text-gray-900">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="bg-white border-b border-gray-200 h-16 flex-shrink-0 mt-0 flex items-center px-6">
          <h2 className="text-lg font-medium text-gray-800 hidden md:block">
            Booking Platform Dashboard
          </h2>
        </header>
        
        <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <div className="w-full max-w-7xl mx-auto p-6 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
