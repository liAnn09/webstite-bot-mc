// Teleport lewat command server (gaya Essentials: /tpa, /spawn, /home, /warp).
// Bentuk: tp <bot|all> <pemain | spawn | home [nama] | warp <nama>>
//
//   tp b1 Steve        → /tpa Steve          (minta teleport ke pemain)
//   tp b1 here Steve   → /tpahere Steve      (minta pemain teleport ke bot)
//   tp all spawn       → /spawn
//   tp b2 home         → /home   |  tp b2 home farm → /home farm
//   tp b1 warp pvp     → /warp pvp

const stats = require('../core/stats');
const { log } = require('../core/utils');

const NAME_RE = /^[A-Za-z0-9_.]{1,16}$/;   // nama pemain (titik di depan = pemain Bedrock)
const WORD_RE = /^[A-Za-z0-9_\-]{1,32}$/;  // nama home / warp

// words = argumen setelah tag bot. Hasil: { cmd, label } atau { error }
function buildTp(words) {
  if (!words.length) return { error: 'Tujuan kosong. Contoh: tp b1 Steve | tp all spawn | tp b1 warp pvp' };

  const first = words[0].toLowerCase();

  if (first === 'spawn') return { cmd: '/spawn', label: 'Spawn' };

  if (first === 'home') {
    if (words[1] && !WORD_RE.test(words[1])) return { error: `Nama home "${words[1]}" tidak valid.` };
    return { cmd: words[1] ? `/home ${words[1]}` : '/home', label: words[1] ? `Home ${words[1]}` : 'Home' };
  }

  if (first === 'warp') {
    if (!words[1]) return { error: 'Sebutkan nama warp. Contoh: tp b1 warp pvp' };
    if (!WORD_RE.test(words[1])) return { error: `Nama warp "${words[1]}" tidak valid.` };
    return { cmd: `/warp ${words[1]}`, label: `Warp ${words[1]}` };
  }

  if (first === 'here') {
    if (!words[1] || !NAME_RE.test(words[1])) return { error: 'Sebutkan nama pemain. Contoh: tp b1 here Steve' };
    return { cmd: `/tpahere ${words[1]}`, label: `${words[1]} diminta teleport ke bot` };
  }

  if (!NAME_RE.test(words[0])) return { error: `Nama pemain "${words[0]}" tidak valid.` };
  return { cmd: `/tpa ${words[0]}`, label: `Minta teleport ke ${words[0]}`, kind: 'player', player: words[0] };
}

// ====== Mode diam setelah teleport ke pemain ======
// Begitu bot benar-benar berpindah (permintaan /tpa diterima), bot DIAM di sana:
// tidak lompat anti-AFK, tidak berjalan, dan tidak ditarik kembali ke AFK. Kembali ke AFK hanya lewat perintah:
// farm <bot> (atau command /afk, /spawn, /home, /warp yang dikirim sendiri).

const WATCH_MS = 90 * 1000;   // lama menunggu permintaan teleport diterima
const MOVED_BLOCKS = 8;       // pindah sejauh ini dianggap teleport

// Batalkan hal yang bisa menarik bot kembali ke AFK sendiri (timer sesi crates)
function cancelAutoReturn(bot) {
  clearTimeout(bot._crateTimer);
  bot._crateTimer = null;
  bot._crateReturnTo = null;
}

function holdBot(bot, acc, label) {
  bot._hold = true;
  cancelAutoReturn(bot);
  try { bot.clearControlStates(); } catch (e) {}
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
  // Respawn susulan karena pindah dimensi/dunia bukan "server crash" → jangan dianggap terlempar ke lobby
  bot._ignoreRespawnUntil = Date.now() + 8000;

  const st = stats.get(acc.id);
  stats.bank(st);           // sesi AFK berakhir (di luar area AFK tidak ada shard)
  st.location = label;
}

// Setelah /tpa dikirim: pantau apakah bot berpindah jauh (server mengirim posisi baru). Kalau ya → bot diam di sana.
function watchTeleport(bot, acc, label, windowMs = WATCH_MS) {
  if (bot._tpWatch) bot._tpWatch.stop();
  const p0 = bot.entity && bot.entity.position;
  if (!p0) return null;
  const start = { x: p0.x, y: p0.y, z: p0.z };

  let done = false;
  let timer = null;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    bot.removeListener('forcedMove', onMove);
    bot.removeListener('end', stop);
    if (bot._tpWatch && bot._tpWatch.stop === stop) bot._tpWatch = null;
  };
  const onMove = () => {
    const p = bot.entity && bot.entity.position;
    if (!p) return;
    if (Math.hypot(p.x - start.x, p.y - start.y, p.z - start.z) < MOVED_BLOCKS) return;
    stop();
    holdBot(bot, acc, label);
    log(acc.username, `[TP] Sudah teleport (${label}). Bot diam di sini dan tidak kembali AFK. Untuk kembali: farm b${acc.id}`);
  };
  timer = setTimeout(() => {
    stop();
    log(acc.username, '[TP] Belum ada teleport dalam 90 detik (permintaan belum diterima?). Bot tetap seperti semula.');
  }, windowMs);

  bot.on('forcedMove', onMove);
  bot.on('end', stop);
  bot._tpWatch = { stop };
  return bot._tpWatch;
}

module.exports = { buildTp, cancelAutoReturn, holdBot, watchTeleport };
