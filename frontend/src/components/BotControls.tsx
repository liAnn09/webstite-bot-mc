import React, { useState, useEffect } from 'react';
import { BotStatus } from '../hooks/useBotSocket';
import { X, Send } from 'lucide-react';

interface Props {
  bot: BotStatus | null;
  serverUrl: string;
  apiKey: string;
  onClose: () => void;
}

export const BotControls: React.FC<Props> = ({ bot, serverUrl, apiKey, onClose }) => {
  const [tab, setTab] = useState<'actions' | 'hotbar' | 'spawner'>('actions');
  const [cmd, setCmd] = useState('');
  const [hotbar, setHotbar] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bot || tab !== 'hotbar') return;
    fetch(`${serverUrl}/api/bots/${bot.id}/inventory`, {
      headers: { 'x-api-key': apiKey }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) setHotbar(data.hotbar || []);
      })
      .catch((err) => console.error(err));
  }, [bot, tab, serverUrl, apiKey]);

  if (!bot) return null;

  const sendAction = async (action: string, payload = {}) => {
    setLoading(true);
    try {
      await fetch(`${serverUrl}/api/bots/${bot.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ action, ...payload })
      });
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const sendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    try {
      await fetch(`${serverUrl}/api/bots/${bot.id}/cmd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ cmd })
      });
      setCmd('');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-[#18181e] border border-[#2b2b36] rounded-xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-3 border-b border-[#282834] flex justify-between items-center bg-[#1e1e26]">
          <h3 className="font-bold text-white flex items-center gap-2">
            <span>Kontrol Bot: {bot.username}</span>
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-[#282834] bg-[#141418] text-xs font-semibold">
          <button onClick={() => setTab('actions')} className={`flex-1 py-2.5 ${tab === 'actions' ? 'border-b-2 border-indigo-500 text-white' : 'text-zinc-400 hover:text-white'}`}>Aksi Cepat</button>
          <button onClick={() => setTab('hotbar')} className={`flex-1 py-2.5 ${tab === 'hotbar' ? 'border-b-2 border-indigo-500 text-white' : 'text-zinc-400 hover:text-white'}`}>Hotbar Slot</button>
          <button onClick={() => setTab('spawner')} className={`flex-1 py-2.5 ${tab === 'spawner' ? 'border-b-2 border-indigo-500 text-white' : 'text-zinc-400 hover:text-white'}`}>Spawner Bones</button>
        </div>

        {/* Tab Body */}
        <div className="p-5 flex-1 min-h-[220px]">
          {tab === 'actions' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button disabled={loading} onClick={() => sendAction('afk')} className="bg-[#24242e] hover:bg-[#2c2c38] text-zinc-200 border border-[#333342] p-2.5 rounded-lg text-xs font-medium transition">
                  Masuk /afk
                </button>
                <button disabled={loading} onClick={() => sendAction('farm')} className="bg-[#24242e] hover:bg-[#2c2c38] text-zinc-200 border border-[#333342] p-2.5 rounded-lg text-xs font-medium transition">
                  Jalan ke Titik Farm
                </button>
                <button disabled={loading} onClick={() => sendAction('jump')} className="bg-[#24242e] hover:bg-[#2c2c38] text-zinc-200 border border-[#333342] p-2.5 rounded-lg text-xs font-medium transition">
                  Lompat Sekali
                </button>
                <button disabled={loading} onClick={() => sendAction('drop_bone')} className="bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 p-2.5 rounded-lg text-xs font-medium transition">
                  Drop Bones Sekarang
                </button>
              </div>

              {/* In-Game Command Form */}
              <form onSubmit={sendCommand} className="flex gap-2 pt-2">
                <input
                  type="text"
                  placeholder="Kirim perintah Minecraft (contoh: /home, /warp crates)..."
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  className="flex-1 bg-[#121216] border border-[#2e2e3a] px-3 py-2 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition">
                  <Send size={12} /> Kirim
                </button>
              </form>
            </div>
          )}

          {tab === 'hotbar' && (
            <div>
              <div className="grid grid-cols-9 gap-1 bg-[#101014] p-2 rounded-lg border border-[#2b2b36]">
                {hotbar.map((item) => (
                  <div key={item.slot} className="aspect-square bg-[#1a1a22] border border-[#2e2e3c] rounded flex flex-col items-center justify-center p-1 relative">
                    <span className="text-[10px] text-zinc-500 absolute top-0.5 left-1">{item.slot}</span>
                    <span className="text-[11px] font-bold text-zinc-200 truncate w-full text-center">
                      {item.name ? item.name.slice(0, 3).toUpperCase() : '-'}
                    </span>
                    {item.count > 1 && (
                      <span className="text-[10px] text-amber-400 font-mono absolute bottom-0.5 right-1">{item.count}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-zinc-500 text-xs mt-3 text-center">Visualisasi 9 slot Hotbar Minecraft</p>
            </div>
          )}

          {tab === 'spawner' && (
            <div className="space-y-4">
              <div className="bg-[#121216] p-4 rounded-lg border border-[#262633] flex justify-between items-center">
                <div>
                  <div className="text-xs text-zinc-400">Total Bone di Storage</div>
                  <div className="text-xl font-bold font-mono text-amber-400">{bot.bones.toLocaleString()}</div>
                </div>
                <button onClick={() => sendAction('drop_bone')} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-xs font-semibold transition">
                  Drop Bones Sekarang
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
