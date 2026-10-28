import React from 'react';

export const HowItWorks: React.FC = () => {
  const steps = [
    {
      number: '1',
      title: 'Membership Registration',
      description: 'To become a member, customers complete a streamlined registration process providing verified contact details, regulatory communication consents, and fitness profiles.'
    },
    {
      number: '2',
      title: 'Payment & Plan Activation',
      description: 'Members choose flexible durations from monthly to annual tiers. Payments are instantly recorded via UPI, Cash, Card, or Transfer with zero hidden enrollment fees.'
    },
    {
      number: '3',
      title: 'Access & Expiry Reminders',
      description: 'Receive immediate gym floor check-in access. Automated WhatsApp notifications alert you 3 days before expiry, on the expiry day, and 3 days after expiry so your membership never lapses.'
    }
  ];

  return (
    <section id="how-it-works" className="py-16 sm:py-24 bg-zinc-100 text-zinc-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading matching reference */}
        <div className="mb-10 sm:mb-14">
          <h2 className="font-heading text-4xl sm:text-6xl font-black tracking-wider text-black uppercase">
            HOW IT WORKS
          </h2>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center">
          
          {/* Left: 3 Vertical Athlete Images matching reference */}
          <div className="lg:col-span-5 grid grid-cols-3 gap-2 sm:gap-3">
            <div className="aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-zinc-200">
              <img
                src="https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&w=500&q=80"
                alt="Member lifting weights"
                className="w-full h-full object-cover grayscale contrast-125 hover:grayscale-0 transition-all duration-300"
                loading="lazy"
              />
            </div>
            <div className="aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-zinc-200 -mt-2 sm:-mt-4">
              <img
                src="https://images.unsplash.com/photo-1567013127542-490d757e51fc?auto=format&fit=crop&w=500&q=80"
                alt="Athlete resting between sets"
                className="w-full h-full object-cover grayscale contrast-125 hover:grayscale-0 transition-all duration-300"
                loading="lazy"
              />
            </div>
            <div className="aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-zinc-200">
              <img
                src="https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?auto=format&fit=crop&w=500&q=80"
                alt="Member training with dumbbells"
                className="w-full h-full object-cover grayscale contrast-125 hover:grayscale-0 transition-all duration-300"
                loading="lazy"
              />
            </div>
          </div>

          {/* Right: 3 Numbered Steps with Circles */}
          <div className="lg:col-span-7 space-y-6 sm:space-y-8 pl-0 lg:pl-8">
            {steps.map((step) => (
              <div key={step.number} className="flex items-start gap-4 sm:gap-6 group">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 border-black flex items-center justify-center font-heading font-black text-xl text-black shrink-0 group-hover:bg-gym-yellow group-hover:border-gym-yellow transition-all duration-200">
                  {step.number}
                </div>
                <div className="space-y-1">
                  <h3 className="font-heading text-xl sm:text-2xl font-bold text-black tracking-wide">
                    {step.title}
                  </h3>
                  <p className="text-zinc-700 text-xs sm:text-sm leading-relaxed max-w-xl">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}

          </div>

        </div>

      </div>
    </section>
  );
};
