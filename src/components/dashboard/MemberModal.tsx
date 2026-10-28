import React, { useState, useEffect } from 'react';
import { UserCheck, ShieldCheck } from 'lucide-react';
import { Member } from '../../types';
import { MOCK_PLANS } from '../../data/mockData';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  memberToEdit?: Member | null;
  onSaveMember: (memberData: any) => void;
}

export const MemberModal: React.FC<MemberModalProps> = ({
  isOpen,
  onClose,
  memberToEdit,
  onSaveMember
}) => {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    gender: 'male' as 'male' | 'female' | 'other' | 'prefer_not_to_say',
    whatsappConsent: true,
    smsConsent: true,
    emergencyName: '',
    emergencyPhone: '',
    notes: '',
    initialPlanId: MOCK_PLANS[0].id,
    paymentMethod: 'upi' as 'cash' | 'upi' | 'card' | 'bank_transfer' | 'other'
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (memberToEdit) {
      setFormData({
        fullName: memberToEdit.full_name,
        phone: memberToEdit.phone,
        email: memberToEdit.email || '',
        gender: memberToEdit.gender || 'male',
        whatsappConsent: memberToEdit.whatsapp_consent,
        smsConsent: memberToEdit.sms_consent,
        emergencyName: memberToEdit.emergency_contact_name || '',
        emergencyPhone: memberToEdit.emergency_contact_phone || '',
        notes: memberToEdit.notes || '',
        initialPlanId: memberToEdit.current_subscription?.plan_id || MOCK_PLANS[0].id,
        paymentMethod: memberToEdit.current_subscription?.payment_method || 'upi'
      });
    } else {
      setFormData({
        fullName: '',
        phone: '+91',
        email: '',
        gender: 'male',
        whatsappConsent: true,
        smsConsent: true,
        emergencyName: '',
        emergencyPhone: '',
        notes: '',
        initialPlanId: MOCK_PLANS[0].id,
        paymentMethod: 'upi'
      });
    }
    setErrors({});
  }, [memberToEdit, isOpen]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.fullName.trim() || formData.fullName.length < 2) {
      errs.fullName = 'Full legal name must be at least 2 characters.';
    }
    const phoneRegex = /^\+91[6-9]\d{9}$/;
    if (!phoneRegex.test(formData.phone)) {
      errs.phone = 'Must be valid Indian mobile (+91 followed by 10 digits starting with 6-9).';
    }
    if (formData.email && !formData.email.includes('@')) {
      errs.email = 'Invalid email address.';
    }
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    onSaveMember(formData);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={memberToEdit ? 'Edit Member Profile' : 'Enroll New Member'}
      subtitle={memberToEdit ? `Updating profile for ${memberToEdit.member_code}` : 'Register a new customer with verified communication consent'}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs text-zinc-300">
        
        {/* Full Name & Phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Full Legal Name *
            </label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="e.g. Ramesh Varma"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
              required
            />
            {errors.fullName && <p className="text-rose-400 text-[11px] mt-1">{errors.fullName}</p>}
          </div>

          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Mobile Phone (E.164) *
            </label>
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+919876543210"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-gym-yellow text-xs"
              required
            />
            {errors.phone && <p className="text-rose-400 text-[11px] mt-1">{errors.phone}</p>}
          </div>
        </div>

        {/* Email & Gender */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Email Address (Optional)
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="ramesh@example.com"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
            />
            {errors.email && <p className="text-rose-400 text-[11px] mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Gender
            </label>
            <select
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value as any })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>
        </div>

        {/* DPDP Act Regulatory Consent Checkboxes */}
        <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-gym-yellow uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Digital Personal Data Protection (DPDP) Consents</span>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.whatsappConsent}
              onChange={(e) => setFormData({ ...formData, whatsappConsent: e.target.checked })}
              className="mt-0.5 rounded border-zinc-700 text-gym-yellow focus:ring-0 w-4 h-4"
            />
            <span className="text-[11px] text-zinc-300">
              <strong>WhatsApp Reminders Opt-in:</strong> Member explicitly consents to receive transactional subscription expiry notices on WhatsApp.
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.smsConsent}
              onChange={(e) => setFormData({ ...formData, smsConsent: e.target.checked })}
              className="mt-0.5 rounded border-zinc-700 text-gym-yellow focus:ring-0 w-4 h-4"
            />
            <span className="text-[11px] text-zinc-300">
              <strong>SMS Fallback Opt-in:</strong> Member consents to receiving TRAI DLT-compliant SMS notifications if WhatsApp delivery fails.
            </span>
          </label>
        </div>

        {/* Emergency Contact */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Emergency Contact Name
            </label>
            <input
              type="text"
              value={formData.emergencyName}
              onChange={(e) => setFormData({ ...formData, emergencyName: e.target.value })}
              placeholder="Spouse / Parent / Friend"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
            />
          </div>

          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Emergency Contact Phone
            </label>
            <input
              type="text"
              value={formData.emergencyPhone}
              onChange={(e) => setFormData({ ...formData, emergencyPhone: e.target.value })}
              placeholder="+919876543219"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-gym-yellow text-xs"
            />
          </div>
        </div>

        {/* Initial Plan Assignment if creating new member */}
        {!memberToEdit && (
          <div className="p-3.5 bg-zinc-950/80 border border-zinc-800 rounded-lg space-y-3">
            <div className="text-xs font-bold text-white uppercase tracking-wider">
              Initial Membership Plan Assignment
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Plan Package</label>
                <select
                  value={formData.initialPlanId}
                  onChange={(e) => setFormData({ ...formData, initialPlanId: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  {MOCK_PLANS.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} (₹{plan.price.toLocaleString('en-IN')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Payment Method</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as any })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  <option value="upi">UPI / QR Code</option>
                  <option value="cash">Cash (Front Desk)</option>
                  <option value="card">Credit / Debit Card</option>
                  <option value="bank_transfer">Net Banking</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Administrative Notes */}
        <div>
          <label className="block uppercase font-bold text-zinc-400 mb-1">
            Notes / Fitness Goals
          </label>
          <input
            type="text"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="e.g. Needs towel service; focusing on rehabilitation"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
          />
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
          <Button type="button" variant="dark" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="yellow" size="sm">
            <UserCheck className="w-3.5 h-3.5" />
            {memberToEdit ? 'Save Changes' : 'Enroll Member'}
          </Button>
        </div>

      </form>
    </Modal>
  );
};
