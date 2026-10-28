import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Member } from '../../types';
import { MOCK_PLANS } from '../../data/mockData';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { apiClient } from '../../lib/api/client';
import { ApiClientError } from '../../lib/api/errors';
import { ApiRenewalResponse } from '../../lib/api/types';

interface RenewalModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  mode?: 'demo' | 'live';
  onConfirmRenewal: (memberId: string, renewalData: {
    planId: string;
    startDate: string;
    endDate: string;
    amountPaid: number;
    paymentMethod: 'cash' | 'upi' | 'card' | 'bank_transfer' | 'other';
    notes?: string;
    idempotencyKey: string;
    serverConfirmed?: ApiRenewalResponse;
  }) => void;
}

export const RenewalModal: React.FC<RenewalModalProps> = ({
  isOpen,
  onClose,
  member,
  mode = 'demo',
  onConfirmRenewal
}) => {
  const [selectedPlanId, setSelectedPlanId] = useState<string>(MOCK_PLANS[1].id); // 3-month default
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [amountPaid, setAmountPaid] = useState<number>(MOCK_PLANS[1].price);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'card' | 'bank_transfer' | 'other'>('upi');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [error, setError] = useState<ApiClientError | null>(null);
  const [confirmedResult, setConfirmedResult] = useState<ApiRenewalResponse | null>(null);

  // Generate fresh UUID idempotency key when modal opens for a member
  useEffect(() => {
    if (isOpen && member) {
      // Generate a fresh RFC 4122 v4 UUID
      const freshKey = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : '00000000-0000-4000-8000-000000000000'.replace(/[08]/g, (c) =>
            ((Math.random() * 16) | (c === '8' ? 8 : 0)).toString(16)
          );
      setIdempotencyKey(freshKey);
      setError(null);
      setConfirmedResult(null);

      if (member.current_subscription) {
        const curEnd = new Date(member.current_subscription.end_date);
        curEnd.setDate(curEnd.getDate() + 1);
        const nextStartStr = curEnd.toISOString().split('T')[0];
        setStartDate(nextStartStr);
        updateEndDate(nextStartStr, selectedPlanId);
      } else {
        const todayStr = new Date().toISOString().split('T')[0];
        setStartDate(todayStr);
        updateEndDate(todayStr, selectedPlanId);
      }
    }
  }, [isOpen, member]);

  const updateEndDate = (start: string, planId: string) => {
    const plan = MOCK_PLANS.find((p) => p.id === planId) || MOCK_PLANS[0];
    const sDate = new Date(start);
    if (!isNaN(sDate.getTime())) {
      sDate.setDate(sDate.getDate() + plan.duration_days - 1);
      setEndDate(sDate.toISOString().split('T')[0]);
      setAmountPaid(plan.price);
    }
  };

  const handlePlanChange = (planId: string) => {
    setSelectedPlanId(planId);
    updateEndDate(startDate, planId);
  };

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    updateEndDate(val, selectedPlanId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;

    setIsSubmitting(true);
    setError(null);

    // ------------------------------------------------------------------------
    // Live Backend Mode: Calls POST /api/subscriptions/renew with idempotency key
    // ------------------------------------------------------------------------
    if (mode === 'live') {
      try {
        const response = await apiClient.renewSubscription({
          member_id: member.id,
          plan_id: selectedPlanId,
          amount_paid: amountPaid,
          payment_method: paymentMethod,
          idempotency_key: idempotencyKey, // Reuses same key on retry!
          start_date: startDate || undefined,
          notes: notes || undefined
        });

        setConfirmedResult(response);
        setIsSubmitting(false);

        // Notify parent state
        onConfirmRenewal(member.id, {
          planId: selectedPlanId,
          startDate: response.start_date,
          endDate: response.end_date,
          amountPaid: response.amount_paid,
          paymentMethod,
          notes,
          idempotencyKey,
          serverConfirmed: response
        });
      } catch (err: any) {
        setIsSubmitting(false);
        // Note: Do NOT regenerate idempotencyKey! Keeping the same key allows safe retry.
        if (err instanceof ApiClientError) {
          setError(err);
        } else {
          setError(
            new ApiClientError({
              message: err?.message || 'An unexpected error occurred during renewal.',
              status: 0,
              isNetworkError: true
            })
          );
        }
      }
      return;
    }

    // ------------------------------------------------------------------------
    // Demo Mode: Local offline synthetic renewal
    // ------------------------------------------------------------------------
    setTimeout(() => {
      onConfirmRenewal(member.id, {
        planId: selectedPlanId,
        startDate,
        endDate,
        amountPaid,
        paymentMethod,
        notes,
        idempotencyKey
      });
      setIsSubmitting(false);
      setConfirmedResult({
        subscription_id: `sub-${Date.now()}`,
        member_id: member.id,
        plan_id: selectedPlanId,
        start_date: startDate,
        end_date: endDate,
        amount_paid: amountPaid,
        status: 'active',
        idempotency_key: idempotencyKey,
        idempotent_replay: false
      });
    }, 400);
  };

  if (!member) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Renew Membership Subscription"
      subtitle={`Member: ${member.full_name} (${member.member_code})`}
      maxWidth="lg"
    >
      {confirmedResult ? (
        <div className="py-6 text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
          <h4 className="font-heading text-xl font-bold text-white uppercase">
            {confirmedResult.idempotent_replay ? 'Subscription Replay Confirmed!' : 'Subscription Renewed!'}
          </h4>
          
          <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg text-left text-xs space-y-2 max-w-md mx-auto">
            <div className="flex justify-between text-zinc-400">
              <span>Subscription ID:</span>
              <span className="font-mono text-zinc-200">{confirmedResult.subscription_id}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Coverage Period:</span>
              <span className="font-semibold text-emerald-400">
                {confirmedResult.start_date} to {confirmedResult.end_date}
              </span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Amount Recorded:</span>
              <span className="font-bold text-white">₹{confirmedResult.amount_paid.toLocaleString('en-IN')}</span>
            </div>
            {confirmedResult.idempotent_replay && (
              <div className="text-[11px] text-amber-300 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                <strong>Idempotent Replay:</strong> This operation returned an already-committed renewal record without creating duplicates.
              </div>
            )}
          </div>

          <p className="text-zinc-400 text-xs">
            Membership term successfully updated in system ledger. Prior pending expiration reminders have been cancelled.
          </p>

          <div className="pt-2">
            <Button variant="yellow" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs text-zinc-300">
          
          {/* Current Membership Context Card */}
          <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1">
            <div className="flex justify-between items-center text-zinc-400">
              <span>Current Plan:</span>
              <span className="font-semibold text-white">{member.current_subscription?.plan_name || 'No active plan'}</span>
            </div>
            <div className="flex justify-between items-center text-zinc-400">
              <span>Current Expiry Date:</span>
              <span className="font-semibold text-gym-yellow">{member.current_subscription?.end_date || 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center text-zinc-400">
              <span>Mode:</span>
              <span className={`text-[11px] font-bold uppercase ${mode === 'live' ? 'text-emerald-400' : 'text-gym-yellow'}`}>
                {mode === 'live' ? 'Live API Connected (/api)' : 'Demo Simulation Mode'}
              </span>
            </div>
          </div>

          {/* Uncertain Outcome vs. Definitive Error Card */}
          {error && (
            <div
              className={`p-3 rounded-lg space-y-2 border ${
                error.isTimeout || error.isNetworkError
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    error.isTimeout || error.isNetworkError ? 'text-amber-400' : 'text-rose-400'
                  }`}
                />
                <div className="flex-1">
                  <div className="font-bold text-white">
                    {error.isTimeout || error.isNetworkError
                      ? 'Renewal Status Uncertain (Ambiguous Outcome)'
                      : `Renewal Error (${error.code})`}
                  </div>
                  <div className="text-xs mt-0.5">
                    {error.isTimeout || error.isNetworkError
                      ? 'The connection timed out or disconnected before server confirmation was received. The renewal transaction may have already completed on the backend. Retrying will safely query or complete the operation using the preserved transaction key.'
                      : error.getUserMessage()}
                  </div>
                  {error.requestId && (
                    <div className="text-[10px] text-zinc-400 font-mono mt-1">Request ID: {error.requestId}</div>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-zinc-400 bg-zinc-950/60 p-2 rounded">
                <strong>Idempotency Preserved:</strong> Retrying will use the same transaction key ({idempotencyKey.slice(0, 8)}...) to ensure zero duplicate renewals or multiple charges.
              </div>
            </div>
          )}

          {/* Select New Plan */}
          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Select Membership Plan *
            </label>
            <select
              value={selectedPlanId}
              onChange={(e) => handlePlanChange(e.target.value)}
              disabled={isSubmitting}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
            >
              {MOCK_PLANS.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} ({plan.duration_days} Days) — ₹{plan.price.toLocaleString('en-IN')}
                </option>
              ))}
            </select>
          </div>

          {/* Date Calculation Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block uppercase font-bold text-zinc-400 mb-1">
                New Start Date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
                required
              />
              <span className="text-[10px] text-zinc-500 block mt-0.5">Contiguous start date</span>
            </div>

            <div>
              <label className="block uppercase font-bold text-zinc-400 mb-1">
                Calculated Expiry Date
              </label>
              <input
                type="date"
                value={endDate}
                readOnly
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-gym-yellow font-bold text-xs"
              />
              <span className="text-[10px] text-zinc-500 block mt-0.5">Computed from plan duration</span>
            </div>
          </div>

          {/* Payment Method & Amount */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block uppercase font-bold text-zinc-400 mb-1">
                Amount Paid (INR ₹) *
              </label>
              <input
                type="number"
                min="0"
                value={amountPaid}
                onChange={(e) => setAmountPaid(Number(e.target.value))}
                disabled={isSubmitting}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white font-bold focus:outline-none focus:border-gym-yellow text-xs"
                required
              />
            </div>

            <div>
              <label className="block uppercase font-bold text-zinc-400 mb-1">
                Payment Method *
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                disabled={isSubmitting}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
              >
                <option value="upi">UPI / QR Code</option>
                <option value="cash">Cash (Front Desk)</option>
                <option value="card">Credit / Debit Card</option>
                <option value="bank_transfer">Net Banking / NEFT</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block uppercase font-bold text-zinc-400 mb-1">
              Staff Renewal Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. Paid cash at front desk"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-gym-yellow text-xs"
            />
          </div>

          {/* Non-Destructive Invariant Notice */}
          <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-start gap-2 text-[11px] text-zinc-400">
            <ShieldCheck className="w-4 h-4 shrink-0 text-gym-yellow mt-0.5" />
            <span>
              <strong>System Ledger Guarantee:</strong> Records membership extension without charging payment gateways. Prior pending reminder jobs are transactionally invalidated.
            </span>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <Button type="button" variant="dark" size="sm" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="yellow" size="sm" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Recording...
                </>
              ) : error ? (
                error.isTimeout || error.isNetworkError ? 'Retry (Verify / Complete)' : 'Retry Renewal'
              ) : (
                'Confirm Renewal'
              )}
            </Button>
          </div>

        </form>
      )}
    </Modal>
  );
};
