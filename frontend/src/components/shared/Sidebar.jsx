import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import Badge from './Badge';

const Sidebar = () => {
  const { tenant, staff, logout } = useStore();
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

  return (
    <aside className="w-[240px] flex-shrink-0 flex flex-col h-full bg-white border-r border-gray-200">
      {/* Top Section */}
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-xl font-bold text-gray-900 truncate">
          {tenant?.name || 'Loading...'}
        </h2>
        <p className="text-sm text-gray-500 capitalize mt-1">
          {tenant?.industry ? tenant.industry.replace('_', ' ') : 'Clinic Platform'}
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto w-full">
        {links.map(link => (
          <NavLink
            key={link.name}
            to={link.path}
            className={({ isActive }) => `
              flex items-center px-3 py-2 text-sm font-medium rounded-md w-full transition-colors
              ${isActive 
                ? 'bg-blue-50 text-blue-700' 
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}
            `}
          >
            <span className="mr-3 text-lg" aria-hidden="true">{link.icon}</span>
            {link.name}
          </NavLink>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {staff?.name || 'Guest User'}
            </p>
            <div className="mt-1">
              <Badge variant={staff?.role === 'super_admin' ? 'active' : 'info'}>
                {staff?.role ? staff.role.replace('_', ' ') : 'No Role'}
              </Badge>
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Logout
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
