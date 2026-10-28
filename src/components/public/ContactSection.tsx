import React, { useState } from 'react';
import { Phone, Mail, MapPin, Instagram, Facebook, CheckCircle2 } from 'lucide-react';
import { Button } from '../shared/Button';

const BUSINESS_HOURS = [
  { day: 'Monday', morning: '5:30 AM - 10:00 AM', evening: '5:00 PM - 9:00 PM' },
  { day: 'Tuesday', morning: '5:30 AM - 10:00 AM', evening: '5:00 PM - 9:00 PM' },
  { day: 'Wednesday', morning: '5:30 AM - 10:00 AM', evening: '5:00 PM - 9:00 PM' },
  { day: 'Thursday', morning: '5:30 AM - 10:00 AM', evening: '5:00 PM - 9:00 PM' },
  { day: 'Friday', morning: '5:30 AM - 10:00 AM', evening: '5:00 PM - 9:00 PM' },
  { day: 'Saturday', morning: '5:30 AM - 10:00 AM', evening: '5:00 PM - 9:00 PM' },
];

export const ContactSection: React.FC = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.fullName.trim()) errs.fullName = 'Full name is required';
    if (!formData.email.trim() || !formData.email.includes('@')) errs.email = 'Valid email is required';
    if (!formData.phone.trim()) errs.phone = 'Phone number is required';
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setSubmitted(true);
    setTimeout(() => {
      setFormData({ fullName: '', email: '', phone: '', message: '' });
      setSubmitted(false);
    }, 4000);
  };

  return (
    <section id="contact" className="py-16 sm:py-24 bg-zinc-950 border-t border-zinc-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading matching reference */}
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="font-heading text-4xl sm:text-6xl font-black text-white tracking-widest uppercase">
            CONTACT
          </h2>
        </div>

        {/* Two-Column Grid matching reference */}
        <div className="grid grid-cols-1 items-stretch lg:grid-cols-12 gap-8 sm:gap-12 lg:gap-16">
          
          {/* Left Column: Contact details & Working hours table */}
          <div className="lg:col-span-5 space-y-8">
            <div className="space-y-6">
              
              {/* Phone */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-gym-yellow">
                  <Phone className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase font-bold text-zinc-400 tracking-wider">Phone</div>
                  <a href="tel:+919966975706" className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-white tracking-wide hover:text-gym-yellow transition-colors sm:min-h-0">99669 75706</a>
                </div>
              </div>

              {/* Email */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-gym-yellow">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase font-bold text-zinc-400 tracking-wider">Email Address</div>
                  <a href="mailto:vstarfitnessgym@gmail.com" className="inline-flex min-h-11 items-center break-all text-sm font-semibold text-white tracking-wide hover:text-gym-yellow transition-colors sm:min-h-0">vstarfitnessgym@gmail.com</a>
                </div>
              </div>

              {/* Location */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-gym-yellow">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase font-bold text-zinc-400 tracking-wider">Facility Address</div>
                  <a href="https://www.google.com/maps/search/?api=1&query=V+Star+Boxing+and+Fitness%2C+43-1-1%2F1%2C+Ragampet%2C+Suryanarayana+Puram%2C+Kakinada%2C+Andhra+Pradesh+533001" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-white tracking-wide hover:text-gym-yellow transition-colors sm:min-h-0">2nd Floor , Opposite Sri Vasavi Kanyaka Parameswari Devalayam , Main Road , Kakinada</a>
                </div>
              </div>

            </div>

            {/* Social Icons matching reference */}
            <div className="pt-2">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                SOCIAL PROFILE
              </div>
              <div className="flex items-center gap-3">
                <a href="https://www.instagram.com/boxer_srinu_kakinada_/" target="_blank" rel="noreferrer" className="h-11 w-11 sm:h-10 sm:w-10 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-gym-yellow hover:border-gym-yellow transition-colors" aria-label="Instagram">
                  <Instagram className="w-4 h-4" />
                </a>
                <a href="#contact" className="h-11 w-11 sm:h-10 sm:w-10 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-gym-yellow hover:border-gym-yellow transition-colors" aria-label="Facebook">
                  <Facebook className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* Business Hours Table matching reference */}
            <div className="pt-4">
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-lg overflow-hidden text-xs">
                <table className="w-full table-fixed divide-y divide-zinc-800">
                  <thead>
                    <tr className="text-gym-yellow">
                      <th scope="col" className="w-1/4 px-2 py-2 text-left font-bold uppercase sm:px-4">Day</th>
                      <th scope="col" className="w-[37.5%] px-2 py-2 text-left font-bold uppercase sm:px-4">Morning</th>
                      <th scope="col" className="w-[37.5%] px-2 py-2 text-left font-bold uppercase sm:px-4">Evening</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-300">
                    {BUSINESS_HOURS.map(({ day, morning, evening }) => (
                      <tr key={day}>
                        <th scope="row" className="break-words px-2 py-2.5 text-left font-bold uppercase text-white sm:px-4">{day}</th>
                        <td className="break-words px-2 py-2.5 sm:px-4">{morning}</td>
                        <td className="break-words px-2 py-2.5 sm:px-4">{evening}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Right Column: Contact Form */}
          <div className="lg:col-span-7 h-full bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 sm:p-6 lg:p-10 relative">
            {submitted ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-4">
                <CheckCircle2 className="w-16 h-16 text-gym-yellow animate-bounce" />
                <h3 className="font-heading text-2xl font-bold text-white uppercase tracking-wide">
                  Message Dispatched!
                </h3>
                <p className="text-zinc-400 text-sm max-w-md">
                  Thank you for reaching out. Our front desk staff will contact you shortly via phone or WhatsApp. (Demo submission recorded).
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex h-full flex-col space-y-6">
                <div>
                  <label htmlFor="contact-full-name" className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    FULL NAME *
                  </label>
                  <input
                    id="contact-full-name"
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="Enter your legal name"
                    className="min-h-11 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-gym-yellow transition-colors"
                  />
                  {errors.fullName && <p id="contact-full-name-error" role="alert" className="text-rose-400 text-xs mt-1">{errors.fullName}</p>}
                </div>

                <div>
                  <label htmlFor="contact-email" className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    EMAIL ADDRESS *
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="your.email@example.com"
                    className="min-h-11 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-gym-yellow transition-colors"
                  />
                  {errors.email && <p id="contact-email-error" role="alert" className="text-rose-400 text-xs mt-1">{errors.email}</p>}
                </div>

                <div>
                  <label htmlFor="contact-phone" className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    PHONE *
                  </label>
                  <input
                    id="contact-phone"
                    type="tel"
                    inputMode="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="Your phone number"
                    className="min-h-11 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-gym-yellow transition-colors"
                  />
                  {errors.phone && <p id="contact-phone-error" role="alert" className="text-rose-400 text-xs mt-1">{errors.phone}</p>}
                </div>

                <div className="flex flex-1 flex-col">
                  <label htmlFor="contact-message" className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    MESSAGE
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Inquire about trial passes, personal training, or facilities..."
                    className="min-h-28 w-full flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-gym-yellow transition-colors resize-y"
                  />
                </div>

                <div>
                  <button
                    type="submit"
                    className="min-h-11 w-full sm:w-48 py-3 bg-white text-black font-heading font-black text-sm tracking-widest uppercase hover:bg-gym-yellow transition-colors rounded shadow-lg cursor-pointer"
                  >
                    SUBMIT
                  </button>
                </div>
              </form>
            )}
          </div>

        </div>

      </div>
    </section>
  );
};
