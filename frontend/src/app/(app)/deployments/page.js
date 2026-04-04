'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDeployments();
  }, []);

  const fetchDeployments = async () => {
    try {
      const res = await api.get('/deployments');
      setDeployments(res.data.deployments);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-100">Deployments</h1>
        <p className="text-sm text-gray-500 mt-1">Complete deployment history</p>
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
            <div key={dep.id} className="grid grid-cols-[100px_90px_100px_100px_80px_1fr] px-5 py-3 border-b border-gray-800/10 items-center hover:bg-gray-800/5 transition-colors">
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
                  dep.status === 'SUCCESS' ? 'bg-green-950/50 text-green-400' :
                  dep.status === 'FAILED' ? 'bg-red-950/50 text-red-400' :
                  dep.status === 'IN_PROGRESS' ? 'bg-blue-950/50 text-blue-400' :
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