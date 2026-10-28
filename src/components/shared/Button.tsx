import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'yellow' | 'outline' | 'dark' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'yellow',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-bold uppercase tracking-wider transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gym-yellow focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

  const sizeStyles = {
    sm: 'min-h-11 text-xs px-3 py-1.5 rounded gap-1.5 sm:min-h-0',
    md: 'min-h-11 text-sm px-5 py-2.5 rounded gap-2 sm:min-h-0',
    lg: 'min-h-11 text-base px-8 py-3.5 rounded-md gap-2.5 sm:min-h-0',
  };

  const variantStyles = {
    yellow: 'bg-gym-yellow text-black hover:bg-gym-yellowHover shadow-lg shadow-gym-yellow/20 active:scale-[0.98]',
    outline: 'border border-gym-yellow text-gym-yellow hover:bg-gym-yellow hover:text-black active:scale-[0.98]',
    dark: 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700 active:scale-[0.98]',
    ghost: 'text-gray-300 hover:text-white hover:bg-zinc-800/60',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.98]',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};
