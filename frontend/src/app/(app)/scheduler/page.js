'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

export default function SchedulerPage() {
  const [scheduled, setScheduled] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchScheduled();
  }, []);

  const fetchScheduled = async () => {
    try {
      const res = await api.get('/scheduler');
      setScheduled(res.data.scheduled);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (releaseId) => {
    if (!confirm('Cancel this scheduled deployment?')) return;
    try {
      await api.delete(`/scheduler/cancel/${releaseId}`);
      fetchScheduled();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel');
    }
  };

  const getCountdown = (date) => {
    const diff = new Date(date) - new Date();
    if (diff <= 0) return 'Executing...';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `in ${hours}h ${minutes}m`;
  };

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-100">Scheduled deployments</h1>
        <p className="text-sm text-gray-500 mt-1">Upcoming deployments queued for a specific time</p>
      </div>

      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl overflow-hidden">
        {scheduled.length === 0 ? (
          <div className="text-center py-16 text-gray-600 text-sm">No scheduled deployments — schedule one from the release detail page</div>
        ) : (
          scheduled.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-5 py-4 border-b border-gray-800/10 hover:bg-gray-800/5 transition-colors">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono text-sm text-purple-400">{item.release?.version}</span>
                  <span className="text-xs text-gray-400">{item.release?.message}</span>
                </div>
                <p className="text-xs text-gray-600">
                  {item.release?.project?.name} — by {item.release?.author}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs text-gray-400">{new Date(item.scheduledFor).toLocaleString()}</p>
                  <p className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded mt-1 inline-block">
                    {getCountdown(item.scheduledFor)}
                  </p>
                </div>
                <button
                  onClick={() => handleCancel(item.releaseId)}
                  className="text-[10px] font-medium px-2.5 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}