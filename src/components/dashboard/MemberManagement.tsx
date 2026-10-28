import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plus, Edit2, Archive, RefreshCw, AlertCircle, ShieldAlert } from 'lucide-react';
import { Member, MemberStatus } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { apiClient } from '../../lib/api/client';
import { ApiClientError } from '../../lib/api/errors';
import { ApiMemberListItem, ApiPagination } from '../../lib/api/types';

interface MemberManagementProps {
  members: Member[];
  mode?: 'demo' | 'live';
  onOpenNewMemberModal: () => void;
  onOpenEditMemberModal: (member: Member) => void;
  onOpenRenewalModal: (member: Member) => void;
  onArchiveMember: (memberId: string) => void;
}

export const MemberManagement: React.FC<MemberManagementProps> = ({
  members: demoMembers,
  mode = 'demo',
  onOpenNewMemberModal,
  onOpenEditMemberModal,
  onOpenRenewalModal,
  onArchiveMember
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MemberStatus>('all');
  
  // Live mode state
  const [liveMembers, setLiveMembers] = useState<Member[]>([]);
  const [pagination, setPagination] = useState<ApiPagination>({ total: 0, page: 1, limit: 10, total_pages: 1 });
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isLoadingLive, setIsLoadingLive] = useState<boolean>(false);
  const [liveError, setLiveError] = useState<ApiClientError | null>(null);

  // In-flight request counter to prevent out-of-order race conditions and mode leakages
  const requestCounterRef = useRef<number>(0);
  const activeModeRef = useRef<'demo' | 'live'>(mode);

  useEffect(() => {
    activeModeRef.current = mode;
    // When switching modes, cancel loading states and reset errors
    if (mode === 'demo') {
      setIsLoadingLive(false);
      setLiveError(null);
    }
  }, [mode]);

  // Function to load members in live mode
  const fetchLiveMembers = useCallback(async (page: number, search: string, status: 'all' | MemberStatus) => {
    if (mode !== 'live') return;

    const thisRequestId = ++requestCounterRef.current;
    setIsLoadingLive(true);
    setLiveError(null);

    try {
      const response = await apiClient.getMembers({
        page,
        limit: 10,
        search: search.trim() || undefined,
        status: status === 'all' ? undefined : status,
        sort_by: 'created_at',
        sort_order: 'desc'
      });

      // Discard response if mode changed to demo or a newer request was dispatched
      if (activeModeRef.current !== 'live' || thisRequestId !== requestCounterRef.current) {
        return;
      }

      // Map backend ApiMemberListItem to frontend Member structure
      const mapped: Member[] = response.data.map((item: ApiMemberListItem) => ({
        id: item.id,
        member_code: item.member_code,
        full_name: item.full_name,
        phone: item.phone,
        email: item.email,
        status: item.status,
        whatsapp_consent: item.whatsapp_consent,
        whatsapp_consent_at: item.created_at,
        sms_consent: item.sms_consent,
        sms_consent_at: item.created_at,
        created_at: item.created_at,
        current_subscription: item.current_subscription
          ? {
              id: item.current_subscription.id,
              member_id: item.id,
              plan_id: '',
              plan_name: item.current_subscription.plan_name,
              start_date: item.current_subscription.start_date,
              end_date: item.current_subscription.end_date,
              status: item.current_subscription.status as any,
              amount_paid: 0,
              payment_method: 'upi',
              version: 1,
              created_at: item.created_at
            }
          : undefined
      }));

      setLiveMembers(mapped);
      setPagination(response.pagination);
      setIsLoadingLive(false);
    } catch (err: any) {
      // Discard error if mode switched to demo or newer request dispatched
      if (activeModeRef.current !== 'live' || thisRequestId !== requestCounterRef.current) {
        return;
      }

      setIsLoadingLive(false);
      // Strict safety boundary: NEVER silently substitute mock data on live failure!
      if (err instanceof ApiClientError) {
        setLiveError(err);
      } else {
        setLiveError(
          new ApiClientError({
            message: err?.message || 'Unable to fetch members from backend API.',
            status: 0,
            isNetworkError: true
          })
        );
      }
    }
  }, [mode]);

  // Trigger fetch when parameters change in live mode
  useEffect(() => {
    if (mode === 'live') {
      const debounceTimer = setTimeout(() => {
        fetchLiveMembers(currentPage, searchTerm, statusFilter);
      }, 300);
      return () => clearTimeout(debounceTimer);
    }
  }, [mode, currentPage, searchTerm, statusFilter, fetchLiveMembers]);

  // Determine active dataset based on mode
  const displayedMembers = mode === 'live'
    ? liveMembers
    : demoMembers.filter((m) => {
        const matchesSearch =
          m.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.phone.includes(searchTerm) ||
          m.member_code.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
        return matchesSearch && matchesStatus;
      });

  const getStatusBadgeVariant = (status: MemberStatus) => {
    switch (status) {
      case 'active': return 'green';
      case 'expiring': return 'yellow';
      case 'expired': return 'red';
      case 'archived': return 'gray';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Member Directory & Subscription Ledger
            </h2>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                mode === 'live'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-gym-yellow/10 text-gym-yellow border-gym-yellow/30'
              }`}
            >
              {mode === 'live' ? 'Live API Mode' : 'Demo Mode'}
            </span>
          </div>
          <p className="text-zinc-400 text-xs mt-0.5">
            {mode === 'live'
              ? 'Displaying real-time member records securely partitioned by tenant gym.'
              : 'Managing simulated customer records and continuous subscription renewals.'}
          </p>
        </div>
        <div>
          <Button variant="yellow" size="sm" onClick={onOpenNewMemberModal}>
            <Plus className="w-4 h-4" /> Enroll New Member
          </Button>
        </div>
      </div>

      {/* Live Mode Error Alert */}
      {mode === 'live' && liveError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl space-y-2 text-rose-300">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-white">Live Query Failed ({liveError.code})</div>
                <div className="text-xs text-rose-200 mt-1">{liveError.getUserMessage()}</div>
                {liveError.status === 401 && (
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Tip: Switch to <strong>Demo Mode</strong> in the top header bar to explore features with simulated data offline.
                  </p>
                )}
                {liveError.requestId && (
                  <div className="text-[10px] font-mono text-zinc-500 mt-1">Request ID: {liveError.requestId}</div>
                )}
              </div>
            </div>
            <Button
              variant="dark"
              size="sm"
              onClick={() => fetchLiveMembers(currentPage, searchTerm, statusFilter)}
              className="shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </Button>
          </div>
        </div>
      )}

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/90 border border-zinc-800 p-3 rounded-xl">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by legal name, mobile number (+91), or member code..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-gym-yellow"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
          {(['all', 'active', 'expiring', 'expired', 'archived'] as const).map((status) => (
            <button
              key={status}
              onClick={() => {
                setStatusFilter(status);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider text-[11px] transition-colors cursor-pointer ${
                statusFilter === status
                  ? 'bg-gym-yellow text-black shadow-sm'
                  : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">Mobile & Consent</th>
                <th className="py-3.5 px-4">Current Subscription</th>
                <th className="py-3.5 px-4">Expiry Date</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {isLoadingLive ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-400" aria-live="polite">
                    <RefreshCw className="w-6 h-6 animate-spin text-gym-yellow mx-auto mb-2" />
                    <p className="text-sm font-semibold">Loading members from backend API...</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Executing tenant-isolated query on /api/members</p>
                  </td>
                </tr>
              ) : displayedMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-500">
                    <p className="text-sm font-semibold">No members match your criteria</p>
                    <p className="text-xs mt-1">Try refining your search terms or clearing status filters.</p>
                  </td>
                </tr>
              ) : (
                displayedMembers.map((member) => (
                  <tr
                    key={member.id}
                    className="hover:bg-zinc-800/40 transition-colors"
                  >
                    {/* Member Info */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white text-xs">{member.full_name}</div>
                      <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{member.member_code}</div>
                    </td>

                    {/* Phone & Regulatory Opt-ins */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-white text-xs">{member.phone}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          title={member.whatsapp_consent ? 'WhatsApp Reminders Consented' : 'WhatsApp Opted Out'}
                          className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.2 rounded border ${
                            member.whatsapp_consent
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                          }`}
                        >
                          WA: {member.whatsapp_consent ? '✓' : '✗'}
                        </span>
                        <span
                          title={member.sms_consent ? 'SMS Fallback Consented' : 'SMS Opted Out'}
                          className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.2 rounded border ${
                            member.sms_consent
                              ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                          }`}
                        >
                          SMS: {member.sms_consent ? '✓' : '✗'}
                        </span>
                      </div>
                    </td>

                    {/* Plan */}
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-zinc-200">
                        {member.current_subscription?.plan_name || 'No active plan'}
                      </span>
                      {member.current_subscription && member.current_subscription.amount_paid > 0 && (
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          Paid ₹{member.current_subscription.amount_paid.toLocaleString('en-IN')}
                        </div>
                      )}
                    </td>

                    {/* Expiry Date */}
                    <td className="py-3.5 px-4">
                      <span className={`font-bold font-mono ${
                        member.status === 'expiring' ? 'text-gym-yellow' :
                        member.status === 'expired' ? 'text-rose-400' : 'text-zinc-200'
                      }`}>
                        {member.current_subscription?.end_date || 'N/A'}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4">
                      <Badge variant={getStatusBadgeVariant(member.status)}>
                        {member.status.toUpperCase()}
                      </Badge>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onOpenRenewalModal(member)}
                          className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-gym-yellow text-black rounded hover:bg-gym-yellowHover transition-colors cursor-pointer"
                          title="Renew membership subscription"
                        >
                          Renew
                        </button>
                        <button
                          onClick={() => onOpenEditMemberModal(member)}
                          className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
                          title="Edit member details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {member.status !== 'archived' && (
                          <button
                            onClick={() => onArchiveMember(member.id)}
                            className="p-1.5 text-zinc-500 hover:text-rose-400 rounded hover:bg-zinc-800 transition-colors"
                            title="Soft-archive member"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary Bar & Pagination */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[11px] text-zinc-400 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            {mode === 'live' ? (
              <span>Showing {displayedMembers.length} of {pagination.total} live members (Page {pagination.page} of {pagination.total_pages})</span>
            ) : (
              <span>Showing {displayedMembers.length} of {demoMembers.length} demo members</span>
            )}
          </div>

          {mode === 'live' && pagination.total_pages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || isLoadingLive}
                className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Previous
              </button>
              <span>{pagination.page} / {pagination.total_pages}</span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(pagination.total_pages, p + 1))}
                disabled={currentPage >= pagination.total_pages || isLoadingLive}
                className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Next
              </button>
            </div>
          )}

          <div className="text-[10px] text-zinc-500">
            Tenant isolation enforced on /api/members
          </div>
        </div>
      </div>

    </div>
  );
};
