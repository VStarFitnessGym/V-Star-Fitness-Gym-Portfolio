// ============================================================================
// Reminder Management Component (Stage 5C)
// Provides live queue inspection, real telemetry, filtering, pagination, and atomic retry
// Preserves offline synthetic demo mode when running in demo environment
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Eye,
  Play,
  ShieldAlert,
  CheckCircle2,
  MessageSquare,
  AlertTriangle,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { NotificationJob, NotificationJobStatus, NotificationMilestone } from '../../types';
import { Badge } from '../shared/Badge';
import { apiClient } from '../../lib/api/client';
import { ApiReminderTelemetryResponse, ApiReminderJobStatus, ApiReminderMilestone } from '../../lib/api/types';
import { getInitialAppMode, getAppModeConfig } from '../../lib/config/mode';

interface ReminderManagementProps {
  jobs: NotificationJob[];
  onOpenPreviewModal: (job: NotificationJob) => void;
  onSimulateSend: (jobId: string) => void;
  isLiveMode?: boolean;
}

export const ReminderManagement: React.FC<ReminderManagementProps> = ({
  jobs: demoJobs,
  onOpenPreviewModal,
  onSimulateSend,
  isLiveMode: propIsLiveMode
}) => {
  const isLive = propIsLiveMode ?? getAppModeConfig(getInitialAppMode()).isLive;

  // Filter & Pagination States
  const [filterMilestone, setFilterMilestone] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Live Mode Data & Loading States
  const [liveJobs, setLiveJobs] = useState<NotificationJob[]>([]);
  const [telemetry, setTelemetry] = useState<ApiReminderTelemetryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Retry Interaction State
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Fetch live jobs and telemetry from backend
  const loadLiveData = useCallback(async () => {
    if (!isLive) return;
    setIsLoading(true);
    setError(null);

    try {
      const [jobsRes, telemetryRes] = await Promise.all([
        apiClient.getReminderJobs({
          page,
          limit: 15,
          status: filterStatus === 'all' ? undefined : (filterStatus as ApiReminderJobStatus),
          milestone: filterMilestone === 'all' ? undefined : (filterMilestone as ApiReminderMilestone),
          search: searchQuery.trim() || undefined
        }),
        apiClient.getReminderTelemetry()
      ]);

      setLiveJobs(
        jobsRes.data.map((j) => ({
          ...j,
          cancellation_reason: j.cancellation_reason || undefined,
          attempts: j.attempts?.map((a) => ({
            ...a,
            job_id: j.id,
            provider_message_id: a.provider_message_id || undefined,
            error_code: a.error_code || undefined,
            error_message: a.error_message || undefined,
            delivered_at: a.delivered_at || undefined,
            provider: a.provider as any,
            status: a.status as any
          }))
        }))
      );
      setTotalPages(jobsRes.pagination.total_pages || 1);
      setTotalCount(jobsRes.pagination.total || 0);
      setTelemetry(telemetryRes);
    } catch (err: any) {
      setError(err?.message || 'Failed to connect to reminder queue service.');
    } finally {
      setIsLoading(false);
    }
  }, [isLive, page, filterStatus, filterMilestone, searchQuery]);

  useEffect(() => {
    if (isLive) {
      loadLiveData();
    }
  }, [isLive, loadLiveData]);

  // Handle staff manual retry
  const handleRetryJob = async (job: NotificationJob) => {
    if (retryingJobId) return; // Prevent duplicate concurrent clicks
    setRetryingJobId(job.id);
    setFeedback(null);

    try {
      const res = await apiClient.retryReminderJob(job.id, {
        reason: 'Staff dashboard manual retry'
      });
      setFeedback({
        type: 'success',
        message: res.message || `Job ${job.id.slice(0, 8)}... successfully re-queued.`
      });
      // Refresh live queue
      await loadLiveData();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Manual retry failed. Please verify job state.'
      });
    } finally {
      setRetryingJobId(null);
    }
  };

  // Determine active jobs list based on mode
  const displayedJobs = isLive
    ? liveJobs
    : demoJobs.filter(
        (j) =>
          (filterMilestone === 'all' || j.milestone === filterMilestone) &&
          (filterStatus === 'all' || j.status === filterStatus)
      );

  const getStatusBadge = (status: NotificationJobStatus) => {
    switch (status) {
      case 'completed':
        return <Badge variant="green">COMPLETED (DELIVERED)</Badge>;
      case 'dispatching':
        return <Badge variant="blue">DISPATCHING (INTENT LOCKED)</Badge>;
      case 'reconciling':
        return <Badge variant="yellow">RECONCILING (AWAITING HOOK)</Badge>;
      case 'claimed':
        return <Badge variant="purple">CLAIMED (LEASED 5M)</Badge>;
      case 'pending':
        return <Badge variant="gray">PENDING</Badge>;
      case 'cancelled':
        return <Badge variant="gray">CANCELLED (RENEWED)</Badge>;
      case 'skipped':
        return <Badge variant="gray">SKIPPED (STALE/OPT-OUT)</Badge>;
      case 'failed':
        return <Badge variant="red">TERMINAL FAILED</Badge>;
      default:
        return <Badge variant="gray">{status}</Badge>;
    }
  };

  const getMilestoneLabel = (milestone: string) => {
    switch (milestone) {
      case 'EXPIRY_MINUS_3':
        return '3 Days Before Expiry';
      case 'EXPIRY_ZERO':
        return 'On Expiry Day';
      case 'EXPIRY_PLUS_3':
        return '3 Days After Expiry';
      case 'MANUAL_TRIGGER':
        return 'On-Demand Staff Trigger';
      default:
        return milestone;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Mode Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Automated Reminder Queue & Delivery Telemetry
            </h2>
            <span
              className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${
                isLive
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {isLive ? 'LIVE BACKEND MODE' : 'OFFLINE DEMO MODE'}
            </span>
          </div>
          <p className="text-zinc-400 text-xs mt-1">
            Two-Phase Dispatch Intent Engine with Meta WhatsApp Cloud API and Indian DLT SMS Fallback.
          </p>
        </div>

        {isLive && (
          <button
            onClick={() => loadLiveData()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-lg border border-zinc-700 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Queue</span>
          </button>
        )}
      </div>

      {/* Live Telemetry Summary Cards (Stage 5C) */}
      {isLive && telemetry && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Scheduled Today</div>
            <div className="text-xl font-bold text-white mt-1">{telemetry.scheduledToday}</div>
          </div>
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Completed Today</div>
            <div className="text-xl font-bold text-emerald-400 mt-1">{telemetry.completedToday}</div>
          </div>
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Reconciling</div>
            <div className="text-xl font-bold text-yellow-400 mt-1">{telemetry.reconciling}</div>
          </div>
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Terminal Failed</div>
            <div className="text-xl font-bold text-red-400 mt-1">{telemetry.failed}</div>
          </div>
        </div>
      )}

      {/* Two-Phase Dispatch Protocol Callout */}
      <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gym-yellow">
          <ShieldAlert className="w-4 h-4" />
          <span>Stage 5C Reliability & Safety Invariants:</span>
        </div>
        <p className="text-zinc-400 text-xs leading-relaxed">
          <strong>1. Zero Blind Resends:</strong> Ambiguous outcomes (<code className="text-zinc-200">reconciling</code>) cannot be retried directly; they must resolve via reconciliation.<br />
          <strong>2. Manual Retry Gate:</strong> Only confirmed <code className="text-zinc-200">failed</code> jobs are eligible for retry. Retrying re-validates current active subscription and DPDP consent.
        </p>
      </div>

      {/* Operational Feedback Alert */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-zinc-400 hover:text-white text-xs font-bold px-2 py-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Milestone Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-1">
          {[
            { id: 'all', label: 'All Milestones' },
            { id: 'EXPIRY_MINUS_3', label: '3 Days Before Expiry' },
            { id: 'EXPIRY_ZERO', label: 'On Expiry Day' },
            { id: 'EXPIRY_PLUS_3', label: '3 Days After Expiry' },
            { id: 'MANUAL_TRIGGER', label: 'Manual Triggers' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setFilterMilestone(tab.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider text-[11px] transition-colors cursor-pointer shrink-0 ${
                filterMilestone === tab.id
                  ? 'bg-gym-yellow text-black'
                  : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        {isLive && (
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search member name or phone..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-gym-yellow"
            />
          </div>
        )}
      </div>

      {/* Main Jobs Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3.5 px-4">Milestone</th>
                <th className="py-3.5 px-4">Target Member</th>
                <th className="py-3.5 px-4">Channel & Attempts</th>
                <th className="py-3.5 px-4">Target Date</th>
                <th className="py-3.5 px-4">Queue State</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-400">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gym-yellow" />
                      <span>Loading reminder queue from server...</span>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-red-400">
                    <div className="space-y-2">
                      <p>{error}</p>
                      <button
                        onClick={() => loadLiveData()}
                        className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded border border-zinc-700 cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  </td>
                </tr>
              ) : displayedJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-500">
                    No reminder jobs found in this view.
                  </td>
                </tr>
              ) : (
                displayedJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-zinc-800/40 transition-colors">
                    {/* Milestone */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white text-xs">{getMilestoneLabel(job.milestone)}</div>
                      <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{job.id.slice(0, 8)}...</div>
                    </td>

                    {/* Member */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white text-xs">{job.member_name}</div>
                      <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{job.member_phone}</div>
                    </td>

                    {/* Channel */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase px-2 py-0.5 rounded border ${
                            job.channel === 'whatsapp'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                          }`}
                        >
                          <MessageSquare className="w-3 h-3" />
                          {job.channel}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {job.attempt_count}/{job.max_attempts}
                        </span>
                      </div>
                    </td>

                    {/* Target Date */}
                    <td className="py-3.5 px-4 font-mono font-semibold text-zinc-200">{job.target_date}</td>

                    {/* State Badge */}
                    <td className="py-3.5 px-4">
                      {getStatusBadge(job.status)}
                      {job.cancellation_reason && (
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5 max-w-[140px] truncate" title={job.cancellation_reason}>
                          {job.cancellation_reason}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onOpenPreviewModal(job)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 rounded transition-colors cursor-pointer border border-zinc-700"
                        >
                          <Eye className="w-3.5 h-3.5" /> Preview
                        </button>

                        {/* Live Mode: Safe Manual Retry for Failed Jobs */}
                        {isLive && job.status === 'failed' && (
                          <button
                            onClick={() => handleRetryJob(job)}
                            disabled={retryingJobId === job.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 rounded transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {retryingJobId === job.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            Retry
                          </button>
                        )}

                        {/* Demo Mode: Simulation Action */}
                        {!isLive && job.status !== 'completed' && (
                          <button
                            onClick={() => onSimulateSend(job.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-gym-yellow text-black hover:bg-gym-yellowHover rounded transition-colors cursor-pointer shadow-sm"
                          >
                            <Play className="w-3.5 h-3.5 fill-black" /> Dispatch
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

        {/* Footer with Pagination */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[11px] text-zinc-400 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            {isLive ? `${totalCount} total jobs in system` : `${displayedJobs.length} jobs in queue view`}
          </span>

          {isLive && totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1 || isLoading}
                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages || isLoading}
                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <span className="hidden sm:inline">Zero duplicate dispatches across network timeouts</span>
        </div>
      </div>
    </div>
  );
};
