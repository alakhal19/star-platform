'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import StarField from '@/components/StarField';

export default function DashboardLayout({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg mx-auto mb-3 animate-pulse" />
          <p className="text-gray-500 text-sm">Loading STAR...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen relative">
      <StarField />
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/5 w-96 h-96 bg-purple-900/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-blue-900/5 rounded-full blur-3xl" />
      </div>
      <Sidebar />
      <main className="flex-1 overflow-auto relative z-10">
        {children}
      </main>
    </div>
  );
}