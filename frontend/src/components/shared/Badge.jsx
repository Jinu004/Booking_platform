import React from 'react';

const Badge = ({ children, variant = 'gray' }) => {
  const styles = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    waiting: 'bg-orange-100 text-orange-800',
    active: 'bg-green-100 text-green-800',
    inactive: 'bg-gray-100 text-gray-800',
    suspended: 'bg-red-100 text-red-800',
    no_show: 'bg-purple-100 text-purple-800',
    gray: 'bg-gray-100 text-gray-800'
  };

  const currentStyle = styles[variant] || styles.gray;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${currentStyle}`}>
      {children}
    </span>
  );
};

export default Badge;
