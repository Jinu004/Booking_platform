import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useIndustry } from '../../hooks/useIndustry';
import { globalSearch } from '../../services/patient.service';
import useStore from '../../store/useStore';
import api from '../../utils/api';
import { subscribeLiveEvents } from '../../utils/liveEvents';
import usePollWhileVisible from '../../hooks/usePollWhileVisible';
import { STORAGE_KEYS } from '../../constants';

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant, addToast } = useStore();
  const [updateAvailable, setUpdateAvailable] = useState(false)

  const checkVersion = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`)
      const data = await res.json()
      const serverVersion = data.version
      const acceptedVersion = localStorage.getItem('acceptedVersion')
      if (serverVersion !== acceptedVersion) {
        setUpdateAvailable(true)
      }
    } catch (err) {}
  }
  useEffect(() => {
    checkVersion()
  }, [])
  // Checked every 5 minutes while the tab is visible; paused when hidden, checked once when it is shown again
  usePollWhileVisible(checkVersion, 5 * 60 * 1000)
  const { industry } = useIndustry();
  const isEnquiry = industry === 'enquiry';
  const staff = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.STAFF_DATA) || '{}'); } catch { return {}; } })();

  // WhatsApp connection state for the disconnected banner: clinic admins and managers only (never super admin), kept in component state
  // only (nothing stored), loaded once when the browser is idle and then at most every 10 minutes while the tab is visible.
  // A failed load leaves the banner as it was and shows nothing of its own.
  const canSeeWaBanner = staff.role === 'admin' || staff.role === 'manager';
  const [waConnection, setWaConnection] = useState(null);
  const lastWaLoadAt = useRef(0);
  const loadWaConnection = useCallback(async () => {
    if (!canSeeWaBanner) return;
    // Repeated tab switching must not repeat the request: skip when the last attempt was under 60 seconds ago
    const now = Date.now();
    if (now - lastWaLoadAt.current < 60 * 1000) return;
    lastWaLoadAt.current = now;
    try {
      const res = await api.get('/settings', { silent: true, quiet: true });
      setWaConnection(res?.data?.connection || null);
    } catch {}
  }, [canSeeWaBanner]);
  useEffect(() => {
    if (!canSeeWaBanner) { setWaConnection(null); return undefined; }
    let idleHandle = null;
    let timeoutHandle = null;
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(loadWaConnection, { timeout: 2000 });
    } else {
      timeoutHandle = setTimeout(loadWaConnection, 1500);
    }
    return () => {
      if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    };
  }, [canSeeWaBanner, loadWaConnection]);
  usePollWhileVisible(loadWaConnection, 10 * 60 * 1000);
  const showWaDisconnectedBanner = canSeeWaBanner && waConnection?.wa_connection_state === 'disconnected';

  const isDashboard = location.pathname === '/dashboard';
  const headerSurface = isEnquiry ? 'bg-white border-gray-200' : 'bg-bg border-ink/[0.08]';

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return tenant?.name || staff?.tenantName || 'Dashboard';
    if (path.startsWith('/bookings')) return 'Bookings';
    if (path.startsWith('/queue')) return 'Token Queue';
    if (path.startsWith('/patients')) return 'Patients';
    if (path.startsWith('/doctors')) return 'Doctors';
    if (path.startsWith('/staff')) return 'Staff';
    if (path.startsWith('/conversations')) return 'Conversations';
    if (path.startsWith('/analytics')) return 'Analytics';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/superadmin')) return 'Super Admin';
    return 'ReceptionAI';
  };

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
        addToast('Search failed', 'error');
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

  useEffect(() => {
    // One shared live connection (utils/liveEvents.js): the token travels in a header, never in the URL
    return subscribeLiveEvents({
      handoff_requested: () => {
        useStore.getState().incrementHandoffs();
      },
      session_refresh: async () => {
        try {
          const res = await api.get('/auth/me');
          if (res.data?.staff && res.data?.tenant) {
            const current = JSON.parse(localStorage.getItem(STORAGE_KEYS.STAFF_DATA) || '{}');
            const updated = { ...current, tenantPlan: res.data.tenant?.plan };
            localStorage.setItem(STORAGE_KEYS.STAFF_DATA, JSON.stringify(updated));
            useStore.getState().setTenant(res.data.tenant);
          }
        } catch {}
      }
    });
  }, []);

  return (
    <div className={`flex h-screen w-full overflow-hidden relative ${updateAvailable ? 'pt-9' : ''} ${isEnquiry ? 'bg-[#F0F4F8] text-[#1E2E45]' : 'bg-bg text-ink'}`}>
      {updateAvailable && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-indigo-600 text-white px-4 py-2 flex items-center justify-between text-sm shadow-md">
          <span className="truncate">🆕 A new version of ReceptionAI is available — please update to get the latest features.</span>
          <button
            onClick={async () => {
                try {
                  const res = await fetch(`/version.json?t=${Date.now()}`)
                  const data = await res.json()
                  localStorage.setItem('acceptedVersion', data.version)
                } catch (e) {
                  localStorage.setItem('acceptedVersion', 'updated')
                } finally {
                  window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now()
                }
              }}
            className="ml-4 flex-shrink-0 px-3 py-1 bg-white text-indigo-600 rounded font-semibold hover:bg-indigo-50 transition"
          >
            Update Now
          </button>
        </div>
      )}
      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">

        {/* Mobile-only header for dashboard */}
        {isDashboard && (
          <header className={`md:hidden ${headerSurface} border-b h-16 flex-shrink-0 flex items-center px-4`}>
            <button
              className="text-gray-600 hover:text-gray-900 focus:outline-none"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
            </button>
            <span className="ml-4 text-lg font-semibold tracking-tight">ReceptionAI</span>
          </header>
        )}

        {/* Header — hidden on dashboard, dashboard has its own top bar */}
        {!isDashboard && (
          <header className={`${headerSurface} border-b h-16 flex-shrink-0 flex items-center justify-between px-4 md:px-6 relative global-search-container`}>
            <div className="flex items-center flex-1">
              {!searchOpen && (
                <button
                  className="md:hidden mr-4 text-gray-600 hover:text-gray-900 focus:outline-none"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                >
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                </button>
              )}
              <h2 className={`text-xl font-semibold tracking-[-0.03em] ${searchOpen ? 'hidden md:block' : 'block'}`}>
                {getPageTitle()}
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
                  aria-label="Search patients"
                  className="flex items-center justify-center gap-2 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg border border-ink/10 bg-white hover:bg-ink/[0.03] text-ink/50 text-sm transition sm:w-48 sm:justify-start flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchOpen(true);
                  }}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                  <span className="hidden sm:inline">Search patients...</span>
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
                              {new Date(b.booking_date).toLocaleDateString('en-IN') === new Date().toLocaleDateString('en-IN') ? 'Today' : new Date(b.booking_date).toLocaleDateString('en-IN')} — <span className="uppercase text-xs font-bold">{b.status}</span>
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
        )}

        {showWaDisconnectedBanner && (
          <div role="alert" className="flex-shrink-0 bg-red-600 text-white px-4 py-2 text-sm shadow-md">
            <span>
              WhatsApp messages from patients are no longer reaching ReceptionAI, so the AI assistant is paused. Patients can still message your clinic number in the WhatsApp Business app. Please contact support@receptionai.in to reconnect.
              {waConnection?.wa_disconnect_reason === 'PRIMARY_INACTIVITY' && ' It disconnected because the WhatsApp Business app was not opened for about 14 days.'}
            </span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <div className={`w-full max-w-7xl mx-auto ${isDashboard ? 'p-0' : 'p-4 md:p-8'}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;