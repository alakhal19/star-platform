'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import api from '@/lib/api';
import StarField from '@/components/StarField';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { username, password });
      login(res.data.token, res.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative">
      <StarField />

      {/* Nebula glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-900/15 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-900/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-purple-600 to-blue-600 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold font-mono">S</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-widest">STAR</h1>
          <p className="text-gray-500 mt-1 text-sm tracking-wider">System for Tracking and Automating Releases</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900/80 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-8">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-950/50 border border-red-800/50 text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="amine"
                required
                className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-all"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <span className="text-xs text-gray-600">Secured by Keycloak SSO</span>
          </div>
        </div>

        <p className="text-center text-xs text-gray-700 mt-6 font-mono">
          STAR v1.0.0
        </p>
      </div>
    </div>
  );
}