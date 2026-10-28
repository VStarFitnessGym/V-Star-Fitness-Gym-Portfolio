import React from 'react';
import { Check, Star } from 'lucide-react';
import { MOCK_PLANS } from '../../data/mockData';
import { Button } from '../shared/Button';

interface MembershipPackagesProps {
  onSelectPlan?: (planId: string) => void;
}

export const MembershipPackages: React.FC<MembershipPackagesProps> = ({ onSelectPlan }) => {
  return (
    <section id="packages" className="py-16 sm:py-24 bg-black border-t border-zinc-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-16">
          <span className="text-gym-yellow text-xs font-bold uppercase tracking-widest">
            Investment In You
          </span>
          <h2 className="font-heading text-3xl sm:text-5xl lg:text-6xl font-black text-white uppercase tracking-wider mt-2">
            MEMBERSHIP PACKAGES
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base mt-4">
            Transparent pricing with zero enrollment lock-in. All memberships include full facility access and automated renewal reminders.
          </p>
        </div>

        {/* Plan Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 lg:gap-8">
          {MOCK_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-zinc-950 rounded-2xl p-6 sm:p-8 flex flex-col justify-between border transition-all duration-300 hover:scale-[1.02] ${
                plan.popular
                  ? 'border-gym-yellow shadow-2xl shadow-gym-yellow/10'
                  : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              {/* Popular Ribbon */}
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gym-yellow text-black text-[10px] font-black uppercase tracking-widest px-4 py-1 rounded-full shadow-md flex items-center gap-1">
                  <Star className="w-3 h-3 fill-black" />
                  <span>MOST POPULAR</span>
                </div>
              )}

              <div>
                {/* Plan Title & Duration */}
                <h3 className="font-heading text-xl sm:text-2xl font-bold text-white uppercase tracking-wide">
                  {plan.name}
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  {plan.duration_days} Days Continuous Access
                </p>

                {/* Price Display */}
                <div className="my-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-zinc-400 text-lg font-bold">₹</span>
                    <span className="font-heading text-4xl sm:text-5xl font-black text-white tracking-tight">
                      {plan.price.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-400 block mt-1">
                    Membership price
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-zinc-300 mb-6 pb-6 border-b border-zinc-800 leading-relaxed">
                  {plan.description}
                </p>

                {/* Perks List */}
                <ul className="space-y-3 mb-8">
                  {plan.perks.map((perk, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-xs text-zinc-300">
                      <Check className="w-4 h-4 text-gym-yellow shrink-0 mt-0.5" />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Button */}
              <div>
                <a href="#contact">
                  <Button
                    variant={plan.popular ? 'yellow' : 'outline'}
                    size="md"
                    className="w-full text-xs"
                    onClick={() => onSelectPlan && onSelectPlan(plan.id)}
                  >
                    JOIN NOW
                  </Button>
                </a>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
