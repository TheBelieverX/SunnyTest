import React from 'react';

interface MagicButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: 'primary' | 'danger';
}

export const MagicButton: React.FC<MagicButtonProps> = ({ 
  children, 
  active, 
  variant = 'primary',
  className = '',
  ...props 
}) => {
  const baseStyles = "relative inline-flex items-center justify-center px-8 py-4 text-lg font-display font-bold text-white transition-all duration-200 transform rounded-full shadow-lg focus:outline-none focus:ring-4 focus:ring-offset-2";
  
  const variants = {
    primary: active 
      ? "bg-magic-600 shadow-magic-300/50 scale-95 ring-magic-300" 
      : "bg-gradient-to-r from-magic-500 to-purple-600 hover:from-magic-600 hover:to-purple-700 shadow-purple-300/50 hover:-translate-y-1 hover:shadow-xl",
    danger: "bg-red-500 hover:bg-red-600 shadow-red-200/50"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
      {active && (
         <span className="absolute w-full h-full rounded-full animate-ping bg-white/30 opacity-75"></span>
      )}
    </button>
  );
};