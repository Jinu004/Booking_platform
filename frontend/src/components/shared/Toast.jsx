import React from 'react';
import useStore from '../../store/useStore';

const Toast = () => {
  const { toasts, removeToast } = useStore();

  if (toasts.length === 0) return null;

  const typeConfig = {
    success: { border: 'border-l-4 border-green-500', icon: '✓', color: 'text-green-500' },
    error: { border: 'border-l-4 border-red-500', icon: '✕', color: 'text-red-500' },
    warning: { border: 'border-l-4 border-yellow-500', icon: '⚠', color: 'text-yellow-500' },
    info: { border: 'border-l-4 border-blue-500', icon: 'ℹ', color: 'text-blue-500' }
  };

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col space-y-3 pointer-events-none">
      {toasts.map((toast) => {
        const config = typeConfig[toast.type] || typeConfig.info;
        
        return (
          <div 
            key={toast.id}
            className={`pointer-events-auto bg-white shadow-lg rounded-md pl-4 pr-3 py-3 w-[320px] max-w-full flex flex-row items-start justify-between ${config.border} animate-[slide-in-right_0.3s_ease-out_forwards]`}
          >
            <div className="flex items-start">
              <span className={`mr-3 font-bold mt-0.5 ${config.color}`}>{config.icon}</span>
              <p className="text-sm font-medium text-gray-800 break-words flex-1">
                {toast.message}
              </p>
            </div>
            <button 
              onClick={() => removeToast(toast.id)}
              className="ml-4 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default Toast;
