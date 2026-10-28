const { EmbedBuilder } = require('discord.js');
const { botMap } = require('../core/bot');
const { accounts } = require('../core/config');
const { cleanLine, toText } = require('./board');

// Nama pemain Java: 3-16 karakter huruf/angka/_ ; titik di depan = pemain Bedrock.
// Entri tab list lain (NPC, pemisah, hiasan) disaring.
const NAME_RE = /^[A-Za-z0-9_.]{1,16}$/;

const SERVER_LABEL = { ecocpvp: 'ECOCPVP', lobby: 'LOBBY', joining: 'perpindahan' };

const botNames = () => new Set(accounts.map((a) => a.username.toLowerCase()));

// Bot mana yang dipakai membaca tab list: tag (b1) → bot itu; tanpa tag → bot online yang ada di ecocpvp
function pickPlayersBot(tag) {
  if (tag) {
    const bot = botMap.get(parseInt(String(tag).replace(/^b/i, '')));
    return bot && !bot._disconnected ? bot : null;
  }
  const online = Array.from(botMap.values()).filter((b) => !b._disconnected);
  return online.find((b) => b._state === 'ecocpvp') || online[0] || null;
}

// Semua pemain dari tab list bot: [{ name, ping, isBot }] urut abjad
function listPlayers(bot) {
  const mine = botNames();
  return Object.values(bot.players || {})
    .filter((p) => p && NAME_RE.test(p.username || ''))
    .map((p) => ({
      name: p.username,
      ping: typeof p.ping === 'number' ? p.ping : null,
      isBot: mine.has(p.username.toLowerCase())
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// Foto keadaan server: null kalau tidak ada bot online
function snapshot(tag = null) {
  const bot = pickPlayersBot(tag);
  if (!bot) return null;
  const all = listPlayers(bot);
  return {
    bot,
    all,
    real: all.filter((p) => !p.isBot),
    bots: all.filter((p) => p.isBot),
    server: SERVER_LABEL[bot._state] || 'server'
  };
}

const botName = (bot) => accounts.find((a) => a.id === bot.accId)?.username || 'Bot';

// Susun nama jadi kolom rata kiri (untuk kotak kode Discord / console)
function columns(items, cols = 3) {
  const width = Math.min(Math.max(...items.map((s) => s.length)) + 2, 20);
  const rows = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols).map((s) => s.padEnd(width)).join('').trimEnd());
  }
  return rows;
}

// Pecah baris jadi beberapa bagian ≤ limit huruf (batas deskripsi embed Discord)
function chunkLines(lines, limit = 1800) {
  const chunks = [];
  let cur = '';
  for (const l of lines) {
    if ((cur + l + '\n').length > limit) {
      chunks.push(cur);
      cur = '';
    }
    cur += l + '\n';
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const MAX_EMBEDS = 4;

// Embed untuk !players. search = kata kunci nama (kosong = tampilkan semua)
function buildPlayersEmbeds(snap, search = '') {
  const note = snap.bot._state === 'ecocpvp'
    ? ''
    : `\n⚠️ Bot sedang di **${snap.server}**, jadi ini daftar pemain di sana (bukan ecocpvp).`;
  const from = `dari ${botName(snap.bot)} · ${snap.server}`;

  // ---- cari nama ----
  if (search) {
    const q = search.toLowerCase();
    const hits = snap.all.filter((p) => p.name.toLowerCase().includes(q));
    const lines = hits.slice(0, 25).map((p) =>
      `${p.isBot ? '🤖' : '🟢'} **${p.name}**${p.ping !== null ? ` — ${p.ping}ms` : ''}${p.isBot ? ' (bot kita)' : ''}`
    );
    if (hits.length > 25) lines.push(`…dan ${hits.length - 25} lainnya`);
    return [
      new EmbedBuilder()
        .setColor(hits.length ? 0x2ecc71 : 0xe74c3c)
        .setTitle(`🔎 Cari "${search}"`)
        .setDescription((hits.length ? lines.join('\n') : `❌ Tidak ada pemain dengan nama itu di ${snap.server}.`) + note)
        .setFooter({ text: from })
        .setTimestamp()
    ];
  }

  // ---- daftar lengkap ----
  const head =
    `**${snap.real.length}** pemain online` +
    (snap.bots.length ? ` + ${snap.bots.length} bot kita` : '') +
    ` · ${from}${note}`;

  if (!snap.all.length) {
    return [new EmbedBuilder().setColor(0x95a5a6).setTitle('👥 Pemain Online').setDescription(head + '\n\nDaftar pemain kosong / belum dimuat.').setTimestamp()];
  }

  const names = snap.all.map((p) => (p.isBot ? `${p.name}*` : p.name));
  const chunks = chunkLines(columns(names));
  const shown = chunks.slice(0, MAX_EMBEDS);

  const embeds = shown.map((c, i) => {
    const e = new EmbedBuilder().setColor(0x5865f2).setDescription((i === 0 ? head + '\n\n' : '') + '```\n' + c + '```');
    if (i === 0) e.setTitle('👥 Pemain Online');
    if (i === shown.length - 1) {
      e.setFooter({ text: (snap.bots.length ? '* = akun bot kita · ' : '') + 'dari tab list server' + (chunks.length > MAX_EMBEDS ? ' · daftar dipotong' : '') }).setTimestamp();
    }
    return e;
  });
  return embeds;
}

// ====== Tab list: tampilan dibuat semirip tab asli di game ======

// Escape karakter markdown Discord supaya nama seperti Zyy_97_65 tidak jadi huruf miring
const esc = (s) => String(s).replace(/([\\*_~`|>])/g, '\\$1');

// Teks beberapa baris (header/footer tab) → array baris bersih
function tabLines(x) {
  if (!x) return [];
  return toText(x).split('\n').map(cleanLine).filter(Boolean);
}

// Nama yang tampil di tab: display name dari server (rank/prefix), atau prefix+nama+suffix dari team, atau nama asli
function tabName(bot, p, team) {
  const raw = toText(p.displayName);
  const dn = cleanLine(raw);
  if (dn && dn !== p.username) return dn;
  // Display name ada tapi isinya kosong (spasi / kode warna saja) = server sengaja menyembunyikan entri ini di tab
  if (raw && !dn) return '';
  try {
    if (team && typeof team.displayName === 'function') {
      const t = cleanLine(toText(team.displayName(p.username)));
      if (t) return t;
    }
  } catch (e) {}
  return dn || cleanLine(p.username);
}

// Semua entri tab, urutannya sama seperti klien Minecraft:
// spectator paling bawah → nama team (urutan abjad) → nama pemain (tanpa peduli huruf besar/kecil).
// Entri tanpa teks (kosong) dibuang.
function tabEntries(bot) {
  const mine = botNames();
  const entries = Object.values(bot.players || {})
    .filter((p) => p && p.username !== undefined)
    .map((p) => {
      const team = bot.teamMap && bot.teamMap[p.username];
      return {
        username: p.username || '',
        text: tabName(bot, p, team),
        team: team && team.team ? String(team.team) : '',
        spectator: p.gamemode === 3,
        isBot: mine.has(String(p.username || '').toLowerCase())
      };
    })
    .filter((e) => e.text && e.text.trim() !== '');

  entries.sort((a, b) => {
    if (a.spectator !== b.spectator) return a.spectator ? 1 : -1;
    if (a.team !== b.team) return a.team < b.team ? -1 : 1;
    return a.username.toLowerCase().localeCompare(b.username.toLowerCase());
  });
  return entries;
}

const TAB_MAX = 80; // klien Minecraft hanya menampilkan 80 entri

// Embed tab: header server di atas, kolom nama (isi per kolom dari atas ke bawah seperti tab asli), footer di bawah
function buildTabEmbed(snap, opts = {}) {
  const bot = snap.bot;
  const entries = tabEntries(bot);
  const shown = entries.slice(0, TAB_MAX);
  const extra = entries.length - shown.length;

  const header = tabLines(bot.tablist && bot.tablist.header);
  const footer = tabLines(bot.tablist && bot.tablist.footer);

  // Hitung dari entri yang tampil di tab (nama pemain valid; akun bot kita dipisah)
  const realCount = entries.filter((e) => NAME_RE.test(e.username) && !e.isBot).length;
  const botCount = entries.filter((e) => e.isBot).length;
  const count =
    `**${realCount}** pemain` +
    (botCount ? ` + ${botCount} bot kita` : '') +
    ` · ${snap.server} · dari ${botName(bot)}`;
  const desc = [];
  if (header.length) desc.push(header.map((l) => `**${esc(l)}**`).join('\n'));
  desc.push(count);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Tab Server')
    .setTimestamp();

  if (!shown.length) {
    embed.setDescription(desc.join('\n\n') + '\n\nTab list kosong / belum dimuat.');
  } else {
    embed.setDescription(desc.join('\n\n'));

    // Aturan klien: tambah kolom sampai tiap kolom ≤ 20 baris. Discord maksimal 3 kolom sebaris.
    let cols = 1;
    while (Math.ceil(shown.length / cols) > 20 && cols < 4) cols++;
    cols = Math.min(cols, 3);
    const rows = Math.ceil(shown.length / cols);

    const fields = [];
    for (let c = 0; c < cols; c++) {
      const chunk = shown.slice(c * rows, (c + 1) * rows);
      if (!chunk.length) continue;
      const lines = chunk.map((e) => {
        const t = e.text.length > 30 ? e.text.slice(0, 29) + '…' : e.text;
        return esc(t) + (e.isBot ? ' [bot]' : '');
      });
      fields.push({ name: '\u200b', value: lines.join('\n').slice(0, 1024), inline: cols > 1 });
    }
    embed.addFields(fields);
  }

  const foot = footer.join(' · ').slice(0, 200);
  const tail = [foot || 'Sesuai tab list server', extra > 0 ? `+${extra} lainnya` : '', opts.live ? 'diperbarui otomatis' : ''].filter(Boolean);
  embed.setFooter({ text: tail.join(' · ') });
  return embed;
}

// Embed untuk !live (dipisah dari embed status bot)
function liveEmbed(snap) {
  if (!snap) return null;
  return buildTabEmbed(snap, { live: true });
}

// Versi teks untuk console
function playersText(snap, search = '') {
  const out = [''];
  if (search) {
    const q = search.toLowerCase();
    const hits = snap.all.filter((p) => p.name.toLowerCase().includes(q));
    out.push(`── Cari "${search}" (${snap.server}, dari ${botName(snap.bot)}) ──`);
    if (!hits.length) out.push('  Tidak ditemukan.');
    hits.slice(0, 25).forEach((p) => out.push(`  ${p.isBot ? '🤖' : '●'} ${p.name}${p.ping !== null ? ` — ${p.ping}ms` : ''}`));
  } else {
    out.push(`── Pemain online: ${snap.real.length}${snap.bots.length ? ` (+${snap.bots.length} bot)` : ''} · ${snap.server}, dari ${botName(snap.bot)} ──`);
    if (!snap.all.length) out.push('  (kosong / belum dimuat)');
    else columns(snap.all.map((p) => (p.isBot ? `${p.name}*` : p.name))).forEach((l) => out.push('  ' + l));
    if (snap.bots.length) out.push('  * = akun bot kita');
  }
  out.push('');
  return out.join('\n');
}

module.exports = { snapshot, pickPlayersBot, listPlayers, buildPlayersEmbeds, liveEmbed, buildTabEmbed, tabEntries, playersText };
