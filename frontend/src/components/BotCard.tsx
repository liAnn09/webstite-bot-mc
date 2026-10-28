import React from 'react';
import { BotStatus } from '../hooks/useBotSocket';
import { Play, Square, RotateCw, Heart, Utensils, Wifi, Coins, Crosshair } from 'lucide-react';

interface Props {
  bot: BotStatus;
  serverUrl: string;
  apiKey: string;
  onOpenModal: (bot: BotStatus) => void;
}

export const BotCard: React.FC<Props> = ({ bot, serverUrl, apiKey, onOpenModal }) => {
  const callLifecycle = async (action: 'start' | 'stop' | 'restart') => {
    try {
      await fetch(`${serverUrl}/api/bots/${bot.id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ action })
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="bg-[#18181c] border border-[#2a2a32] rounded-xl p-5 shadow-lg flex flex-col justify-between hover:border-[#3f3f4e] transition">
      <div>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-3.5 h-3.5 rounded-full ${bot.online ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} />
            <h3 className="font-bold text-lg text-white">{bot.username}</h3>
          </div>
          <span className="text-xs px-2.5 py-1 bg-[#24242d] border border-[#33333f] rounded-full text-zinc-300">
            {bot.location}
          </span>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-xs">
            <Heart size={14} className="text-red-400" />
            <div className="flex-1 bg-zinc-800 h-2.5 rounded-full overflow-hidden">
              <div className="bg-red-500 h-full transition-all" style={{ width: `${Math.min(100, (bot.health / 20) * 100)}%` }} />
            </div>
            <span className="w-6 text-right font-mono text-zinc-400">{bot.health}</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Utensils size={14} className="text-amber-400" />
            <div className="flex-1 bg-zinc-800 h-2.5 rounded-full overflow-hidden">
              <div className="bg-amber-500 h-full transition-all" style={{ width: `${Math.min(100, (bot.food / 20) * 100)}%` }} />
            </div>
            <span className="w-6 text-right font-mono text-zinc-400">{bot.food}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs mb-4">
          <div className="bg-[#121215] p-2.5 rounded border border-[#22222a]">
            <div className="text-zinc-500 flex items-center gap-1"><Coins size={12}/> Shards</div>
            <div className="text-emerald-400 font-mono font-semibold text-sm mt-0.5">{bot.shards.toLocaleString()}</div>
          </div>
          <div className="bg-[#121215] p-2.5 rounded border border-[#22222a]">
            <div className="text-zinc-500 flex items-center gap-1"><Crosshair size={12}/> Spawner Bone</div>
            <div className="text-amber-400 font-mono font-semibold text-sm mt-0.5">{bot.bones.toLocaleString()}</div>
          </div>
          <div className="bg-[#121215] p-2.5 rounded border border-[#22222a]">
            <div className="text-zinc-500 flex items-center gap-1"><Wifi size={12}/> Ping</div>
            <div className="text-zinc-300 font-mono text-xs mt-0.5">{bot.ping} ms</div>
          </div>
          <div className="bg-[#121215] p-2.5 rounded border border-[#22222a]">
            <div className="text-zinc-500">Koordinat</div>
            <div className="text-zinc-300 font-mono text-xs mt-0.5">
              {bot.pos ? `${bot.pos.x}, ${bot.pos.y}, ${bot.pos.z}` : '-'}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-[#23232b]">
        {bot.online ? (
          <button onClick={() => callLifecycle('stop')} className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition">
            <Square size={12} /> Stop
          </button>
        ) : (
          <button onClick={() => callLifecycle('start')} className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition">
            <Play size={12} /> Start
          </button>
        )}
        <button onClick={() => callLifecycle('restart')} className="p-2 bg-[#252530] hover:bg-[#30303e] text-zinc-300 rounded-lg transition" title="Restart Bot">
          <RotateCw size={14} />
        </button>
        <button onClick={() => onOpenModal(bot)} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 rounded-lg text-xs font-medium transition">
          Detail & Kontrol
        </button>
      </div>
    </div>
  );
};
