const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, Events, EmbedBuilder } = require('discord.js');
const { discordToken, discordGuildId, discordLogChannelId, discordCmdChannelId, accounts } = require('../core/config');
const { botMap, controlBots, isStopped } = require('../core/bot');
const { readBoard, shardsText } = require('../features/board');
const { buildRateEmbed } = require('../features/rate');
const { buildTp, cancelAutoReturn, watchTeleport } = require('../features/tp');
const { farmSpot, setFarmSpot, posOf, walkTo, goFarm } = require('../features/farm');
const stats = require('../core/stats');
const { snapshot: playersSnapshot, buildPlayersEmbeds, buildTabEmbed } = require('../features/players');
const { initLive, startLive } = require('./liveStatus');
const { setupServer, createServer, initSetup, inviteUrl, cleanBotMessages } = require('./discordSetup');
const { isAllowed } = require('./auth');
const { buildHelpEmbed } = require('./helpEmbed');
const { buyItem, parseBuyArgs } = require('../features/shop');
const { gotMessage } = require('../features/inv');
const { pickBot, pickSellBot, parseAhArgs, hotbarLines, sellHotbar, sellResultText } = require('../features/hotbar');
const { showShop, initShopUi, getSelection } = require('./shopUi');
const { showCrates, showCrate, showKeys, claimCommand, initCratesUi } = require('./cratesUi');
const { setHome, goHome, delHome, listHomes } = require('../features/homes');
const { spawnerCommand } = require('./spawnerUi');

let client = null;
let logChannel = null;
let cmdChannel = null;

function resolveBots(tag) {
  if (!tag) return Array.from(botMap.values());
  const clean = tag.toLowerCase().replace('b', '');
  const n = parseInt(clean);
  if (!isNaN(n) && botMap.has(n)) return [botMap.get(n)];
  return [];
}

function nameOf(bot) {
  return accounts.find(a => a.id === bot.accId)?.username || 'Bot';
}

// Sambungkan channel hasil setup (log & command) ke bot yang sedang berjalan
async function connectChannels({ logCh, cmdCh, liveCh }) {
  logChannel = logCh;
  cmdChannel = cmdCh;
  await startLiveAuto(liveCh);
}

// Live status otomatis di channel live (aktif kalau LIVE_AUTO_SECONDS >= 5)
async function startLiveAuto(channel) {
  const seconds = parseInt(process.env.LIVE_AUTO_SECONDS) || 0;
  if (!channel || seconds < 5) return;
  await cleanBotMessages(client, channel);
  await startLive(channel, Math.min(seconds, 3600));
}

function initDiscord() {
  if (!discordToken) return;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  initLive(client);
  initShopUi(client);
  initCratesUi(client);
  initSetup(client, { onSetup: connectChannels });

  client.once(Events.ClientReady, async () => {
    const { log } = require('../core/utils');
    log('DiscordBot', `Logged in as ${client.user.tag}`);

    const logId = process.env.DISCORD_LOG_CHANNEL_ID;
    const cmdId = process.env.DISCORD_CMD_CHANNEL_ID;

    // Jika channel ID sudah ada di .env → langsung fetch
    if (logId && cmdId) {
      try {
        logChannel = await client.channels.fetch(logId);
        cmdChannel = await client.channels.fetch(cmdId);
        log('DiscordBot', 'Channel Log & Command terhubung (dari .env).');

        if (logChannel) logChannel.send('📜 **[LOG]** Bot RelxMC Online! Stream log aktif.').catch(() => {});
        if (cmdChannel) cmdChannel.send('🤖 **[COMMAND]** Bot RelxMC Online! Ketik `!help` untuk daftar command.').catch(() => {});

        const liveId = process.env.DISCORD_LIVE_CHANNEL_ID;
        if (liveId) {
          try {
            await startLiveAuto(await client.channels.fetch(liveId));
          } catch (err) {
            log('DiscordBot', `[ERROR] Live otomatis gagal: ${err.message}`);
          }
        }
      } catch (err) {
        log('DiscordBot', `[ERROR] Gagal fetch channel: ${err.message}. Mencoba membangun ulang...`);
        await tryAutoCreate(log);
      }
    } else {
      // Channel ID belum diisi → bangun otomatis
      await tryAutoCreate(log);
    }
  });

  async function tryAutoCreate(log) {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      console.log('\n[DISCORD] DISCORD_GUILD_ID belum diisi. Pilih salah satu:');
      console.log('  1) Biarkan bot membuat server baru → ketik di console:  server create');
      console.log(`  2) Undang bot ke server yang sudah ada: ${inviteUrl(client)}`);
      console.log('     lalu isi DISCORD_GUILD_ID di .env dan jalankan ulang (atau ketik !setup di server itu).\n');
      return;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      const res = await setupServer(client, guild);
      await connectChannels(res);

      if (logChannel) logChannel.send('📜 **[LOG]** Bot RelxMC Online! Stream log aktif.').catch(() => {});
      if (cmdChannel) cmdChannel.send('🤖 **[COMMAND]** Bot RelxMC Online! Ketik `!help` untuk daftar command.').catch(() => {});
    } catch (err) {
      log('DiscordBot', `[ERROR] Membangun server gagal: ${err.message}`);
      console.log(`  Pastikan bot sudah diundang ke server itu dengan izin Manage Channels & Manage Roles:\n  ${inviteUrl(client)}`);
    }
  }

  // Command handler
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Hanya respons di Command Channel
    if (cmdChannel && message.channel.id !== cmdChannel.id) return;

    let content = message.content.trim();
    if (content.startsWith('[')) {
      content = content.replace(/^\[/, '').replace(/\]$/, '').trim();
    } else if (content.startsWith('!')) {
      content = content.slice(1).trim();
    } else {
      return;
    }

    const parts = content.split(/\s+/);
    const command = parts[0].toLowerCase();

    // Hanya Operator / admin / ID yang diizinkan boleh memakai command (kecuali !help)
    if (!['help', 'setup', 'role', 'owner'].includes(command) && !isAllowed(message.author.id, message.member)) {
      message.reply('⛔ Kamu tidak punya izin memakai command bot. Minta role **🤖 Operator**.').catch(() => {});
      return;
    }

    // !help
    if (command === 'help') {
      message.reply({ embeds: [buildHelpEmbed(client)] });
      return;
    }

    // !status
    if (command === 'status') {
      let statusMsg = '📊 **Status Bot RelxMC:**\n';
      accounts.forEach(acc => {
        const bot = botMap.get(acc.id);
        if (bot) {
          const ping = bot.player ? `${bot.player.ping}ms` : '...';
          statusMsg += `🟢 **B${acc.id} (${acc.username})** - ONLINE (${ping})\n`;
        } else {
          statusMsg += isStopped(acc.id)
            ? `⏸️ **B${acc.id} (${acc.username})** - DIHENTIKAN\n`
            : `🔴 **B${acc.id} (${acc.username})** - OFFLINE\n`;
        }
      });
      message.reply(statusMsg);
      return;
    }

    // !shards
    if (command === 'shards' || command === 'shard') {
      const targetBots = resolveBots(parts[1]);
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }

      let res = '💎 **Total Shard:**\n';
      targetBots.forEach(bot => {
        res += `• **${nameOf(bot)}**: \`${shardsText(bot)}\` Shard\n`;
      });
      message.reply(res);
      return;
    }

    // !ping
    if (command === 'ping') {
      const targetBots = resolveBots(parts[1]);
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }

      let res = '';
      targetBots.forEach(bot => {
        const ping = bot.player ? `${bot.player.ping}ms` : 'N/A';
        res += `📡 **${nameOf(bot)}** Ping: \`${ping}\`\n`;
      });
      message.reply(res);
      return;
    }

    // !shardshop [b1] — embed daftar item (nama + harga) + menu pilihan
    if (command === 'shardshop' || command === 'shop') {
      await showShop(message, parts[1]);
      return;
    }

    // !buy [b1] [xN]            → beli item yang dipilih di menu !shardshop
    // !buy [b1] <slot|nama> [xN] → beli langsung tanpa menu
    if (command === 'buy') {
      const opt = parseBuyArgs(parts.slice(1));
      const targetBots = resolveBots(opt.botTag);
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${opt.botTag || ''} tidak aktif.`);
        return;
      }

      let choice = { slot: opt.slot, keyword: opt.keyword };
      let what;
      if (opt.slot === null && !opt.keyword) {
        const picked = getSelection(message.author.id);
        if (!picked) {
          message.reply('ℹ️ Belum ada item yang dipilih. Ketik `!shardshop`, pilih item di menu, lalu ketik `!buy`.\n(Atau langsung: `!buy <slot|nama>`)');
          return;
        }
        choice = { slot: picked.slot, keyword: null };
        what = `**${picked.label}**${picked.price ? ` (${picked.price})` : ''}`;
      } else {
        what = opt.slot !== null ? `slot ${opt.slot}` : `"${opt.keyword}"`;
      }

      message.reply(`🛒 Beli ${what}${opt.times > 1 ? ` x${opt.times}` : ''} untuk ${targetBots.length} bot...`);
      targetBots.forEach(async (bot) => {
        const username = nameOf(bot);
        const res = await buyItem(bot, username, choice, opt.times);
        if (cmdChannel) {
          let text = res.ok
            ? `✅ **[BUY SUCCESS]** ${username}: ${res.done}x berhasil. ${res.info}`
            : `❌ **[BUY ERROR]** ${username}: ${res.done}/${res.times} berhasil. ${res.info}`;
          const where = gotMessage(res.got, bot.accId, '!');
          if (where) text += '\n' + where;
          cmdChannel.send(text).catch(() => {});
        }
      });
      return;
    }

    // !hotbar [b1] — isi hotbar (nomor 1-9)
    if (command === 'hotbar') {
      const bot = pickBot(parts[1]);
      if (!bot) {
        message.reply(`❌ Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }
      message.reply(
        `🎒 **Hotbar ${nameOf(bot)}**\n` + '```\n' + hotbarLines(bot).join('\n') + '\n```' +
        'Jual: `!ah [b1] <hotbar 1-9> <harga>` — contoh `!ah b1 3 5000`'
      );
      return;
    }

    // !ah [b1] [hotbar 1-9] <harga> — jual item dari hotbar lewat /ah sell
    // Tanpa nomor hotbar = item yang terakhir dibeli
    if (command === 'ah') {
      const opt = parseAhArgs(parts.slice(1));
      const bot = pickSellBot(opt.botTag);
      if (!bot) {
        message.reply(opt.botTag
          ? `❌ Bot ${opt.botTag} tidak aktif.`
          : '❌ Ada lebih dari 1 bot aktif dan belum ada yang baru beli item. Sebutkan botnya, contoh: `!ah b1 3 5000`');
        return;
      }
      const hotbar = opt.hotbar !== null ? opt.hotbar : (bot._lastBought ? bot._lastBought.hotbar : null);
      if (!opt.price || hotbar === null) {
        message.reply('❌ Format: `!ah [b1] <hotbar 1-9> <harga>` — contoh `!ah 3 5000`.\n(Tanpa nomor hotbar = item yang terakhir dibeli. Lihat isi hotbar: `!hotbar`)');
        return;
      }

      const username = nameOf(bot);
      message.reply(`🏷️ ${username}: jual hotbar ${hotbar} seharga ${opt.price}...`);
      const res = await sellHotbar(bot, username, hotbar, opt.price);
      message.channel.send(
        res.ok
          ? `✅ **[AH LISTED]** ${username}: ${sellResultText(res)}`
          : `❌ **[AH ERROR]** ${username}: ${res.info}`
      ).catch(() => {});
      return;
    }

    // !players [bot] [nama] — pemain online di server (dari tab list). Alias: !online, !pemain
    if (command === 'players' || command === 'online' || command === 'pemain') {
      const args = parts.slice(1);
      const tag = args.find((a) => /^b\d+$/i.test(a));
      const search = args.filter((a) => a !== tag).join(' ');
      const snap = playersSnapshot(tag || null);
      if (!snap) {
        message.reply(tag ? `❌ Bot ${tag} tidak aktif.` : '❌ Tidak ada bot online untuk membaca daftar pemain.');
        return;
      }
      message.reply({ embeds: buildPlayersEmbeds(snap, search) });
      return;
    }

    // !tab [bot] — tampilan tab list server (rank/prefix, urutan & kolom seperti di game)
    if (command === 'tab' || command === 'tablist') {
      const tag = parts[1] && /^b\d+$/i.test(parts[1]) ? parts[1] : null;
      const snap = playersSnapshot(tag);
      if (!snap) {
        message.reply(tag ? `❌ Bot ${tag} tidak aktif.` : '❌ Tidak ada bot online untuk membaca tab list.');
        return;
      }
      message.reply({ embeds: [buildTabEmbed(snap)] });
      return;
    }

    // ---- Spawner: !spawner [bot] · drop <bot> · auto on|off <bot|all> · limit <jumlah> <bot|all> · stop [bot] ----
    if (command === 'spawner') {
      await spawnerCommand(message, parts.slice(1));
      return;
    }

    // ---- Home: !sethome <nama> <bot|all> · !home [nama] <bot|all> · !delhome <nama> <bot|all> · !homes [bot] ----
    if (command === 'sethome' || command === 'home' || command === 'delhome' || command === 'homes') {
      const args = parts.slice(1);
      const tag = args.find((a) => /^(b\d+|all)$/i.test(a));
      const name = args.filter((a) => a !== tag)[0] || null;
      const usage = {
        sethome: '!sethome <nama> <b1|all>',
        home: '!home [nama] <b1|all>',
        delhome: '!delhome <nama> <b1|all>',
        homes: '!homes [b1]'
      }[command];

      // Bot target: tag eksplisit; tanpa tag hanya kalau cuma ada 1 bot online (supaya tidak terkirim ke semua akun tanpa sengaja)
      let targets;
      if (tag && tag.toLowerCase() !== 'all') targets = resolveBots(tag);
      else if (tag) targets = resolveBots(null);
      else {
        const online = resolveBots(null);
        targets = command === 'homes' ? online.slice(0, 1) : online.length === 1 ? online : [];
      }
      if (!targets.length) {
        message.reply(tag ? `Bot ${tag} tidak aktif.` : `Sebutkan botnya agar tidak terkirim ke semua akun sekaligus. Format: \`${usage}\``);
        return;
      }
      if ((command === 'sethome' || command === 'delhome') && !name) {
        message.reply(`Nama home wajib diisi. Format: \`${usage}\``);
        return;
      }

      const fn = { sethome: setHome, home: goHome, delhome: delHome, homes: listHomes }[command];
      const label = { sethome: `/sethome ${name}`, home: name ? `/home ${name}` : '/home', delhome: `/delhome ${name}`, homes: '/homes' }[command];
      const wait = await message.reply(`${label} → ${targets.map(nameOf).join(', ')}...`);

      const results = await Promise.all(
        targets.map(async (bot, i) => {
          await new Promise((r) => setTimeout(r, i * 800)); // jangan serempak
          return { bot, res: await fn(bot, accounts.find((a) => a.id === bot.accId), name) };
        })
      );
      const lines = results.map(({ bot, res }) => `${res.ok ? 'OK   ' : 'GAGAL'}  ${nameOf(bot)}: ${res.info}`);
      if (command === 'home' && results.some((r) => r.res.ok)) {
        const { jumpMinMinutes, jumpMaxMinutes } = require('../core/config');
        lines.push(`Bot AFK di sana dan lompat otomatis (anti-AFK) tiap ${jumpMinMinutes}-${jumpMaxMinutes} menit. Kembali ke farm: \`!farm <bot>\``);
      }
      wait.edit(`**${label}**\n` + lines.join('\n')).catch(() => {});
      return;
    }

    // ---- Crates (/warp crates) ----
    // !crates [bot] — daftar crate + jumlah key, pilih crate lewat menu
    if (command === 'crates') {
      await showCrates(message, parts[1]);
      return;
    }

    // !crate <nama> [bot] — buka crate langsung dan lihat hadiahnya (nama item)
    if (command === 'crate') {
      const args = parts.slice(1);
      const tag = args.find((a) => /^b\d+$/i.test(a));
      const query = args.filter((a) => a !== tag).join(' ');
      if (!query) {
        message.reply('Format: `!crate <nama> [bot]` — contoh `!crate common`. Lihat daftarnya dengan `!crates`.');
        return;
      }
      await showCrate(message, query, tag);
      return;
    }

    // !claim [bot] | !claim <crate> <item|slot> [bot] — ambil hadiah crate (memakai 1 key). Alias: !ambil
    if (command === 'claim' || command === 'ambil') {
      await claimCommand(message, parts.slice(1));
      return;
    }

    // !keys [bot|all] — jumlah key tiap crate
    if (command === 'keys') {
      await showKeys(message, parts[1]);
      return;
    }

    // !rate [bot] — shard per jam & estimasi per hari
    if (command === 'rate') {
      const n = parts[1] ? parseInt(parts[1].replace(/^b/i, '')) : null;
      if (parts[1] && (isNaN(n) || !accounts.some((a) => a.id === n))) {
        message.reply(`❌ Bot ${parts[1]} tidak ada.`);
        return;
      }
      message.reply({ embeds: [buildRateEmbed(n)] });
      return;
    }

    // !money [bot] [raw] — saldo dari papan skor
    if (command === 'money') {
      const raw = parts.slice(1).some((p) => p.toLowerCase() === 'raw');
      const tag = parts.slice(1).find((p) => /^b?\d+$/i.test(p));
      const targetBots = resolveBots(tag);
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${tag || ''} tidak aktif.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(raw ? '🧾 Papan Skor (mentah)' : '💵 Saldo')
        .setColor(0x2ecc71)
        .setFooter({ text: raw ? 'Isi sidebar apa adanya, dari atas ke bawah' : 'Dibaca dari papan skor di kanan layar' })
        .setTimestamp();

      embed.addFields(
        targetBots.map((bot) => {
          const b = readBoard(bot);
          if (!b.lines.length) {
            return { name: `🟡 ${nameOf(bot)}`, value: 'Papan skor tidak terbaca (bot di lobby / belum dimuat).', inline: false };
          }
          if (raw) {
            return { name: `${nameOf(bot)}${b.title ? ` — ${b.title}` : ''}`, value: '```\n' + b.lines.join('\n').slice(0, 900) + '\n```', inline: false };
          }
          const v = b.values;
          let text = `💵 Money: **${v.money || '-'}**\n💎 Shards: **${v.shards || '-'}**\n🪙 Coins: **${v.coins || '-'}**`;
          if (!v.money && !v.shards) text += '\n\nLabel tidak ditemukan — coba `!money raw` dan kirim hasilnya.';
          return { name: `🟢 ${nameOf(bot)}`, value: text, inline: false };
        })
      );
      message.reply({ embeds: [embed] });
      return;
    }

    // !stop / !start / !restart [bot|all]
    if (command === 'stop' || command === 'start' || command === 'restart') {
      if (command === 'stop' && !parts[1]) {
        message.reply('⚠️ Sebutkan botnya agar tidak mematikan semua tanpa sengaja: `!stop b1` atau `!stop all`.');
        return;
      }
      const tag = parts[1];
      if (tag && tag.toLowerCase() !== 'all' && !accounts.some((a) => a.id === parseInt(tag.replace(/^b/i, '')))) {
        message.reply(`❌ Bot ${tag} tidak ada.`);
        return;
      }
      const icon = { stop: '⏹️', start: '▶️', restart: '🔄' }[command];
      const lines = controlBots(command, tag).map((r) => `${r.ok ? icon : '❌'} ${r.info}`);
      message.reply(lines.join('\n') || '❌ Tidak ada bot yang diproses.');
      return;
    }

    // ---- Teleport & Farm ----
    const tagOrNull = (t) => (!t || t.toLowerCase() === 'all' ? null : t);

    // !tp <b1|all> <pemain|spawn|home [nama]|warp <nama>>
    if (command === 'tp') {
      const tag = (parts[1] || '').toLowerCase();
      if (!(tag === 'all' || /^b\d+$/.test(tag))) {
        message.reply('⚠️ Sebutkan botnya: `!tp b1 <tujuan>` atau `!tp all <tujuan>`.\nTujuan: nama pemain, `spawn`, `home [nama]`, atau `warp <nama>` — contoh `!tp b1 Steve`.');
        return;
      }
      const tp = buildTp(parts.slice(2));
      if (tp.error) {
        message.reply(`❌ ${tp.error}`);
        return;
      }
      const targetBots = resolveBots(tag === 'all' ? null : tag);
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${tag} tidak aktif.`);
        return;
      }
      targetBots.forEach((bot) => {
        if (tp.kind === 'player') cancelAutoReturn(bot); // jangan ditarik kembali ke AFK oleh sesi crates
        bot.chat(tp.cmd);
        if (tp.kind === 'player') watchTeleport(bot, accounts.find((a) => a.id === bot.accId), `TP ${tp.player}`);
      });
      let reply = `🌀 \`${tp.cmd}\` → ${targetBots.map(nameOf).join(', ')}`;
      if (tp.kind === 'player') reply += `\nSetelah ${tp.player} menerima, bot **diam** di sana (tidak lompat, tidak kembali AFK). Kembali: \`!farm <bot>\``;
      message.reply(reply);
      return;
    }

    // !tpaccept [bot|all]
    if (command === 'tpaccept') {
      const targetBots = resolveBots(tagOrNull(parts[1]));
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }
      targetBots.forEach((bot) => {
        bot.chat('/tpaccept');
        watchTeleport(bot, accounts.find((a) => a.id === bot.accId), 'TP'); // kalau bot yang berpindah → diam di sana
      });
      message.reply(`✅ \`/tpaccept\` → ${targetBots.map(nameOf).join(', ')}`);
      return;
    }

    // !pos [bot] — koordinat, lokasi, dan jarak ke titik farm
    if (command === 'pos') {
      const targetBots = resolveBots(tagOrNull(parts[1]));
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }
      const lines = targetBots.map((bot) => {
        const p = posOf(bot);
        const f = farmSpot(bot.accId);
        const dist = p && f ? Math.round(Math.hypot(p.x - f.x, p.z - f.z)) : null;
        return `**${nameOf(bot)}** — ${p ? `X:${p.x} Y:${p.y} Z:${p.z}` : 'posisi belum diketahui'}\n` +
          `📍 ${stats.get(bot.accId).location}` +
          (f ? ` · 🌾 farm X:${f.x} Z:${f.z}${dist !== null ? ` (${dist} blok)` : ''}` : ' · 🌾 farm belum diatur');
      });
      message.reply(lines.join('\n\n'));
      return;
    }

    // !goto <b1> <x> <z>
    if (command === 'goto') {
      const x = parseInt(parts[2]);
      const z = parseInt(parts[3]);
      if (!/^b\d+$/i.test(parts[1] || '') || isNaN(x) || isNaN(z)) {
        message.reply('❌ Format: `!goto <b1> <x> <z>` — contoh `!goto b1 24 11`');
        return;
      }
      const bot = resolveBots(parts[1])[0];
      if (!bot) {
        message.reply(`❌ Bot ${parts[1]} tidak aktif.`);
        return;
      }
      message.reply(`🚶 ${nameOf(bot)} jalan ke X:${x} Z:${z}...`);
      const res = await walkTo(bot, x, z);
      message.channel.send(res.ok ? `✅ **[GOTO]** ${nameOf(bot)}: ${res.info}` : `❌ **[GOTO ERROR]** ${nameOf(bot)}: ${res.info}`).catch(() => {});
      return;
    }

    // !farm [bot|all] — /afk (kalau belum) lalu jalan ke titik farm dan AFK di sana
    if (command === 'farm') {
      const targetBots = resolveBots(tagOrNull(parts[1]));
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }
      message.reply(`🌾 ${targetBots.map(nameOf).join(', ')}: menuju titik farm...`);
      targetBots.forEach(async (bot) => {
        const acc = accounts.find((a) => a.id === bot.accId);
        const res = await goFarm(bot, acc);
        message.channel.send(
          res.ok
            ? `✅ **[FARM]** ${nameOf(bot)}: ${res.info} AFK di farm.`
            : `❌ **[FARM ERROR]** ${nameOf(bot)}: ${res.info}`
        ).catch(() => {});
      });
      return;
    }

    // !setfarm <b1> [x z] — simpan titik farm (tanpa x z = posisi bot sekarang)
    if (command === 'setfarm') {
      if (!/^b\d+$/i.test(parts[1] || '')) {
        message.reply('❌ Format: `!setfarm <b1> [x z]` — tanpa x z = pakai posisi bot sekarang. Cek posisi dengan `!pos`.');
        return;
      }
      const bot = resolveBots(parts[1])[0];
      if (!bot) {
        message.reply(`❌ Bot ${parts[1]} tidak aktif.`);
        return;
      }
      let x = parseInt(parts[2]);
      let z = parseInt(parts[3]);
      if (isNaN(x) || isNaN(z)) {
        const p = posOf(bot);
        if (!p) {
          message.reply('❌ Posisi bot belum diketahui.');
          return;
        }
        x = p.x;
        z = p.z;
      }
      setFarmSpot(bot.accId, x, z);
      message.reply(`🌾 Titik farm ${nameOf(bot)} disimpan: **X:${x} Z:${z}**. Jalankan \`!farm b${bot.accId}\` untuk menuju ke sana.`);
      return;
    }

    // !pay
    if (command === 'pay') {
      const targetPlayer = parts[1];
      const amount = parts[2];
      if (!targetPlayer || !amount) {
        message.reply('❌ Format: `!pay <player> <jumlah> [b1/b2/b3]`');
        return;
      }

      const targetBots = resolveBots(parts[3]);
      if (targetBots.length === 0) {
        message.reply(`❌ Bot ${parts[3] || ''} tidak aktif.`);
        return;
      }

      targetBots.forEach(bot => bot.chat(`/pay ${targetPlayer} ${amount}`));
      message.reply(`💰 \`/pay ${targetPlayer} ${amount}\` → ${targetBots.length} bot.`);
      return;
    }

    // !cmd / !run
    if (command === 'cmd' || command === 'run') {
      const lastArg = parts[parts.length - 1];
      const lastNum = parseInt(lastArg.replace(/^b/i, ''));
      const isTargeted = parts.length > 2 && !isNaN(lastNum) && botMap.has(lastNum);

      const targetBots = isTargeted ? [botMap.get(lastNum)] : Array.from(botMap.values());
      const cmdWords = isTargeted ? parts.slice(1, -1) : parts.slice(1);

      if (targetBots.length === 0 || cmdWords.length === 0) {
        message.reply('❌ Format: `!cmd <perintah_minecraft> [b1/b2/b3]`');
        return;
      }

      const customCmd = cmdWords.join(' ');
      targetBots.forEach(bot => bot.chat(customCmd));
      message.reply(`⚡ \`${customCmd}\` → ${targetBots.length} bot.`);
      return;
    }

    // !say
    if (command === 'say') {
      const lastArg = parts[parts.length - 1];
      const lastNum = parseInt(lastArg.replace(/^b/i, ''));
      const isTargeted = parts.length > 2 && !isNaN(lastNum) && botMap.has(lastNum);

      const targetBots = isTargeted ? [botMap.get(lastNum)] : Array.from(botMap.values());
      const msgWords = isTargeted ? parts.slice(1, -1) : parts.slice(1);

      if (targetBots.length === 0 || msgWords.length === 0) {
        message.reply('❌ Format: `!say <pesan> [b1/b2/b3]`');
        return;
      }

      const chatMsg = msgWords.join(' ');
      targetBots.forEach(bot => bot.chat(chatMsg));
      message.reply(`💬 Chat: "${chatMsg}"`);
      return;
    }
  });

  client.login(discordToken).catch(err => {
    const { log } = require('../core/utils');
    log('DiscordBot', `[ERROR] Login gagal: ${err.message}`);
  });
}

function sendDiscordLog(botName, msg, icon = '') {
  if (!logChannel) return;
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const cleanMsg = msg.replace(/\x1b\[[0-9;]*m/g, '');
  logChannel.send(`\`[${time}]\` **[${botName}]** ${icon} ${cleanMsg}`).catch(() => {});
}

// Perintah admin dari console: server <create|setup|invite>
async function serverAdmin(sub) {
  if (!client || !client.isReady()) return ['Discord belum aktif (isi DISCORD_TOKEN dan tunggu bot online).'];

  if (sub === 'invite') return [`Link undang bot: ${inviteUrl(client)}`];

  if (sub === 'setup') {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) return ['DISCORD_GUILD_ID belum diisi. Undang bot ke servermu, isi ID-nya di .env, lalu ulangi. (Atau: server create)'];
    const res = await setupServer(client, await client.guilds.fetch(guildId));
    await connectChannels(res);
    return [`✅ Struktur server selesai: #${res.liveCh.name}, #${res.logCh.name}, #${res.cmdCh.name}`];
  }

  if (sub === 'create') {
    if (process.env.DISCORD_GUILD_ID) {
      return [
        `Sudah ada server terhubung (DISCORD_GUILD_ID=${process.env.DISCORD_GUILD_ID}).`,
        'Pakai "server setup" untuk memperbaiki strukturnya, atau kosongkan DISCORD_GUILD_ID di .env kalau memang mau membuat server baru.'
      ];
    }
    const res = await createServer(client);
    await connectChannels(res);
    return [
      `✅ Server dibuat: ${res.guild.name} (ID disimpan ke .env)`,
      `🔗 Link undangan (sekali pakai, berlaku 24 jam): ${res.invite}`,
      '👑 Setelah bergabung, ketik  !owner  di server itu supaya kamu jadi pemilik.'
    ];
  }

  return ['Format: server <create|setup|invite>'];
}

module.exports = { initDiscord, sendDiscordLog, serverAdmin };
