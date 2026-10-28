const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const {
  host, port, version, accounts, reconnectDelay,
  jumpMinMinutes, jumpMaxMinutes,
  rejoinRetryDelay, rejoinMaxAttempts, autoFarm, autoRegister
} = require('./config');
const { log, randomDelay, countShards } = require('./utils');
const stats = require('./stats');
const { syncFromBoard } = require('../features/board');
const { goFarm } = require('../features/farm');
const { startSpawnerMonitor, stopSpawnerMonitor } = require('../features/spawner');

let _emitChatLog = null;
function emitChatLog(accId, username, text) {
  if (!_emitChatLog) {
    try {
      _emitChatLog = require('../server/socket').emitChatLog;
    } catch (e) {}
  }
  if (_emitChatLog) _emitChatLog(accId, username, text);
}

const botMap = new Map();
const active = new Set();          // akun yang sedang jalan / menunggu reconnect (cegah koneksi ganda)
const antiBotStreak = new Map();   // jumlah kick anti-bot berturut-turut per akun
const authKickStreak = new Map();   // kick "authorisation time elapsed" berturut-turut per akun (gagal login / belum daftar)
const stopped = new Set();         // akun yang dimatikan manual (!stop) → tidak boleh reconnect otomatis

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lacak lokasi bot dari command yang dikirim (/afk, /spawn, /crates, /warp x)
function trackLocation(accId, message) {
  const m = String(message || '').trim().toLowerCase();
  if (!m.startsWith('/')) return;
  const [cmd, ...args] = m.slice(1).split(/\s+/);
  const st = stats.get(accId);
  if (cmd === 'afk') {
    st.location = 'AFK';
    if (!st.afkStart) st.afkStart = Date.now(); // sesi AFK baru (mis. kembali dari teleport)
  }
  else if (cmd === 'spawn') st.location = 'Spawn';
  else if (cmd === 'home') st.location = 'Home';
  else if (cmd === 'crate' || cmd === 'crates') st.location = 'Crates';
  else if (cmd === 'warp' && args[0]) st.location = args[0].charAt(0).toUpperCase() + args[0].slice(1);
}

function scheduleJump(bot, firstDelay) {
  const minMs = jumpMinMinutes * 60 * 1000;
  const maxMs = jumpMaxMinutes * 60 * 1000;
  const delay = firstDelay !== undefined ? firstDelay : Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

  bot._jumpNextAt = Date.now() + delay;
  bot._jumpTimer = setTimeout(() => {
    if (bot._disconnected) return; // bot sudah putus: bot baru menjadwalkan sendiri
    // Lompat hanya kalau entity ada (tepat setelah teleport / pindah dunia bisa kosong sebentar) dan bot tidak sedang "diam".
    // Penjadwalan TETAP dilanjutkan; kalau berhenti di sini, lompat anti-AFK mati selamanya.
    if (bot.entity && !bot._hold) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 300);
    }
    scheduleJump(bot);
  }, delay);

  // Pemulih (dipanggil mis. setelah /home): pastikan lompat otomatis jalan.
  //  soon = true → lompat pertama dalam ±5 detik lalu kembali ke jadwal normal; tanpa soon → hanya memulihkan kalau sudah telat.
  bot._ensureJump = (soon = false) => {
    if (bot._disconnected) return;
    const overdue = Date.now() > bot._jumpNextAt + 30000;
    if (soon || overdue) {
      clearTimeout(bot._jumpTimer);
      scheduleJump(bot, soon ? 4000 + Math.floor(Math.random() * 3000) : undefined);
    }
  };
}

// Tunggu konfirmasi pindah server (packet respawn/login dari proxy)
// atau pesan "already connected" (artinya bot memang sudah di ecocpvp).
function waitForSwitch(bot, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      bot.removeListener('respawn', onSwitch);
      bot.removeListener('login', onSwitch);
      bot.removeListener('message', onMsg);
      bot.removeListener('end', onEnd);
      resolve(ok);
    };

    const onSwitch = () => finish(true);
    const onMsg = (jsonMsg) => {
      if (jsonMsg.toString().toLowerCase().includes('already connected')) finish(true);
    };
    const onEnd = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);

    bot.on('respawn', onSwitch);
    bot.on('login', onSwitch);
    bot.on('message', onMsg);
    bot.on('end', onEnd);
  });
}

// Masuk ke ecocpvp + /afk. Dipakai untuk join awal DAN rejoin setelah crash.
// Kalau server ecocpvp masih mati, otomatis coba lagi dengan jeda yang makin lama.
async function joinEcocpvp(bot, acc, reason) {
  if (bot._joining || bot._disconnected) return false;
  bot._joining = true;
  bot._state = 'joining';

  try {
    for (let attempt = 1; attempt <= rejoinMaxAttempts; attempt++) {
      if (bot._disconnected) return false;

      log(acc.username, `[REJOIN] ${reason} → /server ecocpvp (percobaan ${attempt}/${rejoinMaxAttempts})`);

      const waiting = waitForSwitch(bot, 10000);
      bot.chat('/server ecocpvp');
      const ok = await waiting;

      if (ok) {
        // Proxy biasanya kirim 2x respawn saat pindah server → abaikan sebentar
        bot._ignoreRespawnUntil = Date.now() + 15000;
        await sleep(randomDelay(3000, 1000));
        if (bot._disconnected) return false;

        log(acc.username, '[REJOIN] Berhasil masuk ecocpvp. Setting AFK...');
        bot.chat('/afk');
        bot._ignoreRespawnUntil = Date.now() + 10000;
        bot._state = 'ecocpvp';

        // Statistik sesi AFK baru (untuk !live)
        const st = stats.get(acc.id);
        authKickStreak.set(acc.id, 0); // login berhasil → hitungan gagal login direset
        bot._hold = false;
        stats.bank(st); // simpan hasil sesi AFK sebelumnya (untuk !rate), awal direset
        st.afkStart = Date.now();
        // st.awal diisi dari papan skor (maks 10 detik) atau dari pesan shard pertama
        setTimeout(() => {
          // Fallback inventaris (hanya kalau shard bukan dari chat)
          if (!bot._disconnected && !st.chatSeen && countShards(bot) > 0) st.awal = countShards(bot);
        }, 5000);

        // AUTO_FARM=true → setelah /afk, otomatis jalan ke titik farm (juga setelah rejoin karena crash)
        if (autoFarm) {
          setTimeout(() => {
            if (bot._disconnected || bot._state !== 'ecocpvp') return;
            goFarm(bot, acc, { skipAfk: true }).then((res) => {
              log(acc.username, res.ok ? `[FARM] ${res.info} AFK di farm.` : `[FARM ERROR] ${res.info}`);
            });
          }, 6000);
        }
        return true;
      }

      log(acc.username, '[REJOIN] Belum bisa masuk (server mungkin masih mati/restart). Coba lagi...');
      const backoff = Math.min(rejoinRetryDelay * attempt, 60000);
      await sleep(randomDelay(backoff, 1500));
    }

    log(acc.username, `[REJOIN] Gagal setelah ${rejoinMaxAttempts} percobaan. Ketik manual: cmd /server ecocpvp b${acc.id}`);
    return false;
  } finally {
    bot._joining = false;
    if (bot._state === 'joining') bot._state = 'lobby';
  }
}

// Dipanggil saat ada respawn/login packet yang bukan dari aksi kita sendiri
// (= bot ditendang ke lobby karena server crash).
function onUnexpectedSwitch(bot, acc) {
  if (bot._disconnected || bot._joining) return;
  if (bot._state !== 'ecocpvp') return;
  if (bot._tpWatch) return; // sedang menunggu teleport ke pemain (pindah dimensi ikut mengirim respawn) — bukan crash
  if (Date.now() < bot._ignoreRespawnUntil) return;

  bot._hold = false; // posisi lama hilang; bot akan masuk lagi dan AFK seperti biasa
  bot._state = 'lobby'; // cegah trigger ganda
  stats.get(acc.id).location = 'Lobby';
  stats.bank(stats.get(acc.id));
  log(acc.username, '[REJOIN] Terdeteksi kembali ke lobby (server crash?). Masuk lagi sebentar lagi...');

  setTimeout(() => {
    if (!bot._disconnected) joinEcocpvp(bot, acc, 'Kembali ke lobby');
  }, randomDelay(5000, 1500));
}

// Jadwalkan akun berikutnya (maksimal sekali per bot). Dipanggil setelah bot siap,
// ATAU saat bot gagal sebelum siap (kena kick/anti-bot) supaya akun lain tidak ikut macet.
function scheduleNext(bot, index, delay) {
  if (bot._nextScheduled) return;
  bot._nextScheduled = true;
  setTimeout(() => startBot(index + 1), delay);
}

// Jeda tambahan per akun: bot 1 langsung, bot 2 +8 dtk, bot 3 +16 dtk, ... (ditambah acak 0-5 dtk).
// Supaya kalau semua bot putus bersamaan, mereka tidak reconnect di detik yang sama (rawan anti-bot / throttle).
const stagger = (index) => index * 8000 + Math.floor(Math.random() * 5000);

function handleDisconnect(bot, index, reason) {
  // Cegah double reconnect (kicked + end trigger bareng)
  if (bot._disconnected) return;
  bot._disconnected = true;

  botMap.delete(bot.accId);
  scheduleNext(bot, index, randomDelay(10000, 3000));
  if (bot._jumpTimer) clearTimeout(bot._jumpTimer);
  if (bot._shardTimer) clearInterval(bot._shardTimer);
  if (bot._boardTimer) clearInterval(bot._boardTimer);
  stopSpawnerMonitor(bot);

  const acc = accounts[index];
  const name = acc?.username || 'Bot';
  const reasonLower = (reason || '').toLowerCase();

  const st = stats.get(bot.accId);
  stats.bank(st);
  st.location = '-';

  // Dimatikan manual (!stop) → jangan reconnect
  if (stopped.has(index)) {
    active.delete(index);
    log(name, '[DISCONNECT] Dihentikan manual. Ketik !start (atau: bot start) untuk menyalakan lagi.');
    return;
  }

  // Restart manual (!restart) → reconnect cepat
  if (bot._restarting) {
    st.reconnects++;
    const wait = randomDelay(4000, 1500);
    log(name, `[AUTO RECONNECT] Restart manual. Reconnect dalam ${Math.round(wait / 1000)} detik...`);
    setTimeout(() => startBot(index, true), wait);
    return;
  }

  // Kick karena waktu login habis ("An authorisation time elapsed!") = akun belum berhasil login / belum terdaftar.
  // Pertama kali: coba lagi sekali. Kedua kali berturut-turut: berhenti supaya IP tidak kena blokir.
  if (/authori[sz]ation|authenticat|time elapsed|login timeout/.test(reasonLower)) {
    const n = (authKickStreak.get(bot.accId) || 0) + 1;
    authKickStreak.set(bot.accId, n);
    if (n >= 2) {
      stopped.add(index);
      active.delete(index);
      log(name, `[AUTH] Ditendang server 2x berturut-turut karena belum berhasil login. Reconnect otomatis DIHENTIKAN agar IP tidak diblokir.`);
      log(name, `[AUTH] Cek: (1) BOT${bot.accId}_PASSWORD di .env benar, (2) akun sudah terdaftar di server. Setelah beres ketik: bot start b${bot.accId}`);
      return;
    }
    log(name, '[AUTH] Ditendang karena waktu login habis (1/2). Mencoba sekali lagi...');
  }

  // Anti-bot check ("Please reconnect to verify") → koneksi pertama memang ditolak, cukup reconnect cepat
  if (reasonLower.includes('anti-bot') || reasonLower.includes('antibot') || reasonLower.includes('reconnect to verify')) {
    const streak = (antiBotStreak.get(bot.accId) || 0) + 1;
    antiBotStreak.set(bot.accId, streak);
    const wait = streak <= 6 ? randomDelay(4000, 1500) : 60000; // gagal terus → jangan spam
    log(name, `[AUTO RECONNECT] Anti-bot check (percobaan ${streak}). Reconnect dalam ${Math.round(wait / 1000)} detik...`);
    setTimeout(() => startBot(index, true), wait);
    return;
  }

  // Ban → jangan reconnect
  if (reasonLower.includes('banned') || reasonLower.includes('ban')) {
    log(name, `[BANNED] Tidak akan reconnect.`);
    active.delete(index);
    return;
  }

  st.reconnects++;

  // Maintenance → tunggu 10 menit
  if (reasonLower.includes('maintenance') || reasonLower.includes('restart') || reasonLower.includes('reboot')) {
    const maintenanceDelay = 10 * 60 * 1000;
    log(name, `[MAINTENANCE] Server sedang maintenance. Reconnect dalam 10 menit...`);
    setTimeout(() => {
      log(name, `[AUTO RECONNECT] Maintenance selesai, mencoba reconnect...`);
      startBot(index, true);
    }, maintenanceDelay + stagger(index));
    return;
  }

  // IP Cooldown / Suspicious IP → tunggu 5 menit (300s)
  if (reasonLower.includes('cooldown') || reasonLower.includes('suspicious') || reasonLower.includes('previously flagged')) {
    const cooldownDelay = 5 * 60 * 1000;
    log(name, `[IP COOLDOWN] IP sedang cooldown/terdeteksi suspicious. Reconnect dalam 5 menit...`);
    setTimeout(() => {
      log(name, `[AUTO RECONNECT] Cooldown selesai, mencoba reconnect...`);
      startBot(index, true);
    }, cooldownDelay + stagger(index));
    return;
  }

  // Server reset → tunggu 10 menit
  if (reasonLower.includes('reset')) {
    const resetDelay = 10 * 60 * 1000;
    log(name, `[AUTO RECONNECT] Server reset. Reconnect dalam 10 menit...`);
    setTimeout(() => {
      log(name, `[AUTO RECONNECT] Mencoba reconnect sekarang...`);
      startBot(index, true);
    }, resetDelay + stagger(index));
    return;
  }

  // Lainnya → 90 detik
  log(name, `[AUTO RECONNECT] Reconnect dalam ${reconnectDelay / 1000} detik...`);
  setTimeout(() => {
    log(name, `[AUTO RECONNECT] Mencoba reconnect sekarang...`);
    startBot(index, true);
  }, reconnectDelay + stagger(index));
}

function startBot(index, isReconnect = false) {
  if (index < 0 || index >= accounts.length) return;

  const acc = accounts[index];
  if (!acc || !acc.username) return;

  // Password belum diisi → jangan konek (akan mengirim "/login undefined" dan ditendang). Lanjut ke akun berikutnya.
  if (!acc.pass) {
    log(acc.username, `[ERROR] BOT${acc.id}_PASSWORD kosong / salah ketik di .env — akun ini dilewati.`);
    setTimeout(() => startBot(index + 1), 1000);
    return;
  }

  // Dimatikan manual → jangan jalan (timer reconnect lama yang telat jadi tidak berpengaruh)
  if (stopped.has(index)) return;
  // Sudah ada koneksi aktif untuk akun ini → jangan buat koneksi kedua
  if (botMap.has(acc.id)) return;
  // Akun ini sedang menunggu reconnect → hanya timer reconnect yang boleh memulai
  if (!isReconnect && active.has(index)) return;
  active.add(index);

  log(acc.username, 'Masuk server...');

  const bot = mineflayer.createBot({
    host,
    port,
    username: acc.username,
    version
  });

  bot.loadPlugin(pathfinder);
  bot.accId = acc.id;
  bot._disconnected = false;
  bot._joining = false;
  bot._state = 'lobby';          // 'lobby' | 'joining' | 'ecocpvp'
  bot._ignoreRespawnUntil = 0;
  bot._lastLoginAt = 0;

  stats.get(acc.id).lastBeat = Date.now();
  stats.get(acc.id).location = 'Lobby';
  // Heartbeat watchdog: server kirim update waktu ~tiap 1 detik
  bot.on('time', () => { stats.get(acc.id).lastBeat = Date.now(); });

  let lastShardTotal = 0;
  let loginComplete = false;

  bot.once('spawn', async () => {
    log(acc.username, 'Berhasil masuk lobby.');
    antiBotStreak.set(acc.id, 0);

    // Semua command yang dikirim lewat bot.chat dipantau untuk status lokasi
    const rawChat = bot.chat.bind(bot);
    bot.chat = (message, ...rest) => {
      trackLocation(acc.id, message);
      // Perintah yang memindahkan bot (kembali AFK, spawn, home, warp, ...) mengakhiri mode "diam" setelah teleport
      if (/^\s*\/(afk|spawn|home|warp|server|crates?)\b/i.test(String(message))) {
        bot._hold = false;
        if (bot._tpWatch) bot._tpWatch.stop();
      }
      return rawChat(message, ...rest);
    };

    const defaultMove = new Movements(bot);
    defaultMove.canDig = false;            // jangan menggali/merusak blok saat berjalan (aman di farm)
    defaultMove.allow1by1towers = false;   // jangan menumpuk blok untuk naik
    bot.pathfinder.setMovements(defaultMove);

    // Baca saldo (Money/Shards/Coins) dari papan skor tiap 10 detik
    bot._boardTimer = setInterval(() => {
      if (loginComplete && !bot._disconnected) syncFromBoard(bot, acc);
    }, 10000);

    // Shard polling (setiap 3 detik)
    bot._shardTimer = setInterval(() => {
      if (!loginComplete) return;
      const currentTotal = countShards(bot);
      const st = stats.get(acc.id);

      // Fallback: kalau shard berupa item di inventaris (bukan saldo dari chat)
      if (!st.chatSeen && !st.boardSeen && currentTotal > 0) {
        st.lastShards = currentTotal;
        st.known = true;
      }

      if (!st.chatSeen && !st.boardSeen && lastShardTotal > 0 && currentTotal > lastShardTotal) {
        const added = currentTotal - lastShardTotal;
        // Total semua bot (shard terakhir yang diketahui dari tiap akun)
        const allTotal = accounts.reduce((sum, a) => sum + stats.get(a.id).lastShards, 0);
        log(
          acc.username,
          `[SHARD DAPAT] +${added} Shard | B${acc.id}: ${currentTotal.toLocaleString('id-ID')} shards | Total semua: ${allTotal.toLocaleString('id-ID')} shards`
        );
      }
      lastShardTotal = currentTotal;
    }, 3000);

    // Mati di ecocpvp juga bikin respawn packet → jangan dianggap crash
    bot.on('death', () => {
      bot._ignoreRespawnUntil = Date.now() + 10000;
      stats.get(acc.id).location = 'Spawn';
    });

    // Deteksi bot dilempar ke lobby (proxy kirim respawn/login packet baru)
    bot.on('respawn', () => onUnexpectedSwitch(bot, acc));
    bot.on('login', () => onUnexpectedSwitch(bot, acc));

    // Login flow: login → server ecocpvp → /afk
    await sleep(randomDelay(3000, 1000));
    if (bot._disconnected) return;

    log(acc.username, 'Login...');
    bot._lastLoginAt = Date.now();
    bot.chat(`/login ${acc.pass}`);
    loginComplete = true;

    await sleep(randomDelay(5000, 2000));
    if (bot._disconnected) return;

    await joinEcocpvp(bot, acc, 'Join awal');
    if (bot._disconnected) return;

    log(acc.username, `Bot siap. Ketik: farm b${acc.id} untuk jalan ke titik farm (atau !farm b${acc.id} di Discord)`);

    // Anti-AFK jump (acak)
    scheduleJump(bot);

    // Start bot berikutnya
    startSpawnerMonitor(bot, acc); // aktif kalau SPAWNER_AUTO=true / !spawner auto on
    scheduleNext(bot, index, randomDelay(15000, 5000));
  });

  // Chat filter
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    if (text) {
      emitChatLog(acc.id, acc.username, text);
    }
    const lower = text.toLowerCase();

    // ---- Otentikasi: tampilkan pesan login/daftar dari server supaya penyebab gagal login kelihatan ----
    if (bot._state !== 'ecocpvp' && text.length < 300 &&
        /\/login|\/register|login|register|password|authori[sz]|authenticat|captcha|kata sandi|daftar/i.test(text)) {
      bot._authLogCount = (bot._authLogCount || 0) + 1;
      if (bot._authLogCount <= 10) log(acc.username, `[AUTH] ${text}`);
    }

    // Server meminta daftar → /register otomatis (pakai password dari .env). Matikan lewat AUTO_REGISTER=false
    if (autoRegister && !bot._registerSent && bot._state !== 'ecocpvp' && !lower.includes('already') &&
        /\/register|please[, ]+register|register (first|to|with|your)|silakan daftar|daftar dulu/.test(lower)) {
      bot._registerSent = true;
      setTimeout(() => {
        if (bot._disconnected) return;
        log(acc.username, '[AUTH] Server meminta daftar → /register otomatis (password dari .env)');
        bot.chat(`/register ${acc.pass} ${acc.pass}`);
      }, randomDelay(1500, 500));
    }

    // Password salah → hentikan akun ini (jangan diulang-ulang, bisa membuat IP diblokir)
    if (!bot._authFailed && /wrong password|incorrect password|invalid password|password salah|kata sandi salah|login failed|gagal login/.test(lower)) {
      bot._authFailed = true;
      stopped.add(index);
      active.delete(index);
      log(acc.username, `[AUTH] Server menolak password. Akun dihentikan. Perbaiki BOT${acc.id}_PASSWORD di .env lalu ketik: bot start b${acc.id}`);
      quitBot(bot, 'auth failed');
    }

    // Kalau balik ke lobby dan diminta login lagi → login otomatis
    if (loginComplete && bot._state !== 'ecocpvp' && lower.includes('/login') &&
        Date.now() - bot._lastLoginAt > 8000) {
      bot._lastLoginAt = Date.now();
      setTimeout(() => {
        if (bot._disconnected) return;
        log(acc.username, 'Login ulang (diminta server)...');
        bot.chat(`/login ${acc.pass}`);
      }, randomDelay(1500, 500));
    }

    if (lower.includes('next shard in')) return;

    if (lower.includes('pay') || lower.includes('money') || lower.includes('balance') ||
        lower.includes('sent') || lower.includes('received') || lower.includes('bought') ||
        lower.includes('purchased') || lower.includes('insufficient') || lower.includes('player not found')) {
      log(acc.username, `[SERVER RESPONS] ${text}`);
    } else if ((lower.includes('+1') || lower.includes('dapat')) && lower.includes('shard')) {
      log(acc.username, `[SHARD DAPAT] ${text}`);
    }

    // Baca saldo shard dari chat: "You received 1 Shard (Total: 9386)"
    const sm = text.match(/received\s+([\d.,]+)\s+shards?\s*\(\s*total:\s*([\d.,]+)\s*\)/i);
    if (sm) {
      const added = parseInt(sm[1].replace(/[^\d]/g, ''));
      const total = parseInt(sm[2].replace(/[^\d]/g, ''));
      if (!isNaN(added) && !isNaN(total)) {
        const st = stats.get(acc.id);
        st.chatSeen = true;
        st.known = true;
        st.lastShards = total;
        // Shard awal sesi AFK = saldo sebelum shard pertama yang diterima
        if (st.awal === null) st.awal = total - added;

        const allTotal = accounts.reduce((sum, a) => sum + stats.get(a.id).lastShards, 0);
        log(
          acc.username,
          `[SHARD DAPAT] +${added} Shard | B${acc.id}: ${total.toLocaleString('id-ID')} shards | Total semua: ${allTotal.toLocaleString('id-ID')} shards`
        );
      }
    }

    // "You bought Money for 10 Shards" → kurangi saldo (dan shard awal, supaya selisih (+N) tetap = shard yang didapat)
    const bm = text.match(/you bought .*? for\D*?([\d.,]+)\s*shards?/i);
    if (bm) {
      const cost = parseInt(bm[1].replace(/[^\d]/g, ''));
      const st = stats.get(acc.id);
      if (!isNaN(cost) && st.known) {
        // Kalau saldo dibaca dari papan skor, nilainya diperbarui sendiri oleh server (jangan dikurangi dua kali)
        if (!st.boardSeen) st.lastShards = Math.max(0, st.lastShards - cost);
        if (st.awal !== null) st.awal -= cost;
      }
    }
  });

  bot.on('error', (err) => {
    if (err.code !== 'EPIPE') {
      log(acc.username, `[ERROR] ${err.message}`);
    }
  });

  bot.on('kicked', (reason) => {
    log(acc.username, `[KICKED] ${reason}`);
    handleDisconnect(bot, index, reason);
  });

  bot.on('end', (reason) => {
    log(acc.username, `[DISCONNECT] ${reason}`);
    handleDisconnect(bot, index, reason);
  });

  botMap.set(acc.id, bot);
}

// ====== Kontrol manual: stop / start / restart (dipakai Discord & console) ======
function indexOfId(id) {
  return accounts.findIndex((a) => a.id === id);
}

function quitBot(bot, reason) {
  try {
    (bot.quit || bot.end).call(bot, reason);
  } catch (e) {
    try { bot.end(reason); } catch (e2) {}
  }
}

function isStopped(id) {
  const index = indexOfId(id);
  return index >= 0 && stopped.has(index);
}

function stopBot(id) {
  const index = indexOfId(id);
  if (index < 0) return { ok: false, info: `Akun b${id} tidak ada.` };
  const name = accounts[index].username;
  if (stopped.has(index)) return { ok: false, info: `${name} sudah dalam keadaan berhenti.` };

  stopped.add(index);
  active.delete(index);

  const bot = botMap.get(id);
  if (bot) {
    quitBot(bot, 'manual stop');
    return { ok: true, info: `${name} dimatikan. Tidak akan reconnect sampai kamu start lagi.` };
  }
  return { ok: true, info: `${name} sedang offline — reconnect yang tertunda dibatalkan.` };
}

function startManual(id) {
  const index = indexOfId(id);
  if (index < 0) return { ok: false, info: `Akun b${id} tidak ada.` };
  const name = accounts[index].username;
  if (botMap.has(id)) return { ok: false, info: `${name} sudah online.` };

  stopped.delete(index);
  authKickStreak.delete(id);
  active.delete(index); // izinkan start baru walau sebelumnya menunggu reconnect
  startBot(index);
  return { ok: true, info: `${name} dinyalakan, masuk server...` };
}

function restartBot(id) {
  const index = indexOfId(id);
  if (index < 0) return { ok: false, info: `Akun b${id} tidak ada.` };
  const name = accounts[index].username;

  const bot = botMap.get(id);
  if (!bot) {
    const res = startManual(id); // tidak sedang online → langsung nyalakan
    return { ok: res.ok, info: res.ok ? `${name} tidak sedang online, langsung dinyalakan.` : res.info };
  }
  stopped.delete(index);
  bot._restarting = true;
  quitBot(bot, 'manual restart');
  return { ok: true, info: `${name} direstart, reconnect beberapa detik lagi.` };
}

// action: 'stop' | 'start' | 'restart'. tag: 'b1' / '1' / 'all'. Banyak bot → dijeda 8 detik (hindari throttle server)
function controlBots(action, tag) {
  const fn = { stop: stopBot, start: startManual, restart: restartBot }[action];
  if (!fn) return [];
  const t = String(tag || 'all').toLowerCase();
  const ids = t === 'all' ? accounts.map((a) => a.id) : [parseInt(t.replace(/^b/, ''))];

  return ids.map((id, i) => {
    if (action === 'stop' || i === 0) return { id, ...fn(id) };
    setTimeout(() => fn(id), i * 8000);
    return { id, ok: true, info: `${accounts[indexOfId(id)]?.username || 'Bot'}: dijadwalkan ${i * 8} detik lagi.` };
  });
}

module.exports = { botMap, startBot, stopBot, startManual, restartBot, controlBots, isStopped };
