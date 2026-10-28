import React, { useState } from 'react';
import { Layers, ShieldCheck, Check, History, ArrowRight } from 'lucide-react';
import { Member, MembershipPlan } from '../../types';
import { MOCK_PLANS } from '../../data/mockData';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';

interface SubscriptionManagementProps {
  members: Member[];
  onOpenRenewalModal: (member: Member) => void;
}

export const SubscriptionManagement: React.FC<SubscriptionManagementProps> = ({
  members,
  onOpenRenewalModal
}) => {
  const [selectedMemberId, setSelectedMemberId] = useState<string>(members[0]?.id || '');

  const selectedMember = members.find(m => m.id === selectedMemberId);

  return (
    <div className="space-y-8">
      
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-white uppercase tracking-wider">
          Plan Catalog & Subscription History
        </h2>
        <p className="text-zinc-400 text-xs">
          Configure membership tiers and review non-destructive renewal lineages.
        </p>
      </div>

      {/* Database Invariant Callout */}
      <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-gym-yellow shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <span className="font-bold text-white uppercase tracking-wider block">
            PostgreSQL Exclusion Constraint Active (`btree_gist`)
          </span>
          <p className="text-zinc-400 leading-relaxed">
            The database engine enforces <code className="text-gym-yellow">no_overlapping_active_subscriptions</code> on <code>daterange(start_date, end_date, '[]')</code>. Members can never hold two overlapping active periods, ensuring mathematical integrity across cash and online renewals.
          </p>
        </div>
      </div>

      {/* Plan Catalog Grid */}
      <div className="space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Standardized Plan Packages (Sample Catalog)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {MOCK_PLANS.map((plan) => (
            <div key={plan.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white uppercase">{plan.name}</span>
                  <Badge variant={plan.is_active ? 'green' : 'gray'}>
                    {plan.is_active ? 'ACTIVE' : 'ARCHIVED'}
                  </Badge>
                </div>
                
                <div className="my-3">
                  <span className="text-2xl font-black text-white font-heading tracking-tight">
                    ₹{plan.price.toLocaleString('en-IN')}
                  </span>
                  <span className="text-zinc-400 text-[10px] block mt-0.5">
                    {plan.duration_days} Days Continuous Validity
                  </span>
                </div>

                <p className="text-zinc-400 text-xs mb-3">{plan.description}</p>
                
                <ul className="space-y-1.5 text-[11px] text-zinc-300">
                  {plan.perks.slice(0, 3).map((perk, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check className="w-3.5 h-3.5 text-gym-yellow shrink-0 mt-0.5" />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Renewal History Explorer */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <History className="w-4 h-4 text-gym-yellow" />
              <span>Non-Destructive Subscription Audit Trail</span>
            </h3>
            <p className="text-zinc-400 text-xs">
              Every renewal appends a new record while preserving historical receipts.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Select Member:</span>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.member_code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedMember && (
          <div className="space-y-4">
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
              <div>
                <div className="text-white font-bold text-sm">{selectedMember.full_name}</div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Code: <span className="font-mono text-zinc-300">{selectedMember.member_code}</span> • Phone: <span className="font-mono text-zinc-300">{selectedMember.phone}</span>
                </div>
              </div>
              <Button
                variant="yellow"
                size="sm"
                onClick={() => onOpenRenewalModal(selectedMember)}
              >
                + Renew Subscription
              </Button>
            </div>

            {/* Timeline View of Subscriptions */}
            <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
              {/* Active Current Term */}
              {selectedMember.current_subscription ? (
                <div className="relative">
                  <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-gym-yellow border-2 border-black" />
                  <div className="p-3.5 bg-zinc-950/80 border border-gym-yellow/40 rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs uppercase">
                        Current Term: {selectedMember.current_subscription.plan_name}
                      </span>
                      <Badge variant="green">ACTIVE</Badge>
                    </div>
                    <div className="text-xs text-zinc-400">
                      Validity: <strong className="text-white">{selectedMember.current_subscription.start_date}</strong> to <strong className="text-gym-yellow">{selectedMember.current_subscription.end_date}</strong>
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      Paid ₹{selectedMember.current_subscription.amount_paid.toLocaleString('en-IN')} via {selectedMember.current_subscription.payment_method.toUpperCase()} • OCC Version {selectedMember.current_subscription.version}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Historical Predecessor Term (Simulated) */}
              <div className="relative opacity-60">
                <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-zinc-600 border-2 border-black" />
                <div className="p-3.5 bg-zinc-950/50 border border-zinc-800 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-400 text-xs uppercase">
                      Prior Term: 3 Months Quarterly
                    </span>
                    <Badge variant="gray">SUPERSEDED</Badge>
                  </div>
                  <div className="text-xs text-zinc-400">
                    Validity: Prior 90 days • Completed without lapse
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Archived historical record (financial audit preserved)
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
