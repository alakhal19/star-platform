'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Link from 'next/link';

const statusConfig = {
  PENDING: { color: 'bg-gray-800 text-gray-400 border-gray-700', dot: 'bg-gray-500' },
  PENDING_APPROVAL: { color: 'bg-amber-950/50 text-amber-400 border-amber-800/30', dot: 'bg-amber-400 animate-[pulse-dot_2s_infinite]' },
  APPROVED: { color: 'bg-indigo-950/50 text-indigo-400 border-indigo-800/30', dot: 'bg-indigo-400' },
  SCHEDULED: { color: 'bg-amber-950/50 text-amber-400 border-amber-800/30', dot: 'bg-amber-400 animate-[pulse-dot_2s_infinite]' },
  DEPLOYING: { color: 'bg-blue-950/50 text-blue-400 border-blue-800/30', dot: 'bg-blue-400 animate-[pulse-dot_1s_infinite]' },
  DEPLOYED: { color: 'bg-green-950/50 text-green-400 border-green-800/30', dot: 'bg-green-400' },
  FAILED: { color: 'bg-red-950/50 text-red-400 border-red-800/30', dot: 'bg-red-400' },
  ROLLED_BACK: { color: 'bg-yellow-950/50 text-yellow-400 border-yellow-800/30', dot: 'bg-yellow-400' },
};

export default function DashboardPage() {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledRelease, setScheduledRelease] = useState(null);
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [scheduleReason, setScheduleReason] = useState('');

  useEffect(() => {
    fetchReleases();
    const interval = setInterval(fetchReleases, 15000);
    return () => clearInterval(interval);
  }, []);

  // Connect to SSE live feed
  useEffect(() => {
    const eventSource = new EventSource('/api/deployments/stream');

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'heartbeat') return;

        setEvents((prev) => [data, ...prev].slice(0, 20));

        // Refresh releases when a deployment completes
        if (data.type === 'complete' || data.type === 'error') {
          setTimeout(fetchReleases, 1000);
        }
      } catch (err) {
        // ignore parse errors
      }
    };

    return () => eventSource.close();
  }, []);

  const fetchReleases = async () => {
    try {
      const res = await api.get('/releases');
      setReleases(res.data.releases);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeploy = async (releaseId) => {
    if (!confirm('Deploy this release?')) return;
    try {
      await api.post(`/deployments/trigger/${releaseId}`);
      fetchReleases();
    } catch (err) {
      alert(err.response?.data?.error || 'Deployment failed');
    }
  };

  const handleApprove = async (releaseId) => {
    try {
      await api.post(`/releases/${releaseId}/approve`, { comment: 'Approved via dashboard' });
      fetchReleases();
    } catch (err) {
      alert(err.response?.data?.error || 'Approval failed');
    }
  };

  const openSchedule = (release) => {
    setScheduledRelease(release);
    // Pre-fill with 1 hour in future
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n) => n.toString().padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setScheduledLocal(local);
    setScheduleReason('');
    setShowScheduleModal(true);
  };

  const handleScheduleSubmit = async () => {
    if (!scheduledLocal) return alert('Select date and time');
    const iso = new Date(scheduledLocal).toISOString();
    try {
      await api.post(`/releases/${scheduledRelease.id}/schedule`, { scheduledFor: iso, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, reason: scheduleReason });
      setShowScheduleModal(false);
      fetchReleases();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to schedule');
    }
  };

  const handleCancelSchedule = async (releaseId) => {
    if (!confirm('Cancel scheduled deployment?')) return;
    try {
      await api.post(`/releases/${releaseId}/schedule/cancel`);
      fetchReleases();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel schedule');
    }
  };

  const deployedCount = releases.filter((r) => r.status === 'DEPLOYED').length;
  const failedCount = releases.filter((r) => r.status === 'FAILED').length;
  const scheduledCount = releases.filter((r) => r.status === 'SCHEDULED').length;

  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  if (loading) return <div className="p-8 text-gray-500">Loading releases...</div>;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-100">Releases</h1>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-gray-500">Production deployment control</span>
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 tracking-wider">
            PRODUCTION
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/15 tracking-wider">
            ERP Platform
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-7">
        <div className="bg-[#0f1423]/60 border border-gray-800/20 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-purple-500 to-transparent" />
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Total releases</p>
          <p className="text-2xl font-semibold text-gray-100 font-mono">{releases.length}</p>
        </div>
        <div className="bg-[#0f1423]/60 border border-gray-800/20 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-green-500 to-transparent" />
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Deployed</p>
          <p className="text-2xl font-semibold text-green-400 font-mono">{deployedCount}</p>
        </div>
        <div className="bg-[#0f1423]/60 border border-gray-800/20 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-red-500 to-transparent" />
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Failed</p>
          <p className="text-2xl font-semibold text-red-400 font-mono">{failedCount}</p>
        </div>
        <div className="bg-[#0f1423]/60 border border-gray-800/20 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-500 to-transparent" />
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Scheduled</p>
          <p className="text-2xl font-semibold text-amber-400 font-mono">{scheduledCount}</p>
        </div>
      </div>

      {/* Releases table */}
      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl overflow-hidden mb-7">
        <div className="grid grid-cols-[130px_1fr_90px_110px_80px_140px] px-5 py-2.5 border-b border-gray-800/15 text-[10px] text-gray-600 uppercase tracking-widest">
          <div>Version</div>
          <div>Commit</div>
          <div>Author</div>
          <div>Status</div>
          <div>Time</div>
          <div>Actions</div>
        </div>

        {releases.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <p className="text-sm mb-1">No releases yet</p>
            <p className="text-xs">Push code to trigger the CI/CD pipeline</p>
          </div>
        ) : (
          releases.map((release) => {
            const status = statusConfig[release.status] || statusConfig.PENDING;
            const lastDeployment = release.deployments?.[0];
            return (
              <div
                key={release.id}
                className="grid grid-cols-[130px_1fr_90px_110px_80px_140px] px-5 py-3.5 border-b border-gray-800/10 items-center hover:bg-gray-800/5 transition-colors"
              >
                <div className="font-mono text-sm text-purple-400 font-medium">
                  {release.version}
                </div>
                <div>
                  <p className="text-xs text-gray-400 truncate">{release.message}</p>
                  <p className="text-[10px] font-mono text-gray-700 mt-0.5">{release.commit?.slice(0, 7)}</p>
                </div>
                <div className="text-xs text-gray-500">{release.author?.split(' ')[0]}</div>
                <div>
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-medium px-2.5 py-1 rounded-full border ${status.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                    {release.status === 'DEPLOYED' ? 'LIVE' : release.status.replace('_', ' ')}
                  </span>
                  {release.status === 'SCHEDULED' && release.scheduledDeploy && (
                    <div className="text-[10px] text-amber-300 mt-1">Scheduled: {new Date(release.scheduledDeploy.scheduledFor).toLocaleString()}</div>
                  )}
                </div>
                <div className="text-[11px] text-gray-600">{timeAgo(release.createdAt)}</div>
                <div className="flex items-center gap-2">
                  {release.status === 'PENDING_APPROVAL' && (
                    <button
                      onClick={() => handleApprove(release.id)}
                      className="text-[10px] font-medium px-2.5 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                    >
                      Approve
                    </button>
                  )}
                  {['APPROVED', 'PENDING', 'FAILED', 'ROLLED_BACK'].includes(release.status) && (
                    <button
                      onClick={() => handleDeploy(release.id)}
                      className="text-[10px] font-medium px-2.5 py-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
                    >
                      Deploy
                    </button>
                  )}
                  {['APPROVED', 'PENDING', 'FAILED', 'ROLLED_BACK'].includes(release.status) && (
                    <button
                      onClick={() => openSchedule(release)}
                      className="text-[10px] font-medium px-2.5 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                    >
                      Schedule
                    </button>
                  )}
                  {release.status === 'SCHEDULED' && release.scheduledDeploy && (
                    <button
                      onClick={() => handleCancelSchedule(release.id)}
                      className="text-[10px] font-medium px-2.5 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <Link
                    href={`/dashboard/${release.id}`}
                    className="text-[10px] font-medium px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                  >
                    Details
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Schedule modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#0f1423] rounded-xl p-6 w-[420px] border border-gray-800/20">
            <h3 className="text-sm font-semibold text-gray-100 mb-3">Schedule deployment for {scheduledRelease?.version}</h3>
            <div className="mb-3">
              <label className="text-[11px] text-gray-400">Date & time</label>
              <input type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} className="w-full mt-1 p-2 rounded bg-gray-900 text-gray-100" />
            </div>
            <div className="mb-4">
              <label className="text-[11px] text-gray-400">Reason (optional)</label>
              <input value={scheduleReason} onChange={(e) => setScheduleReason(e.target.value)} className="w-full mt-1 p-2 rounded bg-gray-900 text-gray-100" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowScheduleModal(false)} className="text-xs px-3 py-1 rounded bg-gray-800 text-gray-300">Cancel</button>
              <button onClick={handleScheduleSubmit} className="text-xs px-3 py-1 rounded bg-amber-500 text-amber-900">Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* Live feed */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Live deployment feed</h2>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-[pulse-dot_2s_infinite]" />
          <span className="text-[10px] text-green-400 font-mono">STREAMING</span>
        </div>
      </div>

      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-4">
        {events.length === 0 ? (
          <p className="text-xs text-gray-700 font-mono text-center py-4">Waiting for deployment events...</p>
        ) : (
          events.map((event, i) => (
            <div key={i} className="flex items-start gap-3 py-1.5 font-mono text-xs">
              <span className="text-gray-700 min-w-[55px]">
                {event.timestamp ? new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '--:--:--'}
              </span>
              <span className={`min-w-[12px] text-center ${
                event.type === 'complete' ? 'text-green-400' :
                event.type === 'error' ? 'text-red-400' :
                'text-purple-400'
              }`}>
                {event.type === 'complete' ? '+' : event.type === 'error' ? '!' : '>'}
              </span>
              <span className="text-gray-400">
                {event.message}
                {event.percent && (
                  <span className="text-gray-700 ml-2">[{event.percent}%]</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}