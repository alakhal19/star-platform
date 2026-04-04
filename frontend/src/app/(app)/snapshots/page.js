'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/snapshots').then((res) => {
      setSnapshots(res.data.snapshots);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-100">Snapshots</h1>
        <p className="text-sm text-gray-500 mt-1">Docker image snapshots taken before each deployment</p>
      </div>

      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl overflow-hidden">
        {snapshots.length === 0 ? (
          <div className="text-center py-16 text-gray-600 text-sm">No snapshots yet — they are created automatically before each deployment</div>
        ) : (
          snapshots.map((snap) => (
            <div key={snap.id} className="px-5 py-4 border-b border-gray-800/10 hover:bg-gray-800/5 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-purple-400">{snap.release?.version}</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                    snap.environment === 'BLUE'
                      ? 'bg-blue-950/50 text-blue-400 border border-blue-800/30'
                      : 'bg-green-950/50 text-green-400 border border-green-800/30'
                  }`}>
                    {snap.environment}
                  </span>
                </div>
                <span className="text-xs text-gray-600">{new Date(snap.createdAt).toLocaleString()}</span>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-mono text-gray-500">{snap.backendTag}</p>
                <p className="text-[11px] font-mono text-gray-500">{snap.frontendTag}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}