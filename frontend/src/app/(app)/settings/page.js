'use client';

import { useAuth } from '@/lib/auth-context';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-100">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Platform configuration</p>
      </div>

      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-6 mb-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Current user</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Username</span>
            <span className="text-sm text-gray-300 font-mono">{user?.username || user?.name || 'admin'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Auth method</span>
            <span className="text-sm text-gray-300 font-mono">{user?.authMethod || 'local'}</span>
          </div>
          {user?.email && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Email</span>
              <span className="text-sm text-gray-300 font-mono">{user.email}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Platform info</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Version</span>
            <span className="text-sm text-gray-300 font-mono">1.0.0</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Backend</span>
            <span className="text-sm text-gray-300 font-mono">Node.js + Express + Prisma</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Queue</span>
            <span className="text-sm text-gray-300 font-mono">Redis + BullMQ</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Auth</span>
            <span className="text-sm text-gray-300 font-mono">Keycloak SSO</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">AI</span>
            <span className="text-sm text-gray-300 font-mono">Anthropic Claude</span>
          </div>
        </div>
      </div>
    </div>
  );
}