'use client';
import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveStatus, setLiveStatus] = useState('connecting'); // 'connecting' | 'connected' | 'error'
  const esRef = useRef(null);

  // ── Initial fetch ────────────────────────────────────────────────────────────
  const fetchDeployments = async () => {
    try {
      const res = await api.get('/deployments');
      setDeployments(res.data.deployments);
    } catch (err) {
      console.error('Failed to fetch deployments', err);
    } finally {
      setLoading(false);
    }
  };

  // ── SSE live feed ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchDeployments();

    // EventSource connects to the backend SSE endpoint (no auth needed — route is public)
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
    const es = new EventSource(`${backendUrl}/api/deployments/stream`);
    esRef.current = es;

    es.onopen = () => {
      setLiveStatus('connected');
    };

    es.onmessage = (e) => {
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }

      if (event.type === 'connected' || event.type === 'heartbeat') return;

      // A real deployment event arrived — update the list in-place or prepend
      setDeployments((prev) => {
        const idx = prev.findIndex((d) => d.id === event.deploymentId);
        if (idx !== -1) {
          // Update existing row (status change, duration, etc.)
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...event };
          return updated;
        }
        // New deployment — re-fetch to get the full record with relations
        fetchDeployments();
        return prev;
      });
    };

    es.onerror = () => {
      setLiveStatus('error');
      // EventSource auto-reconnects — we just reflect the state
    };

    return () => {
      es.close();
    };
  }, []);

  // ── Status dot ───────────────────────────────────────────────────────────────
  const LiveDot = () => {
    const styles = {
      connected: 'bg-green-500 shadow-[0_0_6px_2px_rgba(34,197,94,0.4)]',
      connecting: 'bg-yellow-500 animate-pulse',
      error:      'bg-red-500',
    };
    const labels = {
      connected:  'Live',
      connecting: 'Connecting…',
      error:      'Disconnected',
    };
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${styles[liveStatus]}`} />
        {labels[liveStatus]}
      </span>
    );
  };

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-7 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Deployments</h1>
          <p className="text-sm text-gray-500 mt-1">Complete deployment history</p>
        </div>
        <LiveDot />
      </div>

      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[100px_90px_100px_100px_80px_1fr] px-5 py-2.5 border-b border-gray-800/15 text-[10px] text-gray-600 uppercase tracking-widest">
          <div>Version</div>
          <div>Env</div>
          <div>Status</div>
          <div>Duration</div>
          <div>By</div>
          <div>Time</div>
        </div>

        {deployments.length === 0 ? (
          <div className="text-center py-16 text-gray-600 text-sm">No deployments yet</div>
        ) : (
          deployments.map((dep) => (
            <div
              key={dep.id}
              className="grid grid-cols-[100px_90px_100px_100px_80px_1fr] px-5 py-3 border-b border-gray-800/10 items-center hover:bg-gray-800/5 transition-colors"
            >
              <div className="font-mono text-sm text-purple-400">{dep.release?.version}</div>
              <div>
                <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded ${
                  dep.environment === 'BLUE'
                    ? 'bg-blue-950/50 text-blue-400 border border-blue-800/30'
                    : 'bg-green-950/50 text-green-400 border border-green-800/30'
                }`}>
                  {dep.environment}
                </span>
              </div>
              <div>
                <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
                  dep.status === 'SUCCESS'     ? 'bg-green-950/50 text-green-400' :
                  dep.status === 'FAILED'      ? 'bg-red-950/50 text-red-400' :
                  dep.status === 'IN_PROGRESS' ? 'bg-blue-950/50 text-blue-400 animate-pulse' :
                  'bg-gray-800 text-gray-400'
                }`}>
                  {dep.status}
                </span>
              </div>
              <div className="text-xs font-mono text-gray-500">
                {dep.duration ? (dep.duration / 1000).toFixed(1) + 's' : '—'}
              </div>
              <div className="text-xs text-gray-500">{dep.triggeredBy}</div>
              <div className="text-xs text-gray-600">
                {new Date(dep.startedAt).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}