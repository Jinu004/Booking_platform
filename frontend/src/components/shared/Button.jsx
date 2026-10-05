import React from 'react';
import Spinner from './Spinner';

const Button = ({ children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, type = 'button', fullWidth = false }) => {
  const baseStyle = "inline-flex flex-row items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
  
  const variants = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500 border-transparent",
    secondary: "bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 focus:ring-indigo-500",
    danger: "bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 border-transparent",
    ghost: "bg-transparent hover:bg-indigo-50 text-indigo-600 focus:ring-indigo-500 border-transparent"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base"
  };

  const currentVariantStyle = variants[variant] || variants.primary;
  const currentSizeStyle = sizes[size] || sizes.md;
  const disabledStyle = (disabled || loading) ? "opacity-50 cursor-not-allowed" : "";
  const widthStyle = fullWidth ? "w-full" : "";

  return (
    <button
      type={type}
      onClick={disabled || loading ? undefined : onClick}
      disabled={disabled || loading}
      className={`${baseStyle} ${currentVariantStyle} ${currentSizeStyle} ${disabledStyle} ${widthStyle}`}
    >
      {loading && <Spinner size="sm" color={variant === 'primary' || variant === 'danger' ? 'white' : 'indigo'} className="mr-2" />}
      {loading ? 'Loading...' : children}
    </button>
  );
};

export default Button;
