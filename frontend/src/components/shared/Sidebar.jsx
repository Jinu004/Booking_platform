import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import Badge from './Badge';

const Sidebar = ({ isOpen, setIsOpen }) => {
  const { tenant, staff, logout } = useStore();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const links = [
    { name: 'Dashboard', path: '/dashboard', icon: '🏠' },
    { name: 'Bookings', path: '/bookings', icon: '📅' },
    { name: 'Conversations', path: '/conversations', icon: '💬' },
    { name: 'Patients', path: '/patients', icon: '👥' },
    { name: 'Doctors', path: '/doctors', icon: '👨‍⚕️' },
    { name: 'Staff', path: '/staff', icon: '👔' },
    { name: 'Analytics', path: '/analytics', icon: '📊' },
    { name: 'Settings', path: '/settings', icon: '⚙️' }
  ];

  if (staff?.role === 'super_admin') {
    links.push({ name: 'Super Admin', path: '/superadmin', icon: '👑' });
  }

  const planName = tenant?.plan || 'Starter';

  return (
    <>
      <div 
        className={`fixed inset-0 bg-gray-900 bg-opacity-50 z-40 md:hidden transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} 
        onClick={() => setIsOpen(false)} 
      />
      
      <aside className={`fixed inset-y-0 left-0 z-50 w-[240px] flex-shrink-0 flex flex-col h-full bg-white border-r border-gray-200 transform transition-transform md:relative md:translate-x-0 shadow-2xl md:shadow-none ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div className="flex-1 min-w-0">
             <h2 className="text-xl font-bold text-gray-900 truncate">
               {tenant?.name || 'Clinic Platform'}
             </h2>
             <div className="mt-2">
               <Badge variant="success" className="capitalize">{planName} Plan</Badge>
             </div>
          </div>
          <button className="md:hidden text-gray-400 hover:text-gray-900 font-bold p-1 rounded-full hover:bg-gray-200 transition-colors" onClick={() => setIsOpen(false)}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto w-full">
          {links.map(link => {
            const isActive = location.pathname.startsWith(link.path);
            return (
              <Link
                key={link.name}
                to={link.path}
                onClick={() => setIsOpen && setIsOpen(false)}
                className={`
                  flex items-center px-3 py-2 text-sm font-medium w-full transition-colors rounded-lg
                  ${isActive 
                    ? 'bg-indigo-50 text-indigo-700' 
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
                `}
              >
                <span className="mr-3 text-xl" aria-hidden="true">{link.icon}</span>
                {link.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 space-y-4 bg-gray-50">
          <div className="flex items-center">
            <div className="flex-1 min-w-0 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
              <p className="text-sm font-bold text-gray-900 truncate flex items-center gap-2">
                <span className="text-xl">👤</span> {staff?.name || 'Guest User'}
              </p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black mt-1 ml-8">
                {staff?.role ? staff.role.replace('_', ' ') : ''}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center px-4 py-2.5 text-sm font-bold text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-lg shadow-sm transition-colors"
          >
            Log out
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
