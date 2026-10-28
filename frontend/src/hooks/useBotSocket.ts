import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export interface BotStatus {
  id: number;
  username: string;
  online: boolean;
  health: number;
  food: number;
  ping: number;
  location: string;
  shards: number;
  rateHr?: number;
  money: string;
  bones: number;
  pos: { x: number; y: number; z: number } | null;
}

export interface ChatLog {
  id: number;
  username: string;
  message: string;
  time: string;
}

export function useBotSocket(serverUrl: string, apiKey: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [logs, setLogs] = useState<ChatLog[]>([]);

  useEffect(() => {
    const s = io(serverUrl, {
      auth: { token: apiKey },
      transports: ['websocket', 'polling']
    });

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('bot:status_update', (data: BotStatus[]) => {
      setBots(data);
    });

    s.on('bot:chat_log', (log: ChatLog) => {
      setLogs((prev) => [log, ...prev].slice(0, 200));
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [serverUrl, apiKey]);

  return { socket, connected, bots, logs };
}
