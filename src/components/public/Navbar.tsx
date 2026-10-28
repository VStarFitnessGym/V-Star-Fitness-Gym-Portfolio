import React, { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

export const Navbar: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('HOME');

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  const navItems = [
    { name: 'HOME', href: '#home' },
    { name: 'ABOUT US', href: '#features' },
    { name: 'TRAINING & FACILITIES', href: '#facilities' },
    { name: 'HOW IT WORKS', href: '#how-it-works' },
    { name: 'PACKAGES', href: '#packages' },
    { name: 'CONTACT US', href: '#contact' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-20 sm:h-24">
          
          <a href="#home" aria-label="V-Star Fitness & Boxing Club home" className="flex shrink-0 flex-col items-start gap-0.5 leading-none lg:-translate-x-6 min-[1328px]:-translate-x-10">
            <span className="font-brand text-[27px] tracking-[0.12em] text-amber-500">V-STAR</span>
            <span className="font-display text-[32px] font-black tracking-[0.06em] text-white">FITNESS</span>
          </a>

          <nav aria-label="Main navigation" className="hidden lg:flex flex-1 items-center justify-between ml-12">
            {navItems.map((item) => {
              const isActive = activeTab === item.name;
              return (
                <a
                  key={item.name}
                  href={item.href}
                  onClick={() => setActiveTab(item.name)}
                  className={`whitespace-nowrap border-b pb-1 text-[11px] font-medium uppercase tracking-wide transition-colors duration-200 ${
                    isActive
                      ? 'border-white text-white'
                      : 'border-transparent text-zinc-300 hover:text-white'
                  }`}
                >
                  {item.name}
                </a>
              );
            })}
          </nav>

          {/* Mobile menu button */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gym-yellow"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="lg:hidden max-h-[70vh] overflow-y-auto overscroll-contain bg-zinc-950 border-b border-zinc-800 px-4 pt-2 pb-4"
        >
          <div className="space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.name;
              return (
                <a
                  key={item.name}
                  href={item.href}
                  aria-current={isActive ? 'location' : undefined}
                  onClick={() => {
                    setActiveTab(item.name);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex min-h-11 items-center rounded-lg px-3 py-3 text-sm font-bold uppercase tracking-wider transition-colors ${
                    isActive
                      ? 'bg-zinc-900 text-gym-yellow'
                      : 'text-zinc-200 hover:bg-zinc-900 hover:text-gym-yellow'
                  }`}
                >
                  {item.name}
                </a>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
};
