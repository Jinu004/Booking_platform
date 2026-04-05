import React from 'react';

const PageHeader = ({ title, subtitle, action }) => {
  return (
    <div className="flex flex-row justify-between items-start md:items-center pb-5 mb-5 border-b border-gray-200">
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action && (
        <div className="mt-4 md:mt-0 flex-shrink-0 ml-4">
          {action}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
