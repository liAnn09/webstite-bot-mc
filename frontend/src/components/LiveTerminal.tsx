import React, { useState } from 'react';
import { ChatLog } from '../hooks/useBotSocket';
import { Terminal, Filter } from 'lucide-react';

interface Props {
  logs: ChatLog[];
}

export const LiveTerminal: React.FC<Props> = ({ logs }) => {
  const [filter, setFilter] = useState<string>('all');

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter((l) => l.username.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="bg-[#121215] border border-[#22222a] rounded-xl flex flex-col h-80 overflow-hidden shadow-xl">
      <div className="bg-[#181820] px-4 py-2 border-b border-[#282834] flex justify-between items-center text-xs">
        <div className="flex items-center gap-2 font-mono text-zinc-400">
          <Terminal size={14} className="text-emerald-400" />
          <span>CONSOLE LOGS & CHAT</span>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={12} className="text-zinc-500" />
          <input
            type="text"
            placeholder="Filter bot username..."
            value={filter === 'all' ? '' : filter}
            onChange={(e) => setFilter(e.target.value.trim() || 'all')}
            className="bg-[#101014] border border-[#2f2f3d] px-2 py-0.5 rounded text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-1 select-text">
        {filteredLogs.length === 0 ? (
          <div className="text-zinc-600 italic">Belum ada log chat masuk...</div>
        ) : (
          filteredLogs.map((log, index) => (
            <div key={index} className="flex gap-2 text-zinc-300">
              <span className="text-zinc-500 shrink-0">[{log.time}]</span>
              <span className="text-indigo-400 font-semibold shrink-0">[{log.username}]:</span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
