const { Server } = require('socket.io');
const { socketAuth } = require('./auth');
const stats = require('../core/stats');
const { accounts } = require('../core/config');
const botCore = require('../core/bot');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  io.use(socketAuth);

  io.on('connection', (socket) => {
    socket.emit('bot:connected', { time: Date.now() });
  });

  // Loop broadcast status tiap 1 detik
  setInterval(() => {
    if (!io) return;
    const botMap = botCore.botMap;
    const payload = (accounts || []).map((acc) => {
      const bot = botMap ? botMap.get(acc.id) : null;
      const st = stats.get(acc.id);
      return {
        id: acc.id,
        username: acc.username,
        online: !!bot && !bot._disconnected,
        health: bot?.health ?? 0,
        food: bot?.food ?? 0,
        ping: bot?.player?.ping ?? 0,
        location: st?.location || '-',
        shards: st?.lastShards || 0,
        money: st?.money || '-',
        bones: st?.bones || 0,
        pos: bot?.entity?.position ? {
          x: Math.round(bot.entity.position.x),
          y: Math.round(bot.entity.position.y),
          z: Math.round(bot.entity.position.z)
        } : null
      };
    });
    io.emit('bot:status_update', payload);
  }, 1000);

  return io;
}

function emitChatLog(accId, username, message) {
  if (!io) return;
  io.emit('bot:chat_log', {
    id: accId,
    username,
    message,
    time: new Date().toLocaleTimeString()
  });
}

function emitAlert(type, message, botId) {
  if (!io) return;
  io.emit('bot:alert', { type, message, botId, time: Date.now() });
}

module.exports = { initSocket, emitChatLog, emitAlert, getIO: () => io };
