const { log } = require('../core/utils');
const stats = require('../core/stats');

// Home memakai command server (gaya Essentials): /sethome <nama> · /home [nama] · /delhome <nama> · /homes
// Bot mengirim command lalu membaca balasan server selama beberapa detik, dan melaporkannya apa adanya.

const NAME_RE = /^[A-Za-z0-9_\-]{1,32}$/;
const WINDOW_MS = 3500;

// Baris chat yang kemungkinan balasan untuk command home (bukan obrolan pemain / pengumuman server)
const RELEVANT = /home|teleport|cooldown|permission|not allowed|don.?t have|do not have|limit|too many|already|exist|invalid|no such|must wait/i;
const NOISE = /entities will be removed|vote|next shard|shards?!/i;
// Tanda command ditolak
const FAIL = /not found|doesn.?t exist|does not exist|no such|invalid|don.?t have|do not have|cannot|can.?t|not allowed|limit|too many|permission|already|must wait|cooldown|unknown/i;

const NO_REPLY = 'Perintah terkirim, tapi belum ada balasan yang jelas dari server. Cek di game.';

// Kirim command, kumpulkan balasan server selama WINDOW_MS
function sendAndCollect(bot, username, cmd, windowMs = WINDOW_MS) {
  return new Promise((resolve) => {
    const lines = [];
    const onMsg = (jm) => {
      const t = jm.toString().trim();
      if (t && RELEVANT.test(t) && !NOISE.test(t)) lines.push(t);
    };
    bot.on('message', onMsg);
    log(username, `[HOME] ${cmd}`);
    bot.chat(cmd);
    setTimeout(() => {
      bot.removeListener('message', onMsg);
      resolve(lines);
    }, windowMs);
  });
}

function guard(bot, acc) {
  if (bot._disconnected) return { ok: false, info: 'Bot tidak aktif.' };
  if (bot._state !== 'ecocpvp') return { ok: false, info: 'Bot belum berada di ecocpvp.' };
  if (bot._homeBusy || bot._crateBusy || bot._walking || bot._buying || bot._selling) {
    return { ok: false, info: 'Bot sedang sibuk (home/crate/beli/jual/berjalan), coba lagi sebentar.' };
  }
  return null;
}

function validName(name, required) {
  if (!name) return required ? 'Nama home wajib diisi.' : null;
  if (!NAME_RE.test(name)) return `Nama home "${name}" tidak valid (huruf, angka, _ dan - saja, maksimal 32 karakter).`;
  return null;
}

async function run(bot, acc, cmd, { checkName, required }) {
  const bad = validName(checkName, required);
  if (bad) return { ok: false, info: bad, lines: [] };
  const busy = guard(bot, acc);
  if (busy) return { ...busy, lines: [] };

  bot._homeBusy = true;
  try {
    const lines = await sendAndCollect(bot, acc.username, cmd);
    const failed = lines.some((l) => FAIL.test(l));
    return { ok: !failed, lines, info: lines.length ? lines.join(' | ') : NO_REPLY };
  } finally {
    bot._homeBusy = false;
  }
}

// /sethome <nama> — simpan posisi bot sekarang sebagai home
function setHome(bot, acc, name) {
  return run(bot, acc, `/sethome ${name}`, { checkName: name, required: true });
}

// /home [nama] — teleport ke home. Lokasi bot jadi "Home" (kembali ke farm: !farm)
async function goHome(bot, acc, name) {
  const bad = validName(name, false);
  if (bad) return { ok: false, info: bad, lines: [] };
  const prev = stats.get(acc.id).location;
  const res = await run(bot, acc, name ? `/home ${name}` : '/home', { checkName: null, required: false });
  const st = stats.get(acc.id);
  if (res.ok) {
    st.location = 'Home';
    // Bot AFK di home: pastikan lompat anti-AFK aktif (lompat pertama ±5 detik setelah tiba, lalu sesuai jadwal biasa)
    if (typeof bot._ensureJump === 'function') bot._ensureJump(true);
  }
  else st.location = prev; // gagal teleport → lokasi tidak berubah
  return res;
}

// /delhome <nama> — hapus home
function delHome(bot, acc, name) {
  return run(bot, acc, `/delhome ${name}`, { checkName: name, required: true });
}

// /homes — daftar home milik akun
function listHomes(bot, acc) {
  return run(bot, acc, '/homes', { checkName: null, required: false });
}

module.exports = { setHome, goHome, delHome, listHomes, NAME_RE };
