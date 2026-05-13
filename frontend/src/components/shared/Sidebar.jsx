import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import Badge from './Badge';
import { getStoredStaff, logout } from '../../services/auth.service';

const icons = {
  Dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  Bookings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Conversations: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  Patients: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Doctors: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  Staff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  Analytics: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  Settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  SuperAdmin: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
};

const mainLinks = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Bookings', path: '/bookings' },
  { name: 'Conversations', path: '/conversations' },
  { name: 'Patients', path: '/patients' },
];

const clinicLinks = [
  { name: 'Doctors', path: '/doctors' },
  { name: 'Staff', path: '/staff' },
  { name: 'Analytics', path: '/analytics' },
  { name: 'Settings', path: '/settings' },
];

const Sidebar = ({ isOpen, setIsOpen }) => {
  const { tenant, pendingHandoffs, clearHandoffs } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const staff = getStoredStaff();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const allClinicLinks = staff?.role === 'super_admin'
    ? [...clinicLinks, { name: 'Super Admin', path: '/superadmin' }]
    : clinicLinks;

  const renderLink = (link) => {
    const isActive = location.pathname.startsWith(link.path);
    const iconKey = link.name.replace(' ', '');
    return (
      <Link
        key={link.name}
        to={link.path}
        onClick={() => {
          if (setIsOpen) setIsOpen(false);

        }}
        className={`flex items-center px-3 py-2 text-sm font-medium w-full transition-colors rounded-lg gap-3
          ${isActive
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
      >
        <span className={isActive ? 'text-indigo-600' : 'text-gray-400'}>
          {icons[iconKey] || icons.Dashboard}
        </span>
        {link.name}
        {link.name === 'Conversations' && pendingHandoffs > 0 && (
          <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {pendingHandoffs > 9 ? '9+' : pendingHandoffs}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-gray-900 bg-opacity-50 z-40 md:hidden transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsOpen(false)}
      />

      <aside className={`fixed inset-y-0 left-0 z-50 w-[220px] flex-shrink-0 flex flex-col h-full bg-white border-r border-gray-200 transform transition-transform md:relative md:translate-x-0 shadow-2xl md:shadow-none ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>

        {/* Header */}
        <div className="p-5 border-b border-gray-200 flex justify-between items-center">
          <div className="flex-1 min-w-0">
            <Link to="/dashboard" className="text-base font-bold text-indigo-600 truncate hover:text-indigo-800 transition">
              ReceptionAI
            </Link>
            <p className="text-xs text-gray-400 mt-0.5 capitalize">{staff?.tenantPlan || 'Starter'} plan</p>
          </div>
          <button
            className="md:hidden text-gray-400 hover:text-gray-900 p-1 rounded-full hover:bg-gray-100 transition-colors"
            onClick={() => setIsOpen(false)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {mainLinks.map(renderLink)}

          <div className="pt-4 pb-1">
            <p className="px-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Clinic</p>
          </div>
          {allClinicLinks.map(renderLink)}
        </nav>

        {/* Bottom */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-indigo-700">
                {(staff?.tenantName || tenant?.name || 'R')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{staff?.tenantName || tenant?.name || 'Clinic'}</p>
              <p className="text-xs text-gray-400 capitalize">{staff?.role || 'admin'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center px-4 py-2 text-sm font-semibold text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
          >
            Log out
          </button>
        </div>

      </aside>
    </>
  );
};

export default Sidebar;