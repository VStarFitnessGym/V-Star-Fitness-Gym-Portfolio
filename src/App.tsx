import React from 'react';
import { Navbar } from './components/public/Navbar';
import { Hero } from './components/public/Hero';
import { NumberedFeatures } from './components/public/NumberedFeatures';
import { TrainingFacilities } from './components/public/TrainingFacilities';
import { HowItWorks } from './components/public/HowItWorks';
import { MembershipPackages } from './components/public/MembershipPackages';
import { ContactSection } from './components/public/ContactSection';
import { Footer } from './components/public/Footer';

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <Navbar />
      <Hero />
      <NumberedFeatures />
      <TrainingFacilities />
      <HowItWorks />
      <MembershipPackages onSelectPlan={() => {
        const contactElem = document.getElementById('contact');
        if (contactElem) contactElem.scrollIntoView({ behavior: 'smooth' });
      }} />
      <ContactSection />
      <Footer />
    </div>
  );
};

export default App;
