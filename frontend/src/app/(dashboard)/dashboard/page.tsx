'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import { IndianRupee, ChefHat, Clock, LayoutGrid } from 'lucide-react';

interface DailyStats {
  sales: number;
  runningOrders: number;
  pendingOrders: number;
  tablesOccupied: number;
}

export default function DashboardPage() {
  const { currentTenant } = useAuthStore();
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/daily-stats')
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tiles = [
    {
      label: "Today's Sales",
      value: stats?.sales ?? 0,
      icon: IndianRupee,
      color: 'bg-green-50 border-green-200',
      iconColor: 'text-green-600',
      prefix: '₹',
    },
    {
      label: 'Running Orders',
      value: stats?.runningOrders ?? 0,
      icon: ChefHat,
      color: 'bg-blue-50 border-blue-200',
      iconColor: 'text-blue-600',
    },
    {
      label: 'Pending Orders',
      value: stats?.pendingOrders ?? 0,
      icon: Clock,
      color: 'bg-yellow-50 border-yellow-200',
      iconColor: 'text-yellow-600',
    },
    {
      label: 'Tables Occupied',
      value: stats?.tablesOccupied ?? 0,
      icon: LayoutGrid,
      color: 'bg-purple-50 border-purple-200',
      iconColor: 'text-purple-600',
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Welcome back{currentTenant?.business_name ? ` to ${currentTenant.business_name}` : ''}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className={`rounded-xl border p-5 ${tile.color}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{tile.label}</span>
                <tile.icon size={20} className={tile.iconColor} />
              </div>
              <p className="text-3xl font-bold text-gray-900">
                {tile.prefix ? `${tile.prefix}${tile.value.toLocaleString()}` : tile.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
