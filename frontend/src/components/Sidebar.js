'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const navigation = [
  { name: 'Releases', href: '/dashboard', icon: '~' },
  { name: 'Deployments', href: '/deployments', icon: '>' },
  { name: 'Snapshots', href: '/snapshots', icon: '@' },
  { name: 'Scheduler', href: '/scheduler', icon: '*' },
  { name: 'AI Monitor', href: '/ai', icon: '%' },
  { name: 'Notifications', href: '/notifications', icon: '!' },
  { name: 'Settings', href: '/settings', icon: '$' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className="w-56 bg-[#0d111e]/95 border-r border-gray-800/30 min-h-screen flex flex-col relative z-10">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold font-mono">S</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-200 tracking-widest">STAR</div>
            <div className="text-[9px] text-gray-600 tracking-[3px] uppercase">Release platform</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/15'
                  : 'text-gray-500 hover:bg-gray-800/30 hover:text-gray-300'
              }`}
            >
              <span className="font-mono text-xs w-4 text-center">{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      {user && (
        <div className="px-4 py-4 border-t border-gray-800/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-900 to-purple-900 rounded-full flex items-center justify-center">
              <span className="text-purple-300 text-xs font-medium">
                {(user.username || user.name || 'U')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-300 truncate">
                {user.username || user.name || 'Admin'}
              </p>
              <p className="text-[10px] text-gray-600 truncate">
                {user.authMethod === 'keycloak' ? 'via Keycloak' : 'Admin'}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full text-left text-xs text-gray-600 hover:text-red-400 transition-colors px-1"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}