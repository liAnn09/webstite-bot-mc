const { EmbedBuilder, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { saveEnv } = require('./envFile');
const { buildHelpEmbed } = require('./helpEmbed');

// ====== Struktur server ======
//
//  📌 INFO       (semua orang bisa baca)
//     📖-panduan
//  📊 MONITOR    (Viewer & Operator: hanya baca)
//     📈-live       status semua bot, diperbarui otomatis
//     📜-bot-log    log console bot
//  🎮 KONTROL    (hanya Operator)
//     🎮-bot-command
//
const ROLE_OPERATOR = '🤖 Operator';
const ROLE_VIEWER = '👀 Viewer';

const CAT_INFO = '📌 INFO';
const CAT_MONITOR = '📊 MONITOR';
const CAT_CONTROL = '🎮 KONTROL';

const CH_GUIDE = { name: '📖-panduan', topic: 'Panduan pemakaian & daftar command bot RelxMC.' };
const CH_LIVE = { name: '📈-live', topic: 'Status semua bot — diperbarui otomatis.' };
const CH_LOG = { name: '📜-bot-log', topic: 'Log console bot RelxMC secara real-time.' };
const CH_CMD = { name: '🎮-bot-command', topic: 'Kirim command ke bot. Awali dengan ! atau [ ]. Ketik !help untuk daftar command.' };

// Izin yang dibutuhkan bot supaya setup ini bisa jalan (dipakai untuk link undangan)
const BOT_INVITE_PERMISSIONS = [
  P.ManageChannels, P.ManageRoles, P.ViewChannel, P.SendMessages,
  P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages, P.AttachFiles, P.CreateInstantInvite
];

// Izin bot di semua channel miliknya (harus izin yang dimiliki bot sendiri)
const BOT_CHANNEL_ALLOW = [
  P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages, P.AttachFiles
];

function logger() {
  return require('../core/utils').log;
}

// Link undangan bot dengan izin yang dibutuhkan
function inviteUrl(client) {
  return client.generateInvite({ scopes: ['bot'], permissions: BOT_INVITE_PERMISSIONS });
}

async function ensureRole(guild, name, color) {
  let role = guild.roles.cache.find((r) => r.name === name);
  if (!role) {
    role = await guild.roles.create({ name, color, hoist: true, mentionable: false, reason: 'RelxMC Bot setup' });
    logger()('DiscordBot', `Role "${name}" dibuat.`);
  }
  return role;
}

// Cari role berdasarkan kata kunci: operator | viewer (pakai ID di .env kalau ada, kalau tidak berdasarkan nama)
function findRole(guild, key) {
  const k = String(key || '').toLowerCase();
  const isOp = k === 'operator' || k === 'op';
  const isViewer = k === 'viewer' || k === 'view';
  if (!isOp && !isViewer) return null;
  const envId = isOp ? process.env.DISCORD_OPERATOR_ROLE_ID : process.env.DISCORD_VIEWER_ROLE_ID;
  const name = isOp ? ROLE_OPERATOR : ROLE_VIEWER;
  return (envId && guild.roles.cache.get(envId)) || guild.roles.cache.find((r) => r.name === name) || null;
}

async function ensureCategory(guild, name, overwrites) {
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (!cat) {
    cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites });
    logger()('DiscordBot', `Kategori "${name}" dibuat.`);
  } else {
    await cat.edit({ permissionOverwrites: overwrites });
  }
  return cat;
}

// Cari channel teks dengan nama itu (di mana saja) → pakai ulang & perbaiki izinnya. Kalau belum ada → buat.
async function ensureText(guild, def, parent, overwrites) {
  let ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === def.name);
  if (!ch) {
    ch = await guild.channels.create({
      name: def.name,
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: def.topic,
      permissionOverwrites: overwrites
    });
    logger()('DiscordBot', `Channel "#${ch.name}" dibuat.`);
  } else {
    await ch.edit({ parent: parent.id, topic: def.topic, permissionOverwrites: overwrites });
  }
  return ch;
}

// Hapus pesan lama milik bot di channel (supaya tidak menumpuk tiap setup / restart)
async function cleanBotMessages(client, channel) {
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    for (const m of msgs.values()) {
      if (m.author && m.author.id === client.user.id) await m.delete().catch(() => {});
    }
  } catch (e) {}
}

function buildWelcomeEmbed(guild, ch) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('⛏️ Selamat datang di RelxMC Bot')
    .setDescription('Server ini dipakai untuk memantau dan mengontrol bot AFK RelxMC.')
    .addFields(
      {
        name: '📂 Channel',
        value: [
          `${ch.live} — status semua bot (otomatis)`,
          `${ch.log} — log console real-time`,
          `${ch.cmd} — kirim command ke bot`
        ].join('\n')
      },
      {
        name: '🎭 Role',
        value: [
          `**${ROLE_OPERATOR}** — boleh mengirim command ke bot`,
          `**${ROLE_VIEWER}** — hanya boleh melihat status & log`
        ].join('\n')
      },
      {
        name: '🚀 Mulai',
        value: `Buka ${ch.cmd} lalu ketik \`!help\`. Untuk status live manual: \`!live 10\`.`
      }
    )
    .setFooter({ text: guild.name });
}

// Bangun / perbaiki seluruh struktur server. Aman dijalankan berulang (tidak membuat duplikat).
// opts.member = anggota yang menjalankan → otomatis diberi role Operator.
async function setupServer(client, guild, opts = {}) {
  const log = logger();
  log('DiscordBot', `Membangun struktur server "${guild.name}"...`);

  await guild.roles.fetch();
  await guild.channels.fetch();

  const operator = await ensureRole(guild, ROLE_OPERATOR, 0x5865f2);
  const viewer = await ensureRole(guild, ROLE_VIEWER, 0x95a5a6);
  const everyone = guild.roles.everyone.id;
  const botAllow = { id: client.user.id, allow: BOT_CHANNEL_ALLOW };

  // INFO: semua orang boleh baca, tidak boleh kirim
  const owInfo = [
    { id: everyone, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] },
    botAllow
  ];
  // MONITOR: hanya Viewer & Operator, baca saja
  const owMonitor = [
    { id: everyone, deny: [P.ViewChannel] },
    { id: viewer.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] },
    { id: operator.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] },
    botAllow
  ];
  // KONTROL: hanya Operator, boleh kirim command
  const owControl = [
    { id: everyone, deny: [P.ViewChannel] },
    { id: operator.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks] },
    botAllow
  ];

  const catInfo = await ensureCategory(guild, CAT_INFO, owInfo);
  const catMonitor = await ensureCategory(guild, CAT_MONITOR, owMonitor);
  const catControl = await ensureCategory(guild, CAT_CONTROL, owControl);

  const guideCh = await ensureText(guild, CH_GUIDE, catInfo, owInfo);
  const liveCh = await ensureText(guild, CH_LIVE, catMonitor, owMonitor);
  const logCh = await ensureText(guild, CH_LOG, catMonitor, owMonitor);
  const cmdCh = await ensureText(guild, CH_CMD, catControl, owControl);

  // Orang yang menjalankan setup langsung jadi Operator
  if (opts.member) {
    try {
      await opts.member.roles.add(operator);
    } catch (e) {
      log('DiscordBot', `[ERROR] Gagal memberi role Operator: ${e.message}`);
    }
  }

  // Panduan: bersihkan pesan lama bot, posting yang baru, lalu pin
  await cleanBotMessages(client, guideCh);
  try {
    const welcome = await guideCh.send({ embeds: [buildWelcomeEmbed(guild, { live: liveCh, log: logCh, cmd: cmdCh })] });
    await guideCh.send({ embeds: [buildHelpEmbed(client)] });
    await welcome.pin().catch(() => {});
  } catch (e) {
    log('DiscordBot', `[ERROR] Gagal mengirim panduan: ${e.message}`);
  }

  // Simpan ID ke .env (dan process.env) supaya tidak dibuat ulang saat restart
  saveEnv(
    {
      DISCORD_GUILD_ID: guild.id,
      DISCORD_LOG_CHANNEL_ID: logCh.id,
      DISCORD_CMD_CHANNEL_ID: cmdCh.id,
      DISCORD_LIVE_CHANNEL_ID: liveCh.id,
      DISCORD_OPERATOR_ROLE_ID: operator.id,
      DISCORD_VIEWER_ROLE_ID: viewer.id
    },
    { LIVE_AUTO_SECONDS: 10 } // live otomatis tiap 10 detik, kecuali kamu sudah mengatur sendiri
  );
  log('DiscordBot', 'Struktur server selesai & ID disimpan ke .env.');

  return { guild, guideCh, liveCh, logCh, cmdCh, operator, viewer };
}

// Bot membuat server baru sendiri (bisa kalau bot ada di kurang dari 10 server),
// lengkap dengan struktur di atas + link undangan sekali pakai.
async function createServer(client) {
  const guild = await client.guilds.create({ name: '⛏️ RelxMC Bot' });
  const res = await setupServer(client, guild);
  const invite = await res.guideCh.createInvite({ maxAge: 24 * 3600, maxUses: 1, unique: true });
  return { ...res, invite: invite.url };
}

// Listener perintah admin: !setup (bangun/perbaiki struktur) dan !owner (ambil alih kepemilikan server buatan bot)
// hooks.onSetup(res) dipanggil setelah setup selesai (untuk menyambungkan channel log/command yang baru).
function initSetup(client, hooks = {}) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const text = message.content.trim().toLowerCase();

    // !owner — hanya berlaku di server yang dibuat bot dan masih dimiliki bot
    if (text === '!owner' || text === '[owner]') {
      if (message.guild.ownerId !== client.user.id) {
        message.reply('ℹ️ Server ini sudah punya pemilik, tidak perlu `!owner`.').catch(() => {});
        return;
      }
      try {
        await message.guild.setOwner(message.author, 'Serah terima server buatan bot');
        const opRole = findRole(message.guild, 'operator');
        if (opRole && message.member) message.member.roles.add(opRole).catch(() => {});
        message.reply('👑 Kamu sekarang **owner** server ini. Selamat memakai!').catch(() => {});
      } catch (e) {
        message.reply(`❌ Gagal memindahkan kepemilikan: ${e.message}`).catch(() => {});
      }
      return;
    }

    // !role add|remove <@user|id> <operator|viewer> — hanya admin
    if (/^(!|\[)role(\s|\]|$)/.test(text)) {
      if (!(message.member && message.member.permissions.has('Administrator'))) {
        message.reply('⛔ Hanya admin server yang bisa mengatur role.').catch(() => {});
        return;
      }
      const tokens = message.content.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/^!/, '').split(/\s+/);
      const sub = (tokens[1] || '').toLowerCase();
      const roleKey = (tokens[3] || '').toLowerCase();
      if (!['add', 'remove'].includes(sub) || !tokens[2] || !roleKey) {
        message.reply('ℹ️ Format: `!role add <@user> <operator|viewer>` atau `!role remove <@user> <operator|viewer>`').catch(() => {});
        return;
      }
      const role = findRole(message.guild, roleKey);
      if (!role) {
        message.reply(`❌ Role "${roleKey}" tidak dikenal. Pilih **operator** atau **viewer** (belum ada? jalankan \`!setup\` dulu).`).catch(() => {});
        return;
      }
      let member = message.mentions && message.mentions.members && message.mentions.members.first();
      if (!member) {
        const id = (tokens[2].match(/\d{15,22}/) || [])[0];
        if (id) member = await message.guild.members.fetch(id).catch(() => null);
      }
      if (!member) {
        message.reply('❌ Pengguna tidak ditemukan. Mention orangnya (@nama) atau pakai ID-nya.').catch(() => {});
        return;
      }
      try {
        if (sub === 'add') await member.roles.add(role);
        else await member.roles.remove(role);
        message.reply(`${sub === 'add' ? '✅' : '➖'} ${member} ${sub === 'add' ? 'sekarang punya' : 'tidak lagi punya'} role **${role.name}**.`).catch(() => {});
      } catch (e) {
        message.reply(`❌ Gagal: ${e.message}. Role bot harus berada di atas role ini (Server Settings → Roles).`).catch(() => {});
      }
      return;
    }

    // !setup — hanya admin
    if (text === '!setup' || text === '[setup]') {
      const isAdmin = message.member && message.member.permissions.has('Administrator');
      if (!isAdmin) {
        message.reply('⛔ Hanya admin server yang bisa menjalankan `!setup`.').catch(() => {});
        return;
      }
      const wait = await message.reply('🛠️ Membangun struktur server...').catch(() => null);
      try {
        const res = await setupServer(client, message.guild, { member: message.member });
        if (hooks.onSetup) await hooks.onSetup(res);
        const done = `✅ Selesai! Channel: ${res.liveCh} · ${res.logCh} · ${res.cmdCh}\nKamu sudah diberi role **${ROLE_OPERATOR}**.`;
        if (wait) await wait.edit(done).catch(() => {});
      } catch (e) {
        const msg = `❌ Setup gagal: ${e.message}\nPastikan bot punya izin **Manage Channels** & **Manage Roles**, dan role bot berada di atas role lain.`;
        if (wait) await wait.edit(msg).catch(() => {});
      }
    }
  });
}

module.exports = { setupServer, createServer, initSetup, inviteUrl, cleanBotMessages, ROLE_OPERATOR, ROLE_VIEWER };
