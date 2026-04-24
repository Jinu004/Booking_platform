import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { globalSearch } from '../../services/patient.service';

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await globalSearch(searchQuery);
        setSearchResults(result.data?.data || result.data);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    const handleClickOutside = (e) => {
      if (!e.target.closest('.global-search-container')) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="flex h-screen w-full bg-gray-50 overflow-hidden text-gray-900 relative">
      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />
      
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">
        <header className="bg-white border-b border-gray-200 h-16 flex-shrink-0 mt-0 flex items-center justify-between px-4 md:px-6 relative global-search-container">
          <div className="flex items-center flex-1">
            {!searchOpen && (
              <button 
                className="md:hidden mr-4 text-gray-600 hover:text-gray-900 focus:outline-none"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
              </button>
            )}
            <h2 className={`text-xl font-black text-gray-800 tracking-tight ${searchOpen ? 'hidden md:block' : 'block'}`}>
              Booking Platform Dashboard
            </h2>
          </div>

          <div className={`flex items-center ${searchOpen ? 'w-full md:w-auto absolute inset-0 md:static bg-white px-4 md:px-0 z-10' : ''}`}>
            {searchOpen ? (
              <div className="w-full md:w-96 relative">
                <input
                  type="text"
                  autoFocus
                  placeholder="Search patients or bookings..."
                  className="w-full bg-gray-100 border-none rounded-lg py-2 pl-10 pr-10 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <div className="absolute left-3 top-2.5 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
                <button 
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 md:hidden"
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults(null); }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
            ) : (
              <button 
                type="button"
                className="cursor-pointer z-50 relative p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 focus:outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchOpen(true);
                }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              </button>
            )}
          </div>

          {searchOpen && searchQuery.length >= 2 && (
            <div className="absolute top-16 right-0 md:right-6 left-0 md:left-auto md:w-96 bg-white shadow-xl border border-gray-100 rounded-b-lg md:rounded-lg overflow-hidden z-50">
              {searching ? (
                <div className="p-4 text-center text-gray-500">Searching...</div>
              ) : searchResults && (searchResults.patients?.length > 0 || searchResults.bookings?.length > 0) ? (
                <div className="max-h-[80vh] overflow-y-auto pb-2">
                  {searchResults.patients?.length > 0 && (
                    <div className="pt-2">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 px-4">Patients</div>
                      {searchResults.patients.map(p => (
                        <div 
                          key={p.id} 
                          className="px-4 py-2 hover:bg-indigo-50 cursor-pointer"
                          onClick={() => {
                            navigate('/patients');
                            setSearchOpen(false);
                            setSearchQuery('');
                          }}
                        >
                          <div className="font-bold text-gray-900">{p.name || 'Unknown'}</div>
                          <div className="text-sm text-gray-500">{p.phone}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {searchResults.bookings?.length > 0 && (
                    <div className="pt-2 border-t border-gray-100 mt-2">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 px-4">Bookings</div>
                      {searchResults.bookings.map(b => (
                        <div 
                          key={b.id} 
                          className="px-4 py-2 hover:bg-indigo-50 cursor-pointer"
                          onClick={() => {
                            navigate('/bookings');
                            setSearchOpen(false);
                            setSearchQuery('');
                          }}
                        >
                          <div className="font-bold text-gray-900">Token {b.token_number || '-'} — {b.patient_name || 'Unknown'}</div>
                          <div className="text-sm font-medium text-gray-700">Dr. {b.doctor_name}</div>
                          <div className="text-sm text-gray-500">
                            {new Date(b.booking_date).toLocaleDateString() === new Date().toLocaleDateString() ? 'Today' : new Date(b.booking_date).toLocaleDateString()} — <span className="uppercase text-xs font-bold">{b.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500">
                  No results found for '{searchQuery}'
                </div>
              )}
            </div>
          )}
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
