import React from 'react';

interface BadgeProps {
  variant?: 'yellow' | 'green' | 'red' | 'blue' | 'gray' | 'purple';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'gray', children, className = '' }) => {
  const variantStyles = {
    yellow: 'bg-gym-yellow/15 text-gym-yellow border-gym-yellow/30',
    green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    red: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    blue: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    gray: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${variantStyles[variant]} ${className}`}>
      {children}
    </span>
  );
};
