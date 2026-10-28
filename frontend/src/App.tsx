import { useState } from 'react';
import { useBotSocket, BotStatus } from './hooks/useBotSocket';
import { BotCard } from './components/BotCard';
import { LiveTerminal } from './components/LiveTerminal';
import { BotControls } from './components/BotControls';
import { Radio } from 'lucide-react';

const SERVER_URL = 'http://localhost:3000';
const API_KEY = 'relx-secret-key-123';

export default function App() {
  const { connected, bots, logs } = useBotSocket(SERVER_URL, API_KEY);
  const [selectedBot, setSelectedBot] = useState<BotStatus | null>(null);

  return (
    <div className="min-h-screen bg-[#0e0e12] text-zinc-100 flex flex-col">
      {/* Navbar */}
      <header className="border-b border-[#22222a] bg-[#141419] px-6 py-4 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg border border-indigo-500/30">
            <Radio size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide">RELXMC AFK BOT DASHBOARD</h1>
            <p className="text-xs text-zinc-500">Multi-Account Controller & Realtime Monitor</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1a22] border border-[#2a2a36] rounded-full text-xs">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
            <span className="text-zinc-400">{connected ? 'Socket Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* Bot Grid Cards */}
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Akun Bot Aktif</h2>
          {bots.length === 0 ? (
            <div className="bg-[#141419] border border-[#22222a] p-8 text-center rounded-xl text-zinc-500 text-sm">
              Memuat data akun bot atau menunggu bot terhubung...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bots.map((bot) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  serverUrl={SERVER_URL}
                  apiKey={API_KEY}
                  onOpenModal={setSelectedBot}
                />
              ))}
            </div>
          )}
        </div>

        {/* Live Terminal Console */}
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Live Console & Chat Log</h2>
          <LiveTerminal logs={logs} />
        </div>
      </main>

      {/* Detail & Control Modal */}
      <BotControls
        bot={selectedBot}
        serverUrl={SERVER_URL}
        apiKey={API_KEY}
        onClose={() => setSelectedBot(null)}
      />
    </div>
  );
}
