const { EmbedBuilder } = require('discord.js');
const { accounts } = require('../core/config');
const { botMap } = require('../core/bot');
const stats = require('../core/stats');

const MIN_MS = 60 * 1000; // butuh data minimal 1 menit supaya estimasi masuk akal

const fmtNum = (n) => Math.round(n).toLocaleString('id-ID');

function fmtDur(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}j ${m}m`;
  if (m) return `${m}m ${s}d`;
  return `${s}d`;
}

// Hitung rate satu akun: gabungan sesi AFK sebelumnya (bank) + sesi yang sedang berjalan
function rateOf(st, now = Date.now()) {
  let gain = st.bankGain;
  let ms = st.bankMs;
  if (st.afkStart && st.awal !== null) {
    gain += st.lastShards - st.awal;
    ms += now - st.afkStart;
  }
  const enough = ms >= MIN_MS;
  const perHour = enough ? gain / (ms / 3600000) : null;
  return { gain, ms, enough, perHour, perDay: perHour === null ? null : perHour * 24 };
}

// Kumpulkan data semua akun (atau satu akun kalau onlyId diisi)
function collect(onlyId = null) {
  const now = Date.now();
  const rows = accounts
    .filter((a) => onlyId === null || a.id === onlyId)
    .map((acc) => {
      const bot = botMap.get(acc.id);
      const online = !!bot && !bot._disconnected;
      return { acc, online, ...rateOf(stats.get(acc.id), now) };
    });

  const totalGain = rows.reduce((s, r) => s + r.gain, 0);
  const rated = rows.filter((r) => r.enough);
  const totalPerHour = rated.reduce((s, r) => s + r.perHour, 0);
  return { rows, totalGain, totalPerHour, ratedCount: rated.length };
}

function line(r) {
  if (!r.enough) {
    return r.ms > 0
      ? `+${fmtNum(r.gain)} shards dalam ${fmtDur(r.ms)} · belum cukup data (min. 1 menit)`
      : 'Belum ada data (bot belum AFK / saldo awal belum terbaca)';
  }
  return `+${fmtNum(r.gain)} shards dalam ${fmtDur(r.ms)}\n≈ **${fmtNum(r.perHour)}**/jam · ≈ ${fmtNum(r.perDay)}/hari`;
}

function buildRateEmbed(onlyId = null) {
  const { rows, totalGain, totalPerHour, ratedCount } = collect(onlyId);

  const embed = new EmbedBuilder()
    .setTitle('📈 Rate Shard')
    .setColor(ratedCount > 0 ? 0x2ecc71 : 0x95a5a6)
    .setDescription(
      ratedCount > 0
        ? `💎 Total didapat **${fmtNum(totalGain)}** shards\n≈ **${fmtNum(totalPerHour)}**/jam · ≈ **${fmtNum(totalPerHour * 24)}**/hari${onlyId === null ? ' (semua bot)' : ''}`
        : `💎 Total didapat **${fmtNum(totalGain)}** shards\nBelum cukup data untuk estimasi — tunggu bot AFK minimal 1 menit.`
    )
    .addFields(
      rows.map((r) => ({
        name: `${r.online ? (r.enough ? '🟢' : '🟡') : '🔴'} ${r.acc.username}`,
        value: line(r),
        inline: false
      }))
    )
    .setFooter({ text: 'Dihitung dari semua sesi AFK sejak bot dijalankan' })
    .setTimestamp();

  return embed;
}

// Versi teks untuk console
function rateText(onlyId = null) {
  const { rows, totalGain, totalPerHour, ratedCount } = collect(onlyId);
  const out = ['', '── Rate Shard ──'];
  rows.forEach((r) => {
    out.push(`  ${r.online ? '●' : '○'} ${r.acc.username}: ${line(r).replace(/\*\*/g, '').replace('\n', ' · ')}`);
  });
  out.push(
    ratedCount > 0
      ? `  Total: +${fmtNum(totalGain)} shards · ≈ ${fmtNum(totalPerHour)}/jam · ≈ ${fmtNum(totalPerHour * 24)}/hari`
      : `  Total: +${fmtNum(totalGain)} shards (belum cukup data untuk estimasi)`
  );
  out.push('');
  return out.join('\n');
}

module.exports = { rateOf, buildRateEmbed, rateText };
