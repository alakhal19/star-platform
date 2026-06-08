'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';

const statusConfig = {
  PENDING: { color: 'bg-gray-800 text-gray-400 border-gray-700', label: 'PENDING' },
  PENDING_APPROVAL: { color: 'bg-amber-950/50 text-amber-400 border-amber-800/30', label: 'AWAITING APPROVAL' },
  APPROVED: { color: 'bg-indigo-950/50 text-indigo-400 border-indigo-800/30', label: 'APPROVED' },
  SCHEDULED: { color: 'bg-amber-950/50 text-amber-400 border-amber-800/30', label: 'SCHEDULED' },
  DEPLOYING: { color: 'bg-blue-950/50 text-blue-400 border-blue-800/30', label: 'DEPLOYING' },
  DEPLOYED: { color: 'bg-green-950/50 text-green-400 border-green-800/30', label: 'LIVE' },
  FAILED: { color: 'bg-red-950/50 text-red-400 border-red-800/30', label: 'FAILED' },
  ROLLED_BACK: { color: 'bg-yellow-950/50 text-yellow-400 border-yellow-800/30', label: 'ROLLED BACK' },
};

export default function ReleaseDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState('');

  useEffect(() => {
    fetchRelease();
  }, [id]);

  const fetchRelease = async () => {
    try {
      const res = await api.get(`/releases/${id}`);
      setRelease(res.data.release);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    try {
      await api.post(`/releases/${id}/approve`, { comment: 'Approved via dashboard' });
      fetchRelease();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const handleReject = async () => {
    const comment = prompt('Reason for rejection:');
    if (!comment) return;
    try {
      await api.post(`/releases/${id}/reject`, { comment });
      fetchRelease();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const handleDeploy = async () => {
    if (!confirm('Deploy this release to production?')) return;
    try {
      await api.post(`/deployments/trigger/${id}`);
      fetchRelease();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const handleRiskAnalysis = async () => {
    setAiLoading('risk');
    try {
      await api.post(`/ai/risk/${id}`);
      fetchRelease();
    } catch (err) {
      alert(err.response?.data?.error || 'AI analysis failed — check API credits');
    } finally {
      setAiLoading('');
    }
  };

  const handleRollback = async () => {
    // find the most recent failed deployment for this release
    const failed = (release.deployments || []).find(d => d.status === 'FAILED');
    if (!failed) return alert('No failed deployment to rollback');
    if (!confirm('Roll back traffic to the previous environment?')) return;
    try {
      await api.post(`/deployments/${failed.id}/rollback`, { keepFailedResources: false });
      fetchRelease();
      alert('Rollback triggered');
    } catch (err) {
      alert(err.response?.data?.error || 'Rollback failed');
    }
  };

  const handleChangelog = async () => {
    setAiLoading('changelog');
    try {
      await api.post(`/ai/changelog/${id}`);
      fetchRelease();
    } catch (err) {
      alert(err.response?.data?.error || 'Changelog generation failed — check API credits');
    } finally {
      setAiLoading('');
    }
  };

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!release) return <div className="p-8 text-gray-500">Release not found</div>;

  const status = statusConfig[release.status] || statusConfig.PENDING;
  const files = Array.isArray(release.filesChanged) ? release.filesChanged : [];

  return (
    <div className="p-8 max-w-5xl">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-600 hover:text-gray-300 mb-5 flex items-center gap-1 transition-colors"
      >
        ← Back to releases
      </button>

      {/* Header */}
      <div className="bg-[#0f1423]/60 border border-gray-800/20 rounded-xl p-6 mb-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-semibold text-gray-100 font-mono">{release.version}</h1>
              <span className={`text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border ${status.color}`}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-gray-400">{release.message}</p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {release.status === 'PENDING_APPROVAL' && (
              <>
                <button onClick={handleApprove} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors">
                  Approve
                </button>
                <button onClick={handleReject} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">
                  Reject
                </button>
              </>
            )}
            {['APPROVED', 'PENDING', 'FAILED', 'ROLLED_BACK'].includes(release.status) && (
              <button onClick={handleDeploy} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors">
                Deploy now
              </button>
            )}
            {release.deployments && release.deployments.some(d => d.status === 'FAILED') && (
              <button onClick={handleRollback} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">
                Rollback
              </button>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-gray-800/20 rounded-lg p-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Commit</p>
            <p className="text-sm font-mono text-blue-400">{release.commit?.slice(0, 7)}</p>
          </div>
          <div className="bg-gray-800/20 rounded-lg p-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Author</p>
            <p className="text-sm text-gray-300">{release.author}</p>
          </div>
          <div className="bg-gray-800/20 rounded-lg p-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Changes</p>
            <p className="text-sm">
              <span className="text-green-400">+{release.additions}</span>
              <span className="text-gray-600 mx-1">/</span>
              <span className="text-red-400">-{release.deletions}</span>
            </p>
          </div>
          <div className="bg-gray-800/20 rounded-lg p-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Risk score</p>
            {release.riskScore ? (
              <p className={`text-sm font-mono font-semibold ${
                release.riskScore <= 3 ? 'text-green-400' :
                release.riskScore <= 6 ? 'text-amber-400' :
                'text-red-400'
              }`}>
                {release.riskScore}/10
              </p>
            ) : (
              <p className="text-sm text-gray-700">Not analyzed</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        {/* Files changed */}
        <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300">Files changed</h2>
            <span className="text-[10px] text-gray-600 font-mono">{files.length} files</span>
          </div>

          {files.length === 0 ? (
            <p className="text-xs text-gray-700 py-4 text-center font-mono">No file data available</p>
          ) : (
            <div className="space-y-0.5 max-h-64 overflow-y-auto">
              {files.map((file, i) => {
                const filename = typeof file === 'string' ? file : file.filename;
                const additions = typeof file === 'object' ? file.additions : 0;
                const deletions = typeof file === 'object' ? file.deletions : 0;
                return (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-800/10 font-mono text-[11px]">
                    <span className="text-gray-400 truncate mr-3">{filename}</span>
                    <span className="flex-shrink-0">
                      <span className="text-green-400">+{additions}</span>
                      <span className="text-gray-700 mx-1"> </span>
                      <span className="text-red-400">-{deletions}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI section */}
        <div className="space-y-5">
          {/* Risk analysis */}
          <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-300">AI risk analysis</h2>
              <button
                onClick={handleRiskAnalysis}
                disabled={aiLoading === 'risk'}
                className="text-[10px] font-medium px-2.5 py-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 disabled:opacity-50 transition-colors"
              >
                {aiLoading === 'risk' ? 'Analyzing...' : 'Analyze risk'}
              </button>
            </div>

            {release.riskAnalysis ? (
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                {release.riskAnalysis}
              </pre>
            ) : (
              <p className="text-xs text-gray-700 py-4 text-center">Click "Analyze risk" to get an AI assessment</p>
            )}
          </div>

          {/* Changelog */}
          <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-300">AI changelog</h2>
              <button
                onClick={handleChangelog}
                disabled={aiLoading === 'changelog'}
                className="text-[10px] font-medium px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
              >
                {aiLoading === 'changelog' ? 'Generating...' : 'Generate changelog'}
              </button>
            </div>

            {release.changelog ? (
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                {release.changelog}
              </pre>
            ) : (
              <p className="text-xs text-gray-700 py-4 text-center">Click "Generate changelog" to create a readable summary</p>
            )}
          </div>
        </div>
      </div>

      {/* Deployment history */}
      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Deployment history</h2>

        {(!release.deployments || release.deployments.length === 0) ? (
          <p className="text-xs text-gray-700 py-4 text-center font-mono">No deployments yet</p>
        ) : (
          <div className="space-y-2">
            {release.deployments.map((dep) => (
              <div key={dep.id} className="flex items-center justify-between py-2.5 px-4 bg-gray-800/10 rounded-lg">
                <div className="flex items-center gap-4">
                  <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${
                    dep.status === 'SUCCESS' ? 'bg-green-950/50 text-green-400' :
                    dep.status === 'FAILED' ? 'bg-red-950/50 text-red-400' :
                    dep.status === 'IN_PROGRESS' ? 'bg-blue-950/50 text-blue-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>
                    {dep.status}
                  </span>
                  <span className={`text-xs font-mono ${
                    dep.environment === 'BLUE' ? 'text-blue-400' : 'text-green-400'
                  }`}>
                    {dep.environment}
                  </span>
                  <span className="text-xs text-gray-500">
                    by {dep.triggeredBy}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  {dep.duration && (
                    <span className="text-[10px] font-mono text-gray-600">
                      {(dep.duration / 1000).toFixed(1)}s
                    </span>
                  )}
                  <span className="text-[10px] text-gray-600">
                    {new Date(dep.startedAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Approval history */}
      {release.approvals && release.approvals.length > 0 && (
        <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Approval history</h2>
          <div className="space-y-2">
            {release.approvals.map((approval) => (
              <div key={approval.id} className="flex items-center justify-between py-2 px-4 bg-gray-800/10 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${
                    approval.status === 'APPROVED' ? 'bg-green-950/50 text-green-400' :
                    'bg-red-950/50 text-red-400'
                  }`}>
                    {approval.status}
                  </span>
                  <span className="text-xs text-gray-400">by {approval.approvedBy}</span>
                  {approval.comment && (
                    <span className="text-xs text-gray-600">— "{approval.comment}"</span>
                  )}
                </div>
                <span className="text-[10px] text-gray-600">
                  {new Date(approval.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}