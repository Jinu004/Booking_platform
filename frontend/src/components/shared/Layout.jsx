import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-gray-50 overflow-hidden text-gray-900 relative">
      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />
      
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">
        <header className="bg-white border-b border-gray-200 h-16 flex-shrink-0 mt-0 flex items-center px-4 md:px-6">
          <button 
            className="md:hidden mr-4 text-gray-600 hover:text-gray-900 focus:outline-none"
            onClick={() => setIsSidebarOpen(true)}
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
          </button>
          <h2 className="text-xl font-black text-gray-800 tracking-tight">
            Booking Platform Dashboard
          </h2>
        </header>
        
        <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <div className="w-full max-w-7xl mx-auto p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
