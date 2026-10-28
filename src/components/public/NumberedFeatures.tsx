import React from 'react';
import workoutPlanGymFloor from '../../assets/workout-plan-gym-floor.jpg';
import workoutPlanFreeWeights from '../../assets/workout-plan-free-weights.jpg';
import workoutPlanTrainingArea from '../../assets/workout-plan-training-area.jpg';
import kickboxingCoaching from '../../assets/kickboxing-coaching.jpg';
import kickboxingKick from '../../assets/kickboxing-kick.jpg';
import kickboxingPunch from '../../assets/kickboxing-punch.jpg';

export const NumberedFeatures: React.FC = () => {
  return (
    <section id="features" className="py-14 sm:py-20 bg-black border-t border-zinc-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          
          {/* Card #1 */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 sm:p-8 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              {/* Header with yellow number badge */}
              <div className="flex items-start gap-3 sm:items-center sm:gap-4 mb-6">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gym-yellow text-black font-heading font-black text-2xl sm:text-3xl flex items-center justify-center rounded shadow-md shrink-0">
                  #1
                </div>
                <h3 className="font-heading text-lg sm:text-2xl font-bold tracking-wider text-white uppercase">
                  PERSONALIZED WORKOUT PLANS
                </h3>
              </div>

              {/* Text Description Box matching reference */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-lg p-4 sm:p-5 mb-6 text-zinc-300 text-xs sm:text-sm font-medium uppercase leading-relaxed tracking-wide">
                Train at our well-equipped gym with modern strength and cardio equipment for every fitness level. Build strength, improve endurance, and work toward your goals in a clean, welcoming space with the equipment and support you need.
              </div>
            </div>

            {/* 3 Thumbnail Images */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="aspect-[3/4] rounded-md overflow-hidden border border-zinc-800">
                <img
                  src={workoutPlanFreeWeights}
                  alt="Dumbbell and free weights area"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <div className="aspect-[3/4] rounded-md overflow-hidden border border-zinc-800">
                <img
                  src={workoutPlanGymFloor}
                  alt="Full view of the gym floor and training equipment"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <div className="aspect-[3/4] rounded-md overflow-hidden border border-zinc-800">
                <img
                  src={workoutPlanTrainingArea}
                  alt="Strength training and equipment area"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
            </div>
          </div>

          {/* Card #2 */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 sm:p-8 flex flex-col justify-between hover:border-zinc-700 transition-colors">
            <div>
              {/* Header with yellow number badge */}
              <div className="flex items-start gap-3 sm:items-center sm:gap-4 mb-6">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gym-yellow text-black font-heading font-black text-2xl sm:text-3xl flex items-center justify-center rounded shadow-md shrink-0">
                  #2
                </div>
                <h3 className="font-heading text-lg sm:text-2xl font-bold tracking-wider text-white uppercase">
                  KICK BOXING
                </h3>
              </div>

              {/* Text Description Box matching reference */}
              <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-lg p-4 sm:p-5 mb-6 text-zinc-300 text-xs sm:text-sm font-medium uppercase leading-relaxed tracking-wide">
                Learn kickboxing in a high-energy training environment. Build strength, improve fitness, and develop striking technique through guided drills and conditioning. Whether you are new to boxing or an experienced athlete, our kickboxing training helps you grow confidence, coordination, and endurance.
              </div>
            </div>

            {/* 3 Thumbnail Images */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="aspect-[3/4] rounded-md overflow-hidden border border-zinc-800">
                <img
                  src={kickboxingCoaching}
                  alt="Coach guiding a kickboxing session"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <div className="aspect-[3/4] rounded-md overflow-hidden border border-zinc-800">
                <img
                  src={kickboxingKick}
                  alt="Athlete practicing a kickboxing kick with a coach"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <div className="aspect-[3/4] rounded-md overflow-hidden border border-zinc-800">
                <img
                  src={kickboxingPunch}
                  alt="Athlete practicing a kickboxing punch with a coach"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
