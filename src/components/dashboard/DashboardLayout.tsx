import React, { useState, useEffect, useCallback } from 'react';
import { Dumbbell, LayoutDashboard, Users, CreditCard, Bell, FileSpreadsheet, Settings, LogOut, ShieldCheck, RefreshCw } from 'lucide-react';
import { Member, DashboardStats, NotificationJob } from '../../types';
import { apiClient } from '../../lib/api/client';
import { DashboardOverview } from './DashboardOverview';
import { MemberManagement } from './MemberManagement';
import { SubscriptionManagement } from './SubscriptionManagement';
import { ReminderManagement } from './ReminderManagement';
import { ImportExportModal } from './ImportExportModal';
import { SettingsModal } from './SettingsModal';
import { RenewalModal } from './RenewalModal';
import { MemberModal } from './MemberModal';
import { PreviewMessageModal } from './PreviewMessageModal';

interface DashboardLayoutProps {
  members: Member[];
  jobs: NotificationJob[];
  stats: DashboardStats;
  appMode?: 'demo' | 'live';
  onToggleAppMode?: () => void;
  onExitToPublic: () => void;
  onAddMember: (memberData: any) => void;
  onEditMember: (memberData: any) => void;
  onRenewalConfirmed: (memberId: string, data: any) => void;
  onArchiveMember: (memberId: string) => void;
  onSimulateSend: (jobId: string) => void;
  onImportMembers: (imported: Partial<Member>[]) => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  members,
  jobs,
  stats,
  appMode = 'demo',
  onToggleAppMode,
  onExitToPublic,
  onAddMember,
  onEditMember,
  onRenewalConfirmed,
  onArchiveMember,
  onSimulateSend,
  onImportMembers
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'subscriptions' | 'reminders'>('overview');
  
  // Real API Health / Connection State (Audited for Live Mode Accuracy)
  const [apiConnection, setApiConnection] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [apiDetail, setApiDetail] = useState<string>('');

  const checkLiveApiHealth = useCallback(async () => {
    if (appMode !== 'live') return;
    setApiConnection('checking');
    try {
      const res = await apiClient.getHealth();
      if (res.status === 'healthy' && res.database === 'connected') {
        setApiConnection('connected');
        setApiDetail(`Backend Ready (v${res.version})`);
      } else {
        setApiConnection('disconnected');
        setApiDetail('Database Degraded');
      }
    } catch {
      setApiConnection('disconnected');
      setApiDetail('Server Unreachable');
    }
  }, [appMode]);

  useEffect(() => {
    if (appMode === 'live') {
      checkLiveApiHealth();
    }
  }, [appMode, checkLiveApiHealth]);

  // Modals state
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [memberToEdit, setMemberToEdit] = useState<Member | null>(null);
  
  const [isRenewalModalOpen, setIsRenewalModalOpen] = useState(false);
  const [memberToRenew, setMemberToRenew] = useState<Member | null>(null);

  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [jobToPreview, setJobToPreview] = useState<NotificationJob | null>(null);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const handleOpenEditMember = (member: Member) => {
    setMemberToEdit(member);
    setIsMemberModalOpen(true);
  };

  const handleOpenRenewal = (member: Member) => {
    setMemberToRenew(member);
    setIsRenewalModalOpen(true);
  };

  const handleOpenPreview = (job: NotificationJob) => {
    setJobToPreview(job);
    setIsPreviewModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      
      {/* Top Operational Mode & Safety Indicator Bar */}
      <div
        className={`px-4 py-1.5 text-xs font-black tracking-wider uppercase flex items-center justify-between border-b ${
          appMode === 'live'
            ? apiConnection === 'connected'
              ? 'bg-zinc-950 border-emerald-500/40 text-emerald-400'
              : apiConnection === 'checking'
              ? 'bg-zinc-950 border-amber-500/40 text-amber-300'
              : 'bg-zinc-950 border-rose-500/40 text-rose-300'
            : 'bg-gym-yellow text-black border-yellow-500'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                appMode === 'live'
                  ? apiConnection === 'connected'
                    ? 'bg-emerald-400 animate-pulse'
                    : apiConnection === 'checking'
                    ? 'bg-amber-400 animate-spin'
                    : 'bg-rose-400'
                  : 'bg-black'
              }`}
            />
            <span className="font-bold">
              {appMode === 'live' ? (
                apiConnection === 'connected' ? (
                  `LIVE API MODE • Connected to /api (${apiDetail})`
                ) : apiConnection === 'checking' ? (
                  'LIVE API MODE • Probing /api connection...'
                ) : (
                  `LIVE API MODE • Disconnected from /api (${apiDetail})`
                )
              ) : (
                'DEMO MODE • Simulated DB & Offline Synthetic Data'
              )}
            </span>
          </div>

          {appMode === 'live' && apiConnection === 'disconnected' && (
            <button
              onClick={checkLiveApiHealth}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40 cursor-pointer flex items-center gap-1"
              title="Retry API health probe"
            >
              <RefreshCw className="w-2.5 h-2.5" /> Retry Connection
            </button>
          )}

          {onToggleAppMode && (
            <button
              onClick={onToggleAppMode}
              role="switch"
              aria-checked={appMode === 'live'}
              aria-label={appMode === 'live' ? 'Switch to Demo Mode' : 'Switch to Live API Mode'}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${
                appMode === 'live'
                  ? 'bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-700'
                  : 'bg-black/15 text-black hover:bg-black/25'
              }`}
            >
              {appMode === 'live' ? 'Switch to Demo Mode' : 'Switch to Live API Mode'}
            </button>
          )}
        </div>

        <button
          onClick={onExitToPublic}
          className={`hover:underline flex items-center gap-1 cursor-pointer font-bold ${
            appMode === 'live' ? 'text-zinc-400 hover:text-white' : 'text-black'
          }`}
        >
          <span>Exit to Public Website</span>
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Admin Navigation Bar */}
      <header className="bg-zinc-950 border-b border-zinc-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-zinc-900 border border-zinc-700 flex items-center justify-center text-gym-yellow">
                <Dumbbell className="w-5 h-5 transform -rotate-45" />
              </div>
              <div className="flex flex-col">
                <span className="font-heading text-lg font-bold tracking-wider text-white">
                  FIT<span className="text-gym-yellow">FUSION</span> ADMIN
                </span>
                <span className="text-[9px] uppercase tracking-widest text-zinc-400 -mt-1 font-semibold">
                  Management & Expiry Reminders
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="hidden md:flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-zinc-800">
              {[
                { id: 'overview', label: 'Overview', icon: LayoutDashboard },
                { id: 'members', label: 'Members', icon: Users },
                { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
                { id: 'reminders', label: 'Reminders', icon: Bell },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                      isActive
                        ? 'bg-gym-yellow text-black shadow-sm'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                title="Bulk CSV Import / Export"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-gym-yellow" />
                <span>Import / Export</span>
              </button>

              <button
                onClick={() => setIsSettingsModalOpen(true)}
                className="p-2 text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors cursor-pointer"
                title="System Settings"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                onClick={onExitToPublic}
                className="p-2 text-zinc-400 hover:text-rose-400 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors cursor-pointer"
                title="Log Out & Return to Public Website"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="md:hidden flex items-center justify-around border-t border-zinc-800 px-2 py-1.5 bg-zinc-950 overflow-x-auto text-[11px] font-bold uppercase tracking-wider">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-2 py-1 rounded ${activeTab === 'overview' ? 'text-gym-yellow' : 'text-zinc-400'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`px-2 py-1 rounded ${activeTab === 'members' ? 'text-gym-yellow' : 'text-zinc-400'}`}
          >
            Members
          </button>
          <button
            onClick={() => setActiveTab('subscriptions')}
            className={`px-2 py-1 rounded ${activeTab === 'subscriptions' ? 'text-gym-yellow' : 'text-zinc-400'}`}
          >
            Subscriptions
          </button>
          <button
            onClick={() => setActiveTab('reminders')}
            className={`px-2 py-1 rounded ${activeTab === 'reminders' ? 'text-gym-yellow' : 'text-zinc-400'}`}
          >
            Reminders
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-2 py-1 text-zinc-400"
          >
            CSV
          </button>
        </div>
      </header>

      {/* Main Content View */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <DashboardOverview
            stats={stats}
            members={members}
            jobs={jobs}
            onNavigateTab={setActiveTab}
            onOpenNewMemberModal={() => {
              setMemberToEdit(null);
              setIsMemberModalOpen(true);
            }}
            onOpenImportModal={() => setIsImportModalOpen(true)}
          />
        )}

        {activeTab === 'members' && (
          <MemberManagement
            members={members}
            mode={appMode}
            onOpenNewMemberModal={() => {
              setMemberToEdit(null);
              setIsMemberModalOpen(true);
            }}
            onOpenEditMemberModal={handleOpenEditMember}
            onOpenRenewalModal={handleOpenRenewal}
            onArchiveMember={onArchiveMember}
          />
        )}

        {activeTab === 'subscriptions' && (
          <SubscriptionManagement
            members={members}
            onOpenRenewalModal={handleOpenRenewal}
          />
        )}

        {activeTab === 'reminders' && (
          <ReminderManagement
            jobs={jobs}
            onOpenPreviewModal={handleOpenPreview}
            onSimulateSend={onSimulateSend}
          />
        )}
      </main>

      {/* Dashboard Modals */}
      <MemberModal
        isOpen={isMemberModalOpen}
        onClose={() => setIsMemberModalOpen(false)}
        memberToEdit={memberToEdit}
        onSaveMember={(data) => {
          if (memberToEdit) {
            onEditMember({ ...data, id: memberToEdit.id });
          } else {
            onAddMember(data);
          }
        }}
      />

      <RenewalModal
        isOpen={isRenewalModalOpen}
        onClose={() => setIsRenewalModalOpen(false)}
        member={memberToRenew}
        mode={appMode}
        onConfirmRenewal={onRenewalConfirmed}
      />

      <PreviewMessageModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        job={jobToPreview}
        onSimulateSend={onSimulateSend}
      />

      <ImportExportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        members={members}
        onImportMembers={onImportMembers}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />

    </div>
  );
};
