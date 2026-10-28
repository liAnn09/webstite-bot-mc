const fs = require('fs');
const path = require('path');
const { log } = require('../core/utils');
const stats = require('../core/stats');
const cfg = require('../core/config');
const { labelOf, loreOf } = require('./items');
const { findSlot } = require('./shop');
const { goFarm } = require('./farm');
const { walkNear } = require('./crates');

// Alur (sesuai video):
//   klik kanan spawner → GUI "64 Skeleton Spawner" → item "Spawner Storage" (tooltip: "722,432 Bone")
//   → klik item itu → GUI penyimpanan: 45 slot bone + tombol "Drop Loot" (menjatuhkan seluruh isi halaman)
// Jumlah bone dibaca dari tooltip "Spawner Storage" (tanpa membuka penyimpanan). Drop hanya dijalankan
// kalau jumlah sudah mencapai batas (bawaan 500.000).

const FILE = path.join(__dirname, '..', '..', 'data', 'spawner.json'); // data/ tidak ikut ke Git

const STORAGE_FALLBACK_SLOT = 13; // item "Spawner Storage" di GUI utama (baris 2, kolom 5)
const DROP_FALLBACK_SLOT = 52;    // tombol "Drop Loot" di baris kontrol bawah (GUI 6 baris)
const PAGE_SLOTS = 45;            // slot 0-44 = isi halaman, slot 45-53 = tombol kontrol
const MAX_CLICKS_PER_ROUND = 40;
const MAX_ROUNDS = 800;
const SEARCH_RADIUS = 8;
const REACH = 4.5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (n) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('id-ID'));

// ======================= Pengaturan per akun =======================

function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Pengaturan akun: disimpan lewat !spawner auto / !spawner limit, kalau belum ada pakai nilai dari .env
function getSettings(accId) {
  const o = loadAll()[accId] || {};
  return {
    auto: o.auto !== undefined ? !!o.auto : cfg.spawnerAuto,
    threshold: Number.isFinite(o.threshold) ? o.threshold : cfg.spawnerThreshold,
    keep: Number.isFinite(o.keep) ? o.keep : cfg.spawnerKeep
  };
}

function saveSettings(accId, patch) {
  const all = loadAll();
  all[accId] = { ...(all[accId] || {}), ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  return getSettings(accId);
}

// "500000" / "500.000" / "500k" / "0.5m" → angka
function parseAmount(s) {
  let t = String(s || '').trim().toLowerCase().replace(/,/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "500.000" (gaya Indonesia) = lima ratus ribu
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

// ======================= Membaca GUI =======================

// "722,432 Bone" → 722432
function parseCount(lore) {
  for (const l of lore) {
    const m = l.match(/(\d[\d.,\s]*)\s*bones?\b/i);
    if (m) {
      const n = parseInt(m[1].replace(/[^\d]/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

// Item "Spawner Storage" di GUI utama → { slot, count }
function readStorage(window) {
  const end = window.inventoryStart ?? window.slots.length;
  for (let i = 0; i < end; i++) {
    const it = window.slots[i];
    if (it && /spawner storage/i.test(labelOf(it))) return { slot: i, count: parseCount(loreOf(it)) };
  }
  return null;
}

// Isi halaman penyimpanan: jumlah bone dan item selain bone (supaya tidak ikut terbuang)
function pageInfo(window) {
  const end = Math.min(PAGE_SLOTS, window.inventoryStart ?? window.slots.length);
  let bones = 0;
  const others = [];
  for (let i = 0; i < end; i++) {
    const it = window.slots[i];
    if (!it) continue;
    if (it.name === 'bone') bones += it.count || 1;
    else others.push(labelOf(it));
  }
  return { bones, others };
}

// ======================= Dunia =======================

function findSpawner(bot) {
  return bot.findBlock({
    matching: (b) => b && (b.name === 'spawner' || b.name === 'mob_spawner'),
    maxDistance: SEARCH_RADIUS
  }) || null;
}

function closeWindow(bot) {
  try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (e) {}
}

// Jalankan trigger lalu tunggu GUI baru terbuka
function waitWindow(bot, trigger, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const onWin = (w) => { clearTimeout(timer); resolve(w); };
    const timer = setTimeout(() => { bot.removeListener('windowOpen', onWin); resolve(null); }, timeoutMs);
    bot.once('windowOpen', onWin);
    trigger();
  });
}

const click = (bot, slot) =>
  Promise.resolve(bot.clickWindow(slot, 0, 0)).catch((err) => log('Spawner', `[SPAWNER] Peringatan klik slot ${slot}: ${err.message}`));

// Klik kanan spawner terdekat → GUI utama
async function openSpawner(bot) {
  const block = findSpawner(bot);
  if (!block) return { ok: false, noSpawner: true, info: `Spawner tidak ditemukan dalam ${SEARCH_RADIUS} blok dari bot.` };

  const center = block.position.offset(0.5, 0.5, 0.5);
  let walked = false;
  if (bot.entity.position.distanceTo(center) > REACH) {
    const r = await walkNear(bot, block.position, 2);
    if (!r.ok) return { ok: false, info: r.info };
    walked = true;
  }
  try { await bot.lookAt(center, true); } catch (e) {}

  closeWindow(bot);
  const window = await waitWindow(bot, () => Promise.resolve(bot.activateBlock(block)).catch(() => {}));
  if (!window) return { ok: false, info: 'GUI spawner tidak terbuka (tidak ada respons dari server).', walked };
  await sleep(600); // isi GUI dimuat bertahap
  return { ok: true, window, block, walked };
}

// ======================= Operasi =======================

function guard(bot) {
  if (bot._disconnected) return { ok: false, info: 'Bot tidak aktif.' };
  if (bot._state !== 'ecocpvp') return { ok: false, info: 'Bot belum berada di ecocpvp.' };
  if (bot._spawnerBusy || bot._crateBusy || bot._walking || bot._buying || bot._selling || bot._homeBusy) {
    return { ok: false, info: 'Bot sedang sibuk (spawner/crate/beli/jual/home/berjalan), coba lagi sebentar.' };
  }
  return null;
}

// Kembali ke titik farm kalau bot sempat berjalan ke spawner
async function returnIfWalked(bot, acc, prevLocation, walked) {
  if (walked && prevLocation === 'Farm' && !bot._disconnected) await goFarm(bot, acc, { skipAfk: true });
}

// Baca jumlah bone dari tooltip "Spawner Storage" lalu tutup GUI
async function readCount(bot, acc) {
  const busy = guard(bot);
  if (busy) return busy;
  bot._spawnerBusy = true;
  const st = stats.get(acc.id);
  const prev = st.location;
  let walked = false;
  try {
    const opened = await openSpawner(bot);
    if (!opened.ok) return opened;
    walked = opened.walked;
    const s = readStorage(opened.window);
    closeWindow(bot);
    if (!s) return { ok: false, info: 'Item "Spawner Storage" tidak ditemukan di GUI. Yang terbuka bukan GUI spawner?' };
    if (s.count === null) return { ok: false, info: 'Jumlah bone tidak terbaca dari tooltip Spawner Storage.' };
    st.bones = s.count;
    st.bonesAt = Date.now();
    return { ok: true, count: s.count };
  } finally {
    bot._spawnerBusy = false;
    await returnIfWalked(bot, acc, prev, walked).catch(() => {});
  }
}

// Klik "Drop Loot" berulang di GUI penyimpanan selama halaman masih berisi bone
// budget = jumlah bone yang masih boleh dibuang (jumlah di storage - sisa yang dipertahankan).
// Satu klik membuang SELURUH halaman, jadi klik dilewati kalau halaman itu akan melewati batas sisa.
async function dropPages(bot, window, { force, budget }) {
  const dropSlot = findSlot(window, 'drop loot', DROP_FALLBACK_SLOT);
  let clicks = 0;
  let left = budget;
  let dropped = 0;
  for (let i = 0; i < MAX_CLICKS_PER_ROUND; i++) {
    if (bot._disconnected || bot._spawnerStop) break;
    const page = pageInfo(window);
    if (page.others.length && !force) {
      const names = [...new Set(page.others)].slice(0, 3).join(', ');
      return { clicks, aborted: true, reason: `Ada item selain bone di storage (${names}). Dibatalkan supaya tidak ikut terbuang.` };
    }
    if (page.bones === 0) {
      await sleep(cfg.spawnerClickWaitMs);      // halaman kosong: mungkin terisi lagi dari storage
      if (pageInfo(window).bones === 0) break;
      continue;
    }
    if (page.bones > left) return { clicks, limit: true, dropped }; // membuang halaman ini akan menembus batas sisa
    click(bot, dropSlot);
    clicks++;
    left -= page.bones;
    dropped += page.bones;
    await sleep(cfg.spawnerClickWaitMs);
  }
  return { clicks, dropped };
}

// Drop bone sampai storage ≤ keep. Tiap ronde: buka spawner → baca jumlah (acuan sebenarnya) → buka storage → Drop Loot.
async function dropSession(bot, acc, { keep = 0, force = false, maxMinutes = cfg.spawnerMaxMinutes } = {}) {
  const busy = guard(bot);
  if (busy) return busy;

  bot._spawnerBusy = true;
  bot._spawnerDropping = true; // sesi drop (bukan sekadar membaca jumlah) → bisa dihentikan dengan stop
  bot._spawnerStop = false;
  const st = stats.get(acc.id);
  const prev = st.location;
  const t0 = Date.now();
  let walked = false;
  let before = null;
  let last = null;
  let after = null;
  let stalls = 0;
  let rounds = 0;
  let clicks = 0;

  const done = (extra) => ({
    before, after, rounds, clicks,
    dropped: before !== null && after !== null ? Math.max(0, before - after) : null,
    seconds: Math.round((Date.now() - t0) / 1000),
    ...extra
  });

  // Berhenti di tengah jalan (stop / batas waktu / item asing): baca jumlah terbaru supaya laporan akurat
  const refresh = async () => {
    try {
      if (bot._disconnected) return;
      const o = await openSpawner(bot);
      if (!o.ok) return;
      walked = walked || o.walked;
      const s2 = readStorage(o.window);
      closeWindow(bot);
      if (s2 && s2.count !== null) {
        after = s2.count;
        st.bones = s2.count;
        st.bonesAt = Date.now();
      }
    } catch (e) {}
  };

  try {
    while (rounds < MAX_ROUNDS) {
      if (bot._disconnected) return done({ ok: false, info: 'Bot terputus saat drop.' });
      if (bot._spawnerStop) {
        await refresh();
        return done({ ok: false, stopped: true, info: 'Dihentikan manual.' });
      }
      if (Date.now() - t0 > maxMinutes * 60000) {
        await refresh();
        return done({ ok: false, info: `Batas waktu ${maxMinutes} menit tercapai. Jalankan lagi untuk melanjutkan.` });
      }

      const opened = await openSpawner(bot);
      if (!opened.ok) return done({ ok: false, info: opened.info });
      walked = walked || opened.walked;

      const s = readStorage(opened.window);
      if (!s || s.count === null) {
        closeWindow(bot);
        return done({ ok: false, info: 'Jumlah bone di Spawner Storage tidak terbaca.' });
      }

      st.bones = s.count;
      st.bonesAt = Date.now();
      if (before === null) before = s.count;
      after = s.count;
      if (s.count <= keep) {
        closeWindow(bot);
        break;
      }

      // Tidak ada penurunan dua ronde berturut-turut → berhenti (tombol tidak bekerja / drop ditolak server)
      if (last !== null && s.count >= last) stalls++;
      else stalls = 0;
      if (stalls >= 2) {
        closeWindow(bot);
        return done({ ok: false, stalled: true, info: 'Jumlah bone tidak berkurang setelah dua ronde drop. Dihentikan (server menolak drop atau tombol tidak bekerja).' });
      }
      last = s.count;

      const storage = await waitWindow(bot, () => click(bot, s.slot));
      if (!storage) {
        closeWindow(bot);
        return done({ ok: false, info: 'GUI penyimpanan tidak terbuka.' });
      }
      await sleep(600);

      const res = await dropPages(bot, storage, { force, budget: s.count - keep });
      clicks += res.clicks;
      closeWindow(bot);
      rounds++;
      if (res.aborted) {
        await refresh();
        return done({ ok: false, aborted: true, info: res.reason });
      }
      // Halaman berikutnya akan membuang melebihi batas sisa. Keputusan "selesai" hanya diambil dari jumlah SEBENARNYA:
      // kalau ronde ini tidak sempat membuang apa pun, jumlah yang dibaca di awal ronde sudah benar-benar yang tersisa.
      // Kalau sudah ada klik di ronde ini, lanjut satu ronde lagi untuk membaca jumlah terbaru (perkiraan bisa meleset).
      if (res.limit && res.clicks === 0) {
        after = s.count;
        return done({ ok: true, info: `Selesai. Sisa dipertahankan (${fmt(keep)}); halaman berikutnya akan membuang melebihi batas itu.` });
      }

      if (rounds % 20 === 0) log(acc.username, `[SPAWNER] Drop berjalan: ${fmt(s.count)} bone tersisa (ronde ${rounds})...`);
    }
    if (rounds >= MAX_ROUNDS) return done({ ok: false, info: 'Batas jumlah ronde tercapai.' });
    return done({ ok: true, info: 'Selesai.' });
  } finally {
    bot._spawnerBusy = false;
    bot._spawnerDropping = false;
    bot._spawnerStop = false;
    closeWindow(bot);
    await returnIfWalked(bot, acc, prev, walked).catch(() => {});
  }
}

function stopDrop(bot) {
  if (!bot._spawnerDropping) return false;
  bot._spawnerStop = true;
  return true;
}

// ======================= Pemantau otomatis =======================

// Layak dicek: bot di ecocpvp, sedang AFK / di farm, tidak sibuk dan tidak dalam mode diam setelah teleport
function eligible(bot, acc) {
  if (!bot || bot._disconnected || bot._state !== 'ecocpvp' || bot._hold) return false;
  if (bot._spawnerBusy || bot._crateBusy || bot._walking || bot._buying || bot._selling || bot._homeBusy) return false;
  const loc = stats.get(acc.id).location;
  return loc === 'AFK' || loc === 'Farm';
}

async function checkOnce(bot, acc) {
  const s = getSettings(acc.id);
  const r = await readCount(bot, acc);
  if (!r.ok) {
    if (r.noSpawner) {
      if (!bot._noSpawnerWarned) {
        bot._noSpawnerWarned = true;
        log(acc.username, `[SPAWNER] ${r.info} Pantau otomatis dilewati sampai spawner ada di dekat bot.`);
      }
    } else {
      log(acc.username, `[SPAWNER] Gagal membaca storage: ${r.info}`);
    }
    return r;
  }
  bot._noSpawnerWarned = false;
  log(acc.username, `[SPAWNER] Bone di storage: ${fmt(r.count)} (batas drop ${fmt(s.threshold)})`);

  if (r.count >= s.threshold) {
    log(acc.username, `[SPAWNER] Batas tercapai (${fmt(r.count)} ≥ ${fmt(s.threshold)}) → mulai drop bone...`);
    const d = await dropSession(bot, acc, { keep: s.keep });
    log(
      acc.username,
      d.ok
        ? `[SPAWNER] Drop selesai: ${fmt(d.before)} → ${fmt(d.after)} bone (${d.rounds} ronde, ${d.seconds} detik)`
        : `[SPAWNER] Drop berhenti: ${d.info} (${fmt(d.before)} → ${fmt(d.after)})`
    );
    return { ok: d.ok, count: r.count, drop: d };
  }
  return { ok: true, count: r.count };
}

function stopSpawnerMonitor(bot) {
  clearTimeout(bot._spawnerFirst);
  clearInterval(bot._spawnerTimer);
  bot._spawnerFirst = null;
  bot._spawnerTimer = null;
}

// Dipanggil setelah bot siap. Setiap SPAWNER_CHECK_MINUTES menit (cek pertama 2 menit setelah siap) → baca jumlah bone.
// Hanya berjalan kalau auto aktif untuk akun ini (!spawner auto on / SPAWNER_AUTO=true).
function startSpawnerMonitor(bot, acc) {
  stopSpawnerMonitor(bot);
  const tick = () => {
    if (!getSettings(acc.id).auto) return;
    if (!eligible(bot, acc)) return;
    checkOnce(bot, acc).catch((err) => log(acc.username, `[SPAWNER] Error: ${err.message}`));
  };
  bot._spawnerFirst = setTimeout(tick, 2 * 60 * 1000);
  bot._spawnerTimer = setInterval(tick, cfg.spawnerCheckMinutes * 60 * 1000);
}

module.exports = {
  getSettings, saveSettings, parseAmount, parseCount,
  readStorage, pageInfo, readCount, dropSession, stopDrop,
  checkOnce, eligible, startSpawnerMonitor, stopSpawnerMonitor
};
