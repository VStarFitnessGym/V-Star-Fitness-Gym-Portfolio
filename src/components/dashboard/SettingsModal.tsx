import React from 'react';
import { Settings, Shield, Clock, PhoneCall, CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gym Operations & Integration Settings"
      subtitle="Operational timezones, business profiles, and communication gateways"
      maxWidth="xl"
    >
      <div className="space-y-6 text-xs text-zinc-300">
        
        {/* Gym Profile */}
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-gym-yellow flex items-center gap-1.5">
            <Settings className="w-4 h-4" />
            <span>Business Profile & Operational Timezone</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-zinc-950 p-4 border border-zinc-800 rounded-xl">
            <div>
              <span className="text-zinc-500 block">Gym Trade Name:</span>
              <span className="text-white font-bold text-sm">V-Star Fitness & Boxing Club</span>
            </div>
            <div>
              <span className="text-zinc-500 block">Operating Timezone:</span>
              <span className="text-white font-bold text-sm flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-gym-yellow" /> Asia/Kolkata (UTC+05:30)
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block">Daily Dispatch Window:</span>
              <span className="text-white font-bold">10:00 AM IST (Daily Scheduled Cron)</span>
            </div>
            <div>
              <span className="text-zinc-500 block">Default Currency:</span>
              <span className="text-white font-bold">INR (₹) Indian Rupee</span>
            </div>
          </div>
        </div>

        {/* Integration Status Cards */}
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-gym-yellow flex items-center gap-1.5">
            <PhoneCall className="w-4 h-4" />
            <span>Messaging Gateways & Carrier Verification</span>
          </div>

          <div className="space-y-3">
            {/* Meta WhatsApp Cloud API */}
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">Meta WhatsApp Cloud API</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Connected (v21.0)
                  </span>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Registered Template: <code className="text-gym-yellow">membership_expiry_reminder</code> (Utility Category).
                </p>
                <p className="text-zinc-500 text-[10px]">
                  Phone Number ID: ••••••••••••8402 | Webhook Verified: HMAC-SHA256
                </p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
            </div>

            {/* Indian DLT SMS Gateway */}
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">TRAI DLT SMS Fallback Gateway</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Registered
                  </span>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Header ID: <code className="text-gym-yellow">FITFUS</code> (6-character Alpha) | Aggregator: Fast2SMS / MSG91
                </p>
                <p className="text-zinc-500 text-[10px]">
                  Entity ID: 1701159823482390192 | Strict Rule: Suppressed on timeouts; triggered only on verified WhatsApp 4xx failure.
                </p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
            </div>
          </div>
        </div>

        {/* Security Notice */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-start gap-2.5 text-[11px] text-zinc-400">
          <Shield className="w-4 h-4 text-gym-yellow shrink-0 mt-0.5" />
          <span>
            <strong>Zero Secret Leakage:</strong> All Meta tokens, DLT auth keys, and database service-role secrets reside strictly in secure serverless environment variables. No credentials are accessible to the client browser.
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex justify-end pt-2 border-t border-zinc-800">
          <Button variant="yellow" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>

      </div>
    </Modal>
  );
};
