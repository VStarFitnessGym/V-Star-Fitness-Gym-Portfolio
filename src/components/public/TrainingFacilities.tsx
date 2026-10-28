import React from 'react';
import { Button } from '../shared/Button';

export const TrainingFacilities: React.FC = () => {
  return (
    <section id="facilities" className="py-14 sm:py-20 bg-zinc-950 border-t border-zinc-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-16">
          <span className="text-gym-yellow text-xs font-bold uppercase tracking-widest">
            Elite Infrastructure
          </span>
          <h2 className="font-heading text-3xl sm:text-5xl font-black text-white uppercase tracking-wider mt-2">
            TRAINING & FACILITIES
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base mt-4">
            Engineered equipment, specialized strength zones, and high-intensity conditioning facilities built without compromise.
          </p>
        </div>

        {/* 3x2 Alternating Grid exactly matching reference screenshot */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Row 1 - Item 1: Olympic Barbell & Weight Plates Image */}
          <div className="relative aspect-square self-start rounded-xl overflow-hidden border border-zinc-800 group">
            <img
              src="https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?auto=format&fit=crop&w=800&q=80"
              alt="Olympic barbell with heavy cast iron plates"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-6">
              <span className="font-heading text-lg font-bold text-white tracking-wider uppercase">
                Free Weights & Olympic Racks
              </span>
            </div>
          </div>

          {/* Row 1 - Item 2: Grip & Forearm Conditioning Text Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-7 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-8 h-1 bg-gym-yellow mb-5"></div>
              <ul className="space-y-3 text-zinc-300 text-xs sm:text-[13px] leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Gripper Exercises:</strong> Using heavy hand grippers, squeeze and release to strengthen deep finger flexors and forearm thickness.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Plate Pinches:</strong> Hold calibrated steel plates between fingers and thumb, training unyielding isometric pinch grip.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Wrist Curls:</strong> Target full wrist flexion and extension on preacher benches for injury resilience and wrist stability.</span>
                </li>
              </ul>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800">
              <a href="#packages">
                <Button size="sm" variant="yellow" className="text-xs">
                  LEARN MORE
                </Button>
              </a>
            </div>
          </div>

          {/* Row 1 - Item 3: Stationary Spin & Assault Bikes Image */}
          <div className="relative aspect-square self-start rounded-xl overflow-hidden border border-zinc-800 group">
            <img
              src="https://images.unsplash.com/photo-1576678927484-cc907957088c?auto=format&fit=crop&w=800&q=80"
              alt="High-intensity spin and air bikes line"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-6">
              <span className="font-heading text-base sm:text-lg font-bold text-white tracking-wider uppercase">
                Cardio & Conditioning Theater
              </span>
            </div>
          </div>

          {/* Row 2 - Item 4: Core & Ab Wheel Training Text Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-7 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-8 h-1 bg-gym-yellow mb-5"></div>
              <ul className="space-y-3 text-zinc-300 text-xs sm:text-[13px] leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Strengthening the core:</strong> Ab-wheel rollout protocols recruit rectus abdominis and transverse muscles for bulletproof spinal stability.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Toning & Definition:</strong> Regular progressive overload defines the abdominal wall and enhances rotational athletic torque.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Full Body Engagement:</strong> Engages lats, deltoids, and glutes simultaneously in strict anti-extension mechanics.</span>
                </li>
              </ul>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800">
              <a href="#packages">
                <Button size="sm" variant="yellow" className="text-xs">
                  LEARN MORE
                </Button>
              </a>
            </div>
          </div>

          {/* Row 2 - Item 5: Dumbbells on Red Track Image */}
          <div className="relative aspect-square self-start rounded-xl overflow-hidden border border-zinc-800 group">
            <img
              src="https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?auto=format&fit=crop&w=800&q=80"
              alt="Hex dumbbells on textured red running track"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-6">
              <span className="font-heading text-lg font-bold text-white tracking-wider uppercase">
                Turf Sled & Functional Zone
              </span>
            </div>
          </div>

          {/* Row 2 - Item 6: Virtual & HIIT Cycling Programs Text Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 sm:p-7 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              <div className="w-8 h-1 bg-gym-yellow mb-5"></div>
              <ul className="space-y-3 text-zinc-300 text-xs sm:text-[13px] leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Tailored Cardio Programs:</strong> Choose from high-intensity interval training, steep hill resistance, or zone-2 endurance pacing.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Interactive Telemetry:</strong> High-precision console metrics monitoring heart rate zones, wattage output, and cadence in real time.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gym-yellow font-bold mt-0.5">•</span>
                  <span><strong>Ergonomic Comfort:</strong> Magnetic flywheels with dual-sided SPD pedals and micro-adjustable aero saddles.</span>
                </li>
              </ul>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-800">
              <a href="#packages">
                <Button size="sm" variant="yellow" className="text-xs">
                  LEARN MORE
                </Button>
              </a>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
