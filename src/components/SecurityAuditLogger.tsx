import React, { useState, useEffect } from 'react';
import { ShieldAlert, Activity, RefreshCw, Terminal, Search, Lock, Filter, CheckCircle, AlertCircle } from 'lucide-react';

interface LogItem {
  id: string;
  timestamp: string;
  protocol: string;
  type: string;
  source: string;
  destination: string;
  message: string;
  details?: any;
}

interface SecurityAuditLoggerProps {
  centralToken: string;
}

export const SecurityAuditLogger: React.FC<SecurityAuditLoggerProps> = ({ centralToken }) => {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/traffic-logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to load traffic logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.message.toLowerCase().includes(filter.toLowerCase()) ||
      log.source.toLowerCase().includes(filter.toLowerCase()) ||
      log.protocol.toLowerCase().includes(filter.toLowerCase());
    const matchesType = typeFilter === 'all' || log.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-bold text-slate-900">Security & Authentication Audit Logs</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time server activity tracking for authentication, rate limits, and sensitive security events.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Audit Logs
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search logs by keyword, IP, or user..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All Event Types</option>
            <option value="success">Success Events</option>
            <option value="error">Error / Denied Events</option>
            <option value="rate_limit">Rate Limit Events</option>
            <option value="token">Token Operations</option>
          </select>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="bg-slate-950 text-slate-200 rounded-xl p-4 font-mono text-xs overflow-x-auto max-h-[380px] space-y-2.5 border border-slate-800">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-8 text-slate-500 font-sans">
            No audit logs found matching your filters.
          </div>
        ) : (
          filteredLogs.map(log => {
            const isError = log.type === 'error' || log.type === 'rate_limit';
            return (
              <div
                key={log.id}
                className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-900 transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  {isError ? (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-indigo-400">[{log.protocol}]</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        isError ? 'bg-rose-950/80 text-rose-300 border border-rose-800' : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      }`}>
                        {log.type}
                      </span>
                      <span className="text-slate-400">From: {log.source} → {log.destination}</span>
                    </div>
                    <p className="mt-1 text-slate-200">{log.message}</p>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 font-sans shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
