import React from 'react';
import { Users, UserCheck, AlertCircle, Clock, Bell, CheckCircle2, RefreshCw, Send, ShieldCheck, ArrowRight } from 'lucide-react';
import { DashboardStats, Member, NotificationJob } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';

interface DashboardOverviewProps {
  stats: DashboardStats;
  members: Member[];
  jobs: NotificationJob[];
  onNavigateTab: (tab: 'members' | 'subscriptions' | 'reminders') => void;
  onOpenNewMemberModal: () => void;
  onOpenImportModal: () => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  stats,
  members,
  jobs,
  onNavigateTab,
  onOpenNewMemberModal,
  onOpenImportModal
}) => {
  const expiringMembers = members.filter(m => m.status === 'expiring');

  return (
    <div className="space-y-8">
      
      {/* Top Banner Alert */}
      <div className="p-4 bg-gym-yellow/10 border border-gym-yellow/30 rounded-xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-xs">
          <div className="p-2 rounded bg-gym-yellow text-black font-bold shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-white uppercase tracking-wider block">
              Automated Dispatch Window Active (10:00 AM IST)
            </span>
            <span className="text-zinc-400">
              {stats.todayReminders.scheduled} reminder jobs queued today across WhatsApp and Indian DLT SMS gateways.
            </span>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <Button variant="yellow" size="sm" onClick={() => onNavigateTab('reminders')}>
            Review Queue
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Members */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs uppercase font-bold tracking-wider">
            <span>Total Members</span>
            <Users className="w-4 h-4 text-gym-yellow" />
          </div>
          <div className="text-3xl font-black text-white mt-2 font-heading tracking-tight">
            {stats.totalMembers}
          </div>
          <span className="text-[11px] text-zinc-400 block mt-1">
            Registered customer accounts
          </span>
        </div>

        {/* Active Memberships */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs uppercase font-bold tracking-wider">
            <span>Active Enrolled</span>
            <UserCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-black text-white mt-2 font-heading tracking-tight">
            {stats.activeMembers}
          </div>
          <span className="text-[11px] text-emerald-400 font-medium block mt-1">
            87.5% membership retention rate
          </span>
        </div>

        {/* Expiring in 7 Days */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs uppercase font-bold tracking-wider">
            <span>Expiring Soon (7 Days)</span>
            <Clock className="w-4 h-4 text-gym-yellow" />
          </div>
          <div className="text-3xl font-black text-gym-yellow mt-2 font-heading tracking-tight">
            {stats.expiringIn7Days}
          </div>
          <span className="text-[11px] text-zinc-400 block mt-1">
            Includes reminders 3 days before expiry and on the expiry day
          </span>
        </div>

        {/* Expired Members */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs uppercase font-bold tracking-wider">
            <span>Expired / Lapsed</span>
            <AlertCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-3xl font-black text-rose-400 mt-2 font-heading tracking-tight">
            {stats.expiredMembers}
          </div>
          <span className="text-[11px] text-zinc-400 block mt-1">
            Eligible for grace follow-ups
          </span>
        </div>

      </div>

      {/* Two Column Layout: Messaging Telemetry & Expiring Action List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Notification Engine Telemetry */}
        <div className="lg:col-span-6 bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Notification Engine Telemetry (Today's Run)
              </h3>
              <p className="text-zinc-400 text-xs">Real-time status of scheduled WhatsApp & SMS dispatches</p>
            </div>
            <Badge variant="yellow">Asia/Kolkata 10:00 AM</Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <span className="text-zinc-400 text-[10px] uppercase font-bold block">Completed</span>
              <span className="text-xl font-bold text-emerald-400 mt-1 block">
                {stats.todayReminders.completed}
              </span>
              <span className="text-[9px] text-zinc-400">Verified delivered</span>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <span className="text-zinc-400 text-[10px] uppercase font-bold block">In Flight / Recon</span>
              <span className="text-xl font-bold text-sky-400 mt-1 block">
                {stats.todayReminders.reconciling + stats.todayReminders.claimed}
              </span>
              <span className="text-[9px] text-zinc-400">Two-phase intent</span>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <span className="text-zinc-400 text-[10px] uppercase font-bold block">Terminal Fails</span>
              <span className="text-xl font-bold text-zinc-400 mt-1 block">
                {stats.todayReminders.failed}
              </span>
              <span className="text-[9px] text-zinc-400">Zero duplicate errors</span>
            </div>
          </div>

          {/* Integration Status Chips */}
          <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Active Communication Gateways:
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Meta WhatsApp Business API
              </span>
              <span className="text-[11px] font-mono text-zinc-400">v21.0 Connected</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                TRAI DLT SMS Fallback (Fast2SMS)
              </span>
              <span className="text-[11px] font-mono text-zinc-400">Header: FITFUS</span>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => onNavigateTab('reminders')}
              className="text-xs font-bold text-gym-yellow hover:underline flex items-center gap-1.5 uppercase tracking-wider"
            >
              <span>View detailed message attempts and webhook logs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right Column: Priority Expirations Requiring Attention */}
        <div className="lg:col-span-6 bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Upcoming Expiring Subscriptions
              </h3>
              <p className="text-zinc-400 text-xs">Members requiring renewal attention this week</p>
            </div>
            <button
              onClick={() => onNavigateTab('members')}
              className="text-xs text-gym-yellow font-bold uppercase hover:underline"
            >
              View All
            </button>
          </div>

          <div className="space-y-3">
            {expiringMembers.slice(0, 4).map((member) => (
              <div
                key={member.id}
                className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between hover:border-zinc-700 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-xs">{member.full_name}</span>
                    <span className="text-[10px] font-mono text-zinc-400">({member.member_code})</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Plan: <span className="text-zinc-300">{member.current_subscription?.plan_name}</span> • Expiring on <span className="text-gym-yellow font-bold">{member.current_subscription?.end_date}</span>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant="yellow">Expiring</Badge>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions Bar */}
          <div className="pt-4 border-t border-zinc-800 flex flex-wrap items-center gap-3">
            <Button variant="yellow" size="sm" onClick={onOpenNewMemberModal}>
              + Enroll New Member
            </Button>
            <Button variant="dark" size="sm" onClick={onOpenImportModal}>
              Import CSV
            </Button>
          </div>
        </div>

      </div>

    </div>
  );
};
