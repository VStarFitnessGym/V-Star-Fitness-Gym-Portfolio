import React from 'react';
import { ArrowUp } from 'lucide-react';
import logo from '../../assets/vstar-logo.png';

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-black border-t border-zinc-900 text-zinc-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        
        {/* Top Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 sm:gap-12 pb-10 sm:pb-12 border-b border-zinc-900">
          
          {/* Brand & Mission */}
          <div className="md:col-span-6 space-y-4">
            <div className="flex items-center gap-3">
              <img
                src={logo}
                alt="V-Star Fitness & Boxing Club logo"
                className="h-12 w-auto object-contain"
              />
            </div>
            <p className="text-zinc-400 text-xs sm:text-sm leading-relaxed max-w-md">
              V-Star Fitness & Boxing Club is an elite athletic club offering Olympic weightlifting platforms, championship boxing training, and automated membership management. Engineered for athletes who demand results.
            </p>
          </div>

          {/* Quick Links matching reference */}
          <div className="md:col-span-6">
            <div className="text-xs font-bold uppercase tracking-wider text-white mb-4">
              QUICK LINKS
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-6 text-xs uppercase font-medium">
              <a href="#home" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">HOME</a>
              <a href="#packages" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">PACKAGES</a>
              <a href="#contact" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">CONTACT</a>
              <a href="#features" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">ABOUT US</a>
              <a href="#facilities" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">FACILITIES</a>
              <a href="#how-it-works" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">HOW IT WORKS</a>
              <a href="#packages" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">PRICING</a>
              <a href="#contact" className="flex min-h-11 items-center hover:text-gym-yellow transition-colors sm:min-h-0">PRIVACY & TERMS</a>
            </div>
          </div>

        </div>

        {/* Bottom Bar matching reference */}
        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[11px] text-zinc-500">
          <div className="max-w-full break-words">
            Copyright © {new Date().getFullYear()} V-Star Fitness & Boxing Club. All Rights Reserved.
          </div>
          <button
            onClick={scrollToTop}
            className="flex min-h-11 items-center gap-1.5 uppercase font-bold tracking-wider text-zinc-400 hover:text-gym-yellow transition-colors cursor-pointer sm:min-h-0"
          >
            <span>BACK TO TOP</span>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>
    </footer>
  );
};
