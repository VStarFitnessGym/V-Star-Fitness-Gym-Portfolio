import React, { useState } from 'react';
import { Send, MessageSquare, CheckCircle2, ShieldCheck, Phone } from 'lucide-react';
import { NotificationJob } from '../../types';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

interface PreviewMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: NotificationJob | null;
  onSimulateSend: (jobId: string) => void;
}

export const PreviewMessageModal: React.FC<PreviewMessageModalProps> = ({
  isOpen,
  onClose,
  job,
  onSimulateSend
}) => {
  const [isSending, setIsSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);

  if (!job) return null;

  const milestoneTitles = {
    EXPIRY_MINUS_3: 'Reminder 3 Days Before Expiry',
    EXPIRY_ZERO: 'Reminder on Expiry Day',
    EXPIRY_PLUS_3: 'Reminder 3 Days After Expiry',
    MANUAL_TRIGGER: 'On-Demand Manual Staff Reminder',
  };

  const renderedTemplate = `Hi ${job.member_name}, this is V-Star Fitness & Boxing Club. Your membership is scheduled to expire on ${job.target_date}. Please visit our front desk or reply here to renew your membership and avoid any workout interruption.`;

  const handleSend = () => {
    setIsSending(true);
    setTimeout(() => {
      onSimulateSend(job.id);
      setIsSending(false);
      setSentSuccess(true);
      setTimeout(() => {
        setSentSuccess(false);
        onClose();
      }, 1500);
    }, 800);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reminder Template Preview"
      subtitle={`${milestoneTitles[job.milestone]} • Channel: ${job.channel.toUpperCase()}`}
      maxWidth="md"
    >
      <div className="space-y-5 text-xs text-zinc-300">
        
        {/* Recipient Details */}
        <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <div className="text-white font-bold">{job.member_name}</div>
              <div className="text-zinc-400 text-[11px] font-mono">{job.member_phone}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Opt-in Verified</span>
          </div>
        </div>

        {/* WhatsApp Mobile Bubble Mockup */}
        <div>
          <div className="text-[11px] uppercase font-bold text-zinc-400 mb-2 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-gym-yellow" />
            <span>Rendered Template Payload (Meta Graph API v21.0)</span>
          </div>
          
          <div className="bg-[#0b141a] border border-zinc-800 rounded-xl p-4 shadow-inner relative">
            <div className="max-w-[85%] bg-[#005c4b] text-white text-xs p-3.5 rounded-lg rounded-tl-none shadow-md leading-relaxed space-y-2">
              <p>{renderedTemplate}</p>
              <div className="flex items-center justify-end gap-1 text-[10px] text-zinc-300">
                <span>10:00 AM</span>
                <span className="text-emerald-300 font-bold">✓✓</span>
              </div>
            </div>
          </div>
        </div>

        {/* Template Variables Audit */}
        <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-lg space-y-1 text-[11px]">
          <div className="text-zinc-400 font-bold uppercase tracking-wider mb-1">Approved Template Mapping:</div>
          <div className="grid grid-cols-2 gap-2 text-zinc-300">
            <div><span className="text-zinc-500">{'{{1}}'} Member Name:</span> {job.member_name}</div>
            <div><span className="text-zinc-500">{'{{2}}'} Gym Name:</span> V-Star</div>
            <div><span className="text-zinc-500">{'{{3}}'} Expiry Date:</span> {job.target_date}</div>
            <div><span className="text-zinc-500">Template ID:</span> <code className="text-gym-yellow">membership_expiry_reminder</code></div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
          <div className="text-[11px] text-zinc-400">
            Current Status: <span className="font-bold text-white uppercase">{job.status}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="dark" size="sm" onClick={onClose} disabled={isSending}>
              Close
            </Button>
            <Button variant="yellow" size="sm" onClick={handleSend} disabled={isSending || job.status === 'completed'}>
              {isSending ? (
                <span>Simulating...</span>
              ) : sentSuccess ? (
                <span className="flex items-center gap-1.5 text-black font-bold">
                  <CheckCircle2 className="w-4 h-4" /> Dispatched!
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Trigger Test Dispatch
                </span>
              )}
            </Button>
          </div>
        </div>

      </div>
    </Modal>
  );
};
