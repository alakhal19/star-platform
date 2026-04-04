'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications').then((res) => {
      setNotifications(res.data.notifications);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const typeIcons = {
    DEPLOYMENT_SUCCESS: { icon: '+', color: 'text-green-400' },
    DEPLOYMENT_FAILED: { icon: '!', color: 'text-red-400' },
    APPROVAL_REQUIRED: { icon: '?', color: 'text-amber-400' },
    SCHEDULED_REMINDER: { icon: '*', color: 'text-blue-400' },
    ROLLBACK_COMPLETED: { icon: '<', color: 'text-yellow-400' },
    HEALTH_CHECK_FAILED: { icon: '!', color: 'text-red-400' },
  };

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-100">Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">Email notification history</p>
      </div>

      <div className="bg-[#0f1423]/50 border border-gray-800/20 rounded-xl overflow-hidden">
        {notifications.length === 0 ? (
          <div className="text-center py-16 text-gray-600 text-sm">No notifications sent yet</div>
        ) : (
          notifications.map((notif) => {
            const config = typeIcons[notif.type] || { icon: '>', color: 'text-gray-400' };
            return (
              <div key={notif.id} className="flex items-start gap-4 px-5 py-4 border-b border-gray-800/10 hover:bg-gray-800/5 transition-colors">
                <span className={`font-mono text-sm mt-0.5 ${config.color}`}>{config.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-300 truncate">{notif.subject}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-gray-600">{notif.recipient}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      notif.status === 'SENT' ? 'bg-green-950/50 text-green-400' :
                      notif.status === 'FAILED' ? 'bg-red-950/50 text-red-400' :
                      'bg-gray-800 text-gray-500'
                    }`}>
                      {notif.status}
                    </span>
                    {notif.release && (
                      <span className="text-[10px] font-mono text-purple-400">{notif.release.version}</span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-gray-600 flex-shrink-0">
                  {new Date(notif.createdAt).toLocaleString()}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}