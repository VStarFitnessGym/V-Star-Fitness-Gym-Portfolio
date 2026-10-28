import React from 'react';
import { Button } from '../shared/Button';

export const Hero: React.FC = () => {
  return (
    <section id="home" className="relative min-h-[calc(100svh-5rem)] sm:min-h-[85vh] lg:min-h-[90vh] bg-black overflow-hidden flex flex-col justify-between">
      {/* Background Imagery Split */}
      <div className="absolute inset-0 z-0 flex">
        {/* Left Side: Treadmill Gym Floor */}
        <div className="w-full lg:w-7/12 relative h-full">
          <img
            src="https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=1400&q=80"
            alt="Gym cardio equipment floor"
            className="w-full h-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
        </div>

        {/* Right Side: Athletic Lifter with Diagonal Split */}
        <div className="hidden lg:block lg:w-6/12 relative h-full -ml-24 hero-diagonal-split">
          <img
            src="https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&w=1200&q=80"
            alt="Athlete lifting weights in gym"
            className="w-full h-full object-cover object-top opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60" />
          <div className="absolute inset-0 bg-black/20" />
        </div>
      </div>

      {/* Top & Bottom Vignettes */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/80 via-transparent to-black z-0" />

      {/* Main Hero Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 lg:pt-28 pb-12 flex-1 flex flex-col justify-center items-center text-center">
        
        {/* Massive Bold Stacked Typography matching reference screenshot */}
        <div className="mb-8 max-w-full space-y-1 sm:space-y-2">
          <h1 className="font-heading max-w-full text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-widest text-white uppercase drop-shadow-md">
            NOT YOUR
          </h1>
          <div className="font-heading max-w-full text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-widest uppercase text-stroke-white select-none">
            TYPICAL
          </div>
          <h2 className="font-heading max-w-full text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-widest text-white uppercase drop-shadow-lg">
            FITNESS
          </h2>
        </div>

        {/* Subtitle */}
        <p className="max-w-2xl text-zinc-300 text-sm sm:text-base md:text-lg font-normal mb-8 leading-relaxed">
          State-of-the-art strength zones, tailored athletic conditioning, and automated member management built for peak performance.
        </p>

        {/* Primary CTA */}
        <div className="mb-12 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:gap-4">
          <a href="#packages" className="w-full sm:w-auto">
            <Button size="lg" className="w-full text-sm sm:w-56">
              PACKAGES
            </Button>
          </a>
          <a href="#facilities" className="w-full sm:w-auto">
            <Button variant="outline" size="lg" className="w-full text-sm sm:w-56">
              EXPLORE GYM
            </Button>
          </a>
        </div>

      </div>

      {/* Hero Bottom Ticker Strip */}
      <div className="relative z-10 border-t border-zinc-800/80 bg-zinc-950/70 py-3">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-around text-center gap-x-4 gap-y-3 text-[10px] sm:text-xs font-bold tracking-widest uppercase text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gym-yellow"></span>
            <span>Olympic Lifting Floor</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gym-yellow"></span>
            <span>Cardio & Spin Theater</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gym-yellow"></span>
            <span>Personalized Training</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gym-yellow"></span>
            <span>Instant Mobile Expiry Alerts</span>
          </div>
        </div>
      </div>
    </section>
  );
};
