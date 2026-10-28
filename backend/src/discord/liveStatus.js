const { EmbedBuilder } = require('discord.js');
const { accounts, discordLiveChannelId } = require('../core/config');
const { botMap, isStopped } = require('../core/bot');
const { snapshot: playersSnapshot, liveEmbed: playersLiveEmbed } = require('../features/players');
const stats = require('../core/stats');
const { rateOf } = require('../features/rate');
const { log, countShards } = require('../core/utils');

const STATE_LABEL = {
  ecocpvp: 'ECOCPVP',
  joining: 'MASUK ECOCPVP...',
  lobby: 'LOBBY'
};

const WATCHDOG_WARN_MS = 30 * 1000;   // tampil "MACET" di embed
const WATCHDOG_KILL_MS = 90 * 1000;   // paksa reconnect

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta' });
}

const fmtNum = (n) => Math.round(n).toLocaleString('id-ID');
const sign = (n) => (n >= 0 ? '+' : '−');

// 3j 12m / 4m 7d / 35d
function fmtDur(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}j ${m}m`;
  if (m) return `${m}m ${s}d`;
  return `${s}d`;
}

// Satu persegi status per akun untuk ikhtisar sekilas: 🟩 aktif · 🟨 di lobby/masuk · 🟥 offline/macet · ⬛ dihentikan
const SQUARE = { good: '🟩', warn: '🟨', bad: '🟥', stop: '⬛' };

function buildEmbed(intervalSec) {
  const now = Date.now();
  let goodCount = 0;
  let onlineCount = 0;
  let totalShards = 0;
  let totalGain = 0;
  let totalPerHour = 0;
  let ratedCount = 0;
  const squares = [];

  const botFields = accounts.map((acc) => {
    const bot = botMap.get(acc.id);
    const st = stats.get(acc.id);
    const online = !!bot && !bot._disconnected;
    const rate = rateOf(st, now);
    const shards = st.known ? fmtNum(st.lastShards) : '*menunggu data...*';

    totalShards += st.lastShards;
    totalGain += rate.gain;
    if (rate.enough) {
      totalPerHour += rate.perHour;
      ratedCount++;
    }

    // ---- Offline / dihentikan ----
    if (!online) {
      const stopped = isStopped(acc.id);
      squares.push(stopped ? SQUARE.stop : SQUARE.bad);
      return {
        name: `${stopped ? '⬛' : '🔴'}  ${acc.username}  ·  B${acc.id}`,
        value:
          `**Shards** ${shards}${st.known ? ' *(terakhir)*' : ''}\n` +
          `**Server** ${stopped ? 'DIHENTIKAN · ketik `!start`' : 'OFFLINE · menunggu reconnect'}  ·  **Reconnect** ${st.reconnects}x`,
        inline: false
      };
    }

    onlineCount++;

    // ---- Online ----
    const silent = now - st.lastBeat;
    const healthy = !bot.entity || silent < WATCHDOG_WARN_MS;
    const inEco = bot._state === 'ecocpvp';
    const good = healthy && inEco;
    if (good) goodCount++;
    squares.push(!healthy ? SQUARE.bad : inEco ? SQUARE.good : SQUARE.warn);
    const icon = !healthy ? '🔴' : inEco ? '🟢' : '🟡';

    // Baris 1: shard · selisih sesi · rate
    let line1 = `**Shards** ${shards}`;
    if (st.awal !== null) {
      const d = st.lastShards - st.awal;
      line1 += `  ▸  ${sign(d)}${fmtNum(Math.abs(d))}`;
    }
    if (rate.enough) line1 += `  ·  ≈ ${fmtNum(rate.perHour)}/jam`;

    // Baris 2: server · lokasi (+koordinat) · lama AFK
    const pos = bot.entity && bot.entity.position;
    const coords = inEco && pos ? ` (${Math.floor(pos.x)}, ${Math.floor(pos.z)})` : '';
    const where = inEco ? `${st.location}${coords}` : '-';
    const afk = inEco && st.afkStart ? fmtDur(now - st.afkStart) : '-';
    const line2 = `**Server** ${STATE_LABEL[bot._state] || 'LOBBY'}  ·  **Lokasi** ${where}  ·  **AFK** ${afk}`;

    // Baris 3: ping · reconnect · kesehatan
    const ping = bot.player && typeof bot.player.ping === 'number' ? `${bot.player.ping}ms` : '-';
    const health = healthy ? 'Sehat' : `Macet ${Math.floor(silent / 1000)}d`;
    const line3 = `**Ping** ${ping}  ·  **Reconnect** ${st.reconnects}x  ·  **Status** ${health}`;

    // Baris 4 (kalau terbaca dari papan skor): Money & Coins
    const wallet = [];
    if (st.money) wallet.push(`**Money** ${st.money}`);
    if (st.coins) wallet.push(`**Coins** ${st.coins}`);
    if (st.bones !== null && st.bones !== undefined && Date.now() - st.bonesAt < 20 * 60 * 1000) wallet.push(`**Bone** ${fmtNum(st.bones)}`);

    return {
      name: `${icon}  ${acc.username}  ·  B${acc.id}`,
      value: [line1, line2, line3, wallet.join('  ·  ')].filter(Boolean).join('\n'),
      inline: false
    };
  });

  // ---- Ringkasan: tiga "kartu angka" sejajar ----
  const tiles = [
    { name: 'Total Shards', value: `**${fmtNum(totalShards)}**`, inline: true },
    { name: 'Didapat', value: `**${sign(totalGain)}${fmtNum(Math.abs(totalGain))}**\n*sejak bot jalan*`, inline: true },
    {
      name: 'Rate',
      value: ratedCount > 0
        ? `**≈ ${fmtNum(totalPerHour)}**/jam\n≈ ${fmtNum(totalPerHour * 24)}/hari`
        : '*belum cukup data*',
      inline: true
    }
  ];

  const color = goodCount === accounts.length ? 0x2ecc71 : onlineCount > 0 ? 0xe67e22 : 0xe74c3c;
  const dots = squares.join('');

  return new EmbedBuilder()
    .setColor(color)
    .setTitle('RelxMC  ·  Live Monitor')
    .setDescription(`${dots}   **${onlineCount}/${accounts.length}** bot online`)
    .addFields([...tiles, ...botFields])
    .setFooter({ text: `Diperbarui ${fmtClock(now)} WIB  ·  tiap ${intervalSec} detik` });
}

// Pesan live = dua embed terpisah: (1) status bot, (2) pemain online di server
function buildEmbeds(intervalSec) {
  const embeds = [buildEmbed(intervalSec)];
  const players = playersLiveEmbed(playersSnapshot(null));
  if (players) embeds.push(players);
  return embeds;
}

// ---- Live message manager (satu pesan live pada satu waktu) ----
let live = null; // { message, timer, busy }

function stopLive() {
  if (!live) return false;
  clearInterval(live.timer);
  live = null;
  return true;
}

async function startLive(channel, intervalSec) {
  const prev = live;
  stopLive();
  if (prev) prev.message.delete().catch(() => {}); // hapus pesan live lama supaya tidak ada yang membeku

  const message = await channel.send({ embeds: buildEmbeds(intervalSec) });
  const state = { message, timer: null, busy: false };

  state.timer = setInterval(async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      await state.message.edit({ embeds: buildEmbeds(intervalSec) });
    } catch (err) {
      // Pesan dihapus / channel hilang → hentikan live
      log('DiscordBot', `[ERROR] Live status berhenti: ${err.message}`);
      if (live === state) stopLive();
      else clearInterval(state.timer);
    } finally {
      state.busy = false;
    }
  }, intervalSec * 1000);

  live = state;
}

function initLive(client) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    // Kalau ada channel live khusus: !live boleh diketik di channel live atau channel command,
    // dan hasilnya selalu tampil di channel live (supaya tidak ada dua live di tempat berbeda).
    const liveId = process.env.DISCORD_LIVE_CHANNEL_ID || discordLiveChannelId;
    const cmdId = process.env.DISCORD_CMD_CHANNEL_ID || '';
    if (liveId && message.channel.id !== liveId && message.channel.id !== cmdId) return;

    // Format: !live 5 | !live stop | [live 5]
    const match = message.content.trim().match(/^(?:!|\[)live(?:\s+(\S+?))?\]?$/i);
    if (!match) return;

    const arg = (match[1] || '').toLowerCase();

    if (arg === 'stop') {
      message.reply(stopLive() ? '⏹️ Live status dihentikan.' : 'ℹ️ Tidak ada live status yang berjalan.').catch(() => {});
      return;
    }

    let sec = arg ? parseInt(arg) : 10;
    if (isNaN(sec)) {
      message.reply('❌ Format: `!live <detik>` atau `!live stop`').catch(() => {});
      return;
    }
    sec = Math.min(Math.max(sec, 5), 3600); // min 5 detik (batas aman rate limit Discord)

    try {
      let target = message.channel;
      if (liveId && message.channel.id !== liveId) {
        target = (await message.client.channels.fetch(liveId)) || message.channel;
      }
      await startLive(target, sec);
      if (target.id !== message.channel.id) message.reply(`✅ Live status aktif di ${target} (tiap ${sec} detik).`).catch(() => {});
    } catch (err) {
      message.reply(`❌ Gagal memulai live: ${err.message}`).catch(() => {});
    }
  });
}

// Watchdog: kalau bot tidak menerima packet apa pun > 90 detik → paksa reconnect
function startWatchdog() {
  setInterval(() => {
    const now = Date.now();
    for (const bot of botMap.values()) {
      if (bot._disconnected || !bot.entity) continue;
      const st = stats.get(bot.accId);
      if (!st.lastBeat) continue;
      if (now - st.lastBeat > WATCHDOG_KILL_MS) {
        const name = accounts.find(a => a.id === bot.accId)?.username || 'Bot';
        log(name, '[ERROR] Watchdog: tidak ada respon dari server > 90 detik. Paksa reconnect...');
        bot.end('watchdog timeout');
      }
    }
  }, 15000);
}

module.exports = { initLive, startLive, startWatchdog };
