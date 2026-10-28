const { EmbedBuilder } = require('discord.js');
const { botMap } = require('../core/bot');
const { accounts } = require('../core/config');
const S = require('../features/spawner');

const ORANGE = 0xe67e22;

const nameOf = (bot) => accounts.find((a) => a.id === bot.accId)?.username || 'Bot';
const accOf = (bot) => accounts.find((a) => a.id === bot.accId);
const fmt = (n) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('id-ID'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = (sec) => `${Math.floor(sec / 60)} menit ${sec % 60} detik`;

// Bot target. tag: b1 | all | kosong.
//  needTag = true (perintah yang mengubah sesuatu): tanpa tag hanya diterima kalau cuma ada 1 bot online di ecocpvp
function targets(tag, needTag) {
  const online = Array.from(botMap.values()).filter((b) => !b._disconnected);
  if (tag && tag.toLowerCase() === 'all') return online;
  if (tag) {
    const b = botMap.get(parseInt(String(tag).replace(/^b/i, '')));
    return b && !b._disconnected ? [b] : [];
  }
  const eco = online.filter((b) => b._state === 'ecocpvp');
  return needTag ? (eco.length === 1 ? eco : []) : eco;
}

// ---- tampilan ----

function statusEmbed(results) {
  const embed = new EmbedBuilder().setColor(ORANGE).setTitle('Spawner')
    .setFooter({ text: 'Jumlah bone dibaca dari tooltip Spawner Storage' }).setTimestamp();
  embed.addFields(
    results.map(({ bot, res }) => {
      const acc = accOf(bot);
      const s = S.getSettings(acc.id);
      if (!res.ok) return { name: nameOf(bot), value: `Gagal: ${res.info}`, inline: false };
      const gap = s.threshold - res.count;
      const batas = gap <= 0 ? `${fmt(s.threshold)}  (sudah tercapai)` : `${fmt(s.threshold)}  (kurang ${fmt(gap)})`;
      return {
        name: nameOf(bot),
        value:
          `**Bone** ${fmt(res.count)}\n` +
          `**Batas drop** ${batas}\n` +
          `**Auto** ${s.auto ? 'aktif' : 'mati'}${s.auto ? ' (kalau batas tercapai, bone dibuang otomatis)' : ''}`,
        inline: false
      };
    })
  );
  return embed;
}

function dropSummary(bot, d) {
  const head = d.ok ? 'Drop selesai' : 'Drop berhenti';
  const lines = [
    `${head}: ${nameOf(bot)}`,
    `Bone: ${fmt(d.before)} → ${fmt(d.after)}${d.dropped !== null ? `  (dibuang ${fmt(d.dropped)})` : ''}`,
    `${d.rounds} ronde, ${d.clicks} klik Drop Loot, ${clock(d.seconds)}`
  ];
  if (!d.ok) lines.push(`Alasan: ${d.info}`);
  return lines.join('\n');
}

// ---- command ----

// !spawner [bot]                    → jumlah bone + batas + status auto
// !spawner drop <bot>               → buang bone sekarang (sampai storage habis / sisa ≤ SPAWNER_KEEP)
// !spawner auto on|off <bot|all>    → pantau otomatis, drop saat batas tercapai
// !spawner limit <jumlah> <bot|all> → ubah batas (mis. 500000, 500k, 0.5m)
// !spawner stop [bot]               → hentikan drop yang sedang berjalan
async function spawnerCommand(message, args) {
  const SUBS = ['drop', 'auto', 'limit', 'stop', 'status'];
  const first = (args[0] || '').toLowerCase();
  const sub = SUBS.includes(first) ? first : 'status';
  const rest = SUBS.includes(first) ? args.slice(1) : args;
  const tag = rest.find((a) => /^(b\d+|all)$/i.test(a));
  const others = rest.filter((a) => a !== tag);

  // ---------- status ----------
  if (sub === 'status') {
    const bots = targets(tag, false);
    if (!bots.length) return message.reply(tag ? `Bot ${tag} tidak aktif.` : 'Tidak ada bot online di ecocpvp.');
    const wait = await message.reply(`Membaca jumlah bone dari ${bots.length} bot... (bot membuka GUI spawner sebentar)`);
    const results = await Promise.all(
      bots.map(async (bot, i) => {
        await sleep(i * 1200);
        return { bot, res: await S.readCount(bot, accOf(bot)) };
      })
    );
    return wait.edit({ content: '', embeds: [statusEmbed(results)] }).catch(() => {});
  }

  // ---------- drop ----------
  if (sub === 'drop') {
    const bots = targets(tag, true);
    if (bots.length !== 1) {
      return message.reply(tag ? `Bot ${tag} tidak aktif.` : 'Sebutkan botnya: `!spawner drop b1` (drop memengaruhi satu bot saja).');
    }
    const bot = bots[0];
    const acc = accOf(bot);
    const s = S.getSettings(acc.id);
    const wait = await message.reply(
      `Drop bone dimulai untuk ${nameOf(bot)} (sisa yang dipertahankan: ${fmt(s.keep)}).\n` +
      'Prosesnya bisa 15-20 menit untuk ratusan ribu bone. Laporan menyusul setelah selesai. Hentikan dengan `!spawner stop`.'
    );
    const d = await S.dropSession(bot, acc, { keep: s.keep });
    if (d.info && d.before === undefined) return wait.edit(`Gagal: ${d.info}`).catch(() => {}); // ditolak sebelum mulai (bot sibuk dll.)
    return wait.edit(dropSummary(bot, d)).catch(() => {});
  }

  // ---------- auto ----------
  if (sub === 'auto') {
    const mode = (others[0] || '').toLowerCase();
    if (mode !== 'on' && mode !== 'off') return message.reply('Format: `!spawner auto on|off <b1|all>`');
    const bots = targets(tag, true);
    if (!bots.length) return message.reply(tag ? `Bot ${tag} tidak aktif.` : 'Sebutkan botnya: `!spawner auto on b1` atau `all`.');
    const on = mode === 'on';
    bots.forEach((bot) => S.saveSettings(accOf(bot).id, { auto: on }));
    await message.reply(
      `Pantau spawner ${on ? 'AKTIF' : 'MATI'}: ${bots.map(nameOf).join(', ')}.` +
      (on ? '\nKalau bone sudah mencapai batas, drop langsung berjalan. Cek berikutnya tiap beberapa menit.' : '')
    );
    if (on) {
      for (const bot of bots) {
        if (S.eligible(bot, accOf(bot))) {
          S.checkOnce(bot, accOf(bot)).catch(() => {}); // cek pertama langsung; hasilnya muncul di log
        }
      }
    }
    return;
  }

  // ---------- limit ----------
  if (sub === 'limit') {
    const amount = S.parseAmount(others[0]);
    if (amount === null || amount < 1) return message.reply('Format: `!spawner limit <jumlah> <b1|all>` — contoh `!spawner limit 500000 b1` atau `500k`.');
    const bots = targets(tag, true);
    if (!bots.length) return message.reply(tag ? `Bot ${tag} tidak aktif.` : 'Sebutkan botnya: `!spawner limit 500k b1` atau `all`.');
    bots.forEach((bot) => S.saveSettings(accOf(bot).id, { threshold: amount }));
    return message.reply(`Batas drop ${bots.map(nameOf).join(', ')} diubah menjadi ${fmt(amount)} bone.`);
  }

  // ---------- stop ----------
  if (sub === 'stop') {
    const bots = targets(tag, true);
    if (!bots.length) return message.reply(tag ? `Bot ${tag} tidak aktif.` : 'Sebutkan botnya: `!spawner stop b1`.');
    const stopped = bots.filter((b) => S.stopDrop(b));
    return message.reply(stopped.length ? `Drop dihentikan: ${stopped.map(nameOf).join(', ')} (selesai setelah klik yang sedang berjalan).` : 'Tidak ada drop yang sedang berjalan.');
  }
}

module.exports = { spawnerCommand };
