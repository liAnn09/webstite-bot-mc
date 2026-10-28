const stats = require('../core/stats');
const { plainText } = require('./items');
const { countShards } = require('../core/utils');

// Nilai yang dicari di papan skor (sidebar kanan layar, terlihat di video: Money, Shards, Coins, Keyall, ...)
const KEYS = [
  { key: 'money', re: /money/i },
  { key: 'shards', re: /shards?/i },
  { key: 'coins', re: /coins?/i },
  { key: 'keyall', re: /key\s*all/i }
];

// Bersihkan kode warna (§a), karakter tak terlihat, dan spasi berlebih
function cleanLine(s) {
  return String(s || '')
    .replace(/§./g, '')
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toText(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.startsWith('{') || s.startsWith('[')) return plainText(s);
  if (s.includes('[object')) return '';
  return s;
}

// Teks satu baris sidebar. Banyak server menyusun baris lewat team (prefix + nama + suffix),
// jadi cek team dulu, baru displayName, baru nama mentah.
function lineText(bot, item) {
  try {
    const team = bot.teamMap && bot.teamMap[item.name];
    if (team && typeof team.displayName === 'function') {
      const t = cleanLine(toText(team.displayName(item.name)));
      if (t) return t;
    }
  } catch (e) {}
  const dn = cleanLine(toText(item.displayName));
  return dn || cleanLine(item.name);
}

// Nilai di samping label, mis. "Money 93.1M" / "Money: 93.1M" / label di satu baris & nilai di baris berikutnya
function findValue(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:·|>=\-–—]+/, '').trim();
    if (rest) return rest;
    const next = lines[i + 1];
    if (next && /^[$\d]/.test(next)) return next;
  }
  return null;
}

// Baca sidebar: { title, lines, values: { money, shards, coins, keyall } }
function readBoard(bot) {
  const out = { title: null, lines: [], values: {} };
  const sb = bot.scoreboard && bot.scoreboard.sidebar;
  if (!sb) return out;

  let items = [];
  try {
    items = sb.items || Object.values(sb.itemsMap || {}).sort((a, b) => b.value - a.value);
  } catch (e) {}

  out.title = cleanLine(toText(sb.title)) || null;
  out.lines = items.map((it) => lineText(bot, it)).filter(Boolean);
  for (const { key, re } of KEYS) {
    const v = findValue(out.lines, re);
    if (v) out.values[key] = v;
  }
  return out;
}

// Angka bulat persis ("9,386" atau "9386"). Format singkat ("9.3K") → null (tidak akurat, jangan dipakai)
function exactInt(s) {
  if (s === null || s === undefined) return null;
  const m = String(s).trim().match(/^\$?(\d[\d,]*)$/);
  return m ? parseInt(m[1].replace(/,/g, '')) : null;
}

// Sinkronkan statistik dari papan skor (dipanggil berkala saat bot di ecocpvp)
function syncFromBoard(bot, acc) {
  if (bot._state !== 'ecocpvp') return;
  const { values } = readBoard(bot);
  const st = stats.get(acc.id);

  if (values.money) st.money = values.money;
  if (values.coins) st.coins = values.coins;

  const n = exactInt(values.shards);
  if (n !== null) {
    st.lastShards = n;
    st.known = true;
    st.boardSeen = true;
    // Saldo awal sesi AFK = saldo pertama yang terbaca (tidak perlu menunggu pesan shard pertama)
    if (st.awal === null && st.afkStart) st.awal = n;
  }
}

// Jumlah shard bot: dari statistik kalau sudah diketahui, kalau belum dari item di inventaris
function shardsOf(bot) {
  const st = stats.get(bot.accId);
  return st.known ? st.lastShards : countShards(bot);
}

// Teks jumlah shard untuk ditampilkan: angka berformat, atau "belum terbaca"
function shardsText(bot) {
  const st = stats.get(bot.accId);
  if (st.known) return st.lastShards.toLocaleString('id-ID');
  const inv = countShards(bot);
  return inv > 0 ? inv.toLocaleString('id-ID') : 'belum terbaca';
}

module.exports = { readBoard, syncFromBoard, exactInt, shardsOf, shardsText, cleanLine, toText };
