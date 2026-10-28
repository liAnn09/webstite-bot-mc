const { goals } = require('mineflayer-pathfinder');
const { log } = require('../core/utils');
const stats = require('../core/stats');
const { labelOf, loreOf } = require('./items');
const { cleanLine, toText } = require('./board');
const { snapshot, diffNew } = require('./inv');
const { goFarm } = require('./farm');
const { findSlot } = require('./shop');

// Alur (sesuai video): /warp crates → hologram di atas tiap chest menampilkan nama crate + jumlah key
// → klik kanan chest → GUI pilihan hadiah → klik hadiah yang dipilih (memakai 1 key).
const WARP_COMMAND = '/warp crates';
const SESSION_MS = 120 * 1000; // setelah itu bot otomatis kembali AFK

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ======================= Hologram =======================

// Semua teks yang menempel pada satu entity (nama kustom armor stand, teks text_display, dst.)
function entityTexts(e) {
  const out = [];
  const md = e.metadata || [];
  for (let i = 0; i < md.length; i++) {
    const v = md[i];
    if (v === undefined || v === null || Array.isArray(v)) continue;
    if (typeof v !== 'string' && typeof v !== 'object') continue;
    const t = cleanLine(toText(v));
    if (t) out.push(t);
  }
  return out;
}

// Kumpulan baris teks beserta posisinya di dunia
function holoLines(bot) {
  const lines = [];
  for (const e of Object.values(bot.entities || {})) {
    if (!e || !e.position) continue;
    for (const t of entityTexts(e)) lines.push({ text: t, x: e.position.x, y: e.position.y, z: e.position.z });
  }
  return lines;
}

// Kelompokkan baris yang berada di titik X/Z yang sama (satu hologram = beberapa armor stand bertumpuk)
function clusterLines(lines) {
  const clusters = [];
  for (const l of lines) {
    let c = clusters.find((k) => Math.hypot(k.x - l.x, k.z - l.z) <= 0.75);
    if (!c) {
      c = { x: l.x, z: l.z, lines: [] };
      clusters.push(c);
    }
    c.lines.push(l);
  }
  clusters.forEach((c) => c.lines.sort((a, b) => b.y - a.y)); // atas → bawah
  return clusters;
}

// "common crate / Right-click to open / Keys: 3" → { name, short, keys, x, z, topY }
function parseCrate(cluster) {
  const texts = cluster.lines.map((l) => l.text);
  const nameLine = texts.find((t) => /crate/i.test(t) && !/right.?click|click to/i.test(t));
  if (!nameLine) return null;

  const keyLine = texts.find((t) => /\bkeys?\b/i.test(t));
  let keys = null;
  if (keyLine) {
    const m = keyLine.match(/keys?\s*[:\-–]?\s*([\d.,]+)/i) || keyLine.match(/([\d.,]+)\s*keys?/i);
    if (m) keys = parseInt(m[1].replace(/[.,]/g, ''));
  }
  return {
    name: nameLine,
    short: nameLine.replace(/\s*crate\s*$/i, '').trim() || nameLine,
    keys,
    keyText: keyLine || null,
    x: cluster.x,
    z: cluster.z,
    topY: cluster.lines[0].y
  };
}

// Daftar crate yang terlihat oleh bot saat ini (urut abjad)
function readCrates(bot) {
  return clusterLines(holoLines(bot))
    .map(parseCrate)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ======================= Chest =======================

const CONTAINERS = new Set(['chest', 'trapped_chest', 'ender_chest', 'barrel']);
const isContainer = (b) => b && (CONTAINERS.has(b.name) || /shulker_box$/.test(b.name));

function vec(bot, x, y, z) {
  const V = bot.entity.position.constructor; // kelas Vec3 milik mineflayer (tidak perlu paket tambahan)
  return new V(x, y, z);
}

// Chest di bawah hologram: wadah (chest/barrel/...) terdekat; kalau tak ada, blok padat pertama di bawahnya
function findChest(bot, crate) {
  const fy = Math.floor(crate.topY);
  const cx = Math.floor(crate.x);
  const cz = Math.floor(crate.z);
  let best = null;
  let bestScore = Infinity;
  let firstSolid = null;

  for (let y = fy; y >= fy - 6; y--) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const b = bot.blockAt(vec(bot, cx + dx, y, cz + dz));
        if (!b) continue;
        if (isContainer(b)) {
          const score = Math.hypot(b.position.x + 0.5 - crate.x, b.position.z + 0.5 - crate.z) + (fy - y) * 0.1;
          if (score < bestScore) {
            best = b;
            bestScore = score;
          }
        } else if (!firstSolid && dx === 0 && dz === 0 && b.name && !/air|void|light|barrier/.test(b.name) && b.boundingBox === 'block') {
          firstSolid = b;
        }
      }
    }
  }
  return best || firstSolid;
}

// ======================= Jalan =======================

function walkNear(bot, pos, range = 2, timeoutMs = 45000) {
  return new Promise((resolve) => {
    if (!bot.pathfinder) return resolve({ ok: false, info: 'Pathfinder tidak aktif.' });
    let done = false;
    let timer = null;
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      bot.removeListener('goal_reached', onReached);
      bot.removeListener('path_update', onPath);
      bot.removeListener('end', onEnd);
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      resolve(res);
    };
    const onReached = () => finish({ ok: true });
    const onPath = (r) => { if (r && r.status === 'noPath') finish({ ok: false, info: 'Tidak ada jalur ke chest.' }); };
    const onEnd = () => finish({ ok: false, info: 'Bot terputus saat berjalan.' });
    timer = setTimeout(() => finish({ ok: false, info: 'Timeout: bot belum sampai di chest.' }), timeoutMs);
    bot.on('goal_reached', onReached);
    bot.on('path_update', onPath);
    bot.on('end', onEnd);
    try {
      bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, range));
    } catch (err) {
      finish({ ok: false, info: err.message });
    }
  });
}

// ======================= GUI hadiah =======================

// Satu item hadiah: nama, enchant, masa berlaku, info lain, dan apakah key-nya kurang
function rewardInfo(item, slot) {
  const lore = loreOf(item);
  const ench = [];
  const extra = [];
  let lasts = null;
  let noKey = false;
  let mode = '';

  for (const l of lore) {
    if (/you don.?t have .* key/i.test(l)) { noKey = true; continue; }
    if (/^enchantments?:?$/i.test(l)) { mode = 'ench'; continue; }
    if (/click to (choose|claim)/i.test(l)) { mode = ''; continue; }
    if (/^lasts?:/i.test(l)) { lasts = l.replace(/^lasts?:\s*/i, ''); mode = ''; continue; }
    if (mode === 'ench') ench.push(l);
    else extra.push(l);
  }
  return {
    slot,
    name: labelOf(item),
    count: item.count || 1,
    ench,
    lasts,
    extra,
    noKey,
    isReward: lore.some((l) => /(choose|claim) this reward/i.test(l))
  };
}

function parseRewards(window) {
  const end = window.inventoryStart ?? window.slots.length;
  const all = [];
  for (let i = 0; i < end; i++) {
    if (window.slots[i]) all.push(rewardInfo(window.slots[i], i));
  }
  // Kalau tidak ada item berlore "Click to choose this reward", anggap semua item di GUI adalah hadiah
  const rewards = all.some((r) => r.isReward) ? all.filter((r) => r.isReward) : all;
  return {
    title: cleanLine(toText(window.title)) || null,
    rewards,
    noKey: rewards.some((r) => r.noKey)
  };
}

// Ringkasan satu baris: "Mending, Protection IV · Permanent"
function describeReward(r) {
  const parts = [];
  if (r.ench.length) parts.push(r.ench.join(', '));
  else if (r.extra.length) parts.push(r.extra.slice(0, 2).join(' · '));
  if (r.lasts) parts.push(r.lasts);
  return parts.join(' · ');
}

function closeWindowSafe(bot) {
  try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (e) {}
}

// Klik kanan chest → tunggu GUI terbuka. Pesan server (mis. "can't open that here") ikut ditangkap.
async function openCrate(bot, crate, timeoutMs = 10000) {
  const block = findChest(bot, crate);
  if (!block) return { ok: false, info: `Chest untuk ${crate.name} tidak ditemukan di bawah hologram.` };

  const center = block.position.offset(0.5, 0.5, 0.5);
  if (bot.entity.position.distanceTo(center) > 4) {
    const walked = await walkNear(bot, block.position, 2);
    if (!walked.ok) return { ok: false, info: walked.info };
  }
  try { await bot.lookAt(center, true); } catch (e) {}

  closeWindowSafe(bot);
  let lastMsg = null;
  const onMsg = (jm) => {
    const t = jm.toString().trim();
    if (/can.?t open|cannot open|sorry|don.?t have|no key|not allowed/i.test(t)) lastMsg = t;
  };
  bot.on('message', onMsg);

  const window = await new Promise((resolve) => {
    const onWin = (w) => { clearTimeout(timer); resolve(w); };
    const timer = setTimeout(() => { bot.removeListener('windowOpen', onWin); resolve(null); }, timeoutMs);
    bot.once('windowOpen', onWin);
    Promise.resolve(bot.activateBlock(block)).catch(() => {});
  });
  bot.removeListener('message', onMsg);

  if (!window) return { ok: false, info: lastMsg || 'GUI crate tidak terbuka (tidak ada respons dari server).' };

  await sleep(700); // item di GUI dimuat bertahap
  return { ok: true, window, ...parseRewards(window) };
}

// Dari video: klik hadiah → GUI konfirmasi 3 baris (merah = batal, hijau "Confirm — Claim <item> from <crate>")
// → klik Confirm → chat: "You claimed <item> from <crate> crate."
const CONFIRM_FALLBACK_SLOT = 15;

async function clickReward(bot, window, slot, username = 'Bot', timeoutMs = 9000) {
  const before = snapshot(bot);
  let verdict = null;
  let confirmWin = null;

  const onMsg = (jm) => {
    const t = jm.toString().trim();
    // Pesan umum yang ikut muncul tiap klik kanan crate ("Hey! Sorry, but you can't open that here.") BUKAN kegagalan
    if (/can.?t open that here/i.test(t)) return;
    if (/don.?t have .*key|no key|not enough|insufficient|need (a|an|more) .*key/i.test(t)) verdict = { ok: false, info: t };
    else if (/you claimed|claimed|received|obtained|you (got|won)/i.test(t)) verdict = { ok: true, info: t };
  };
  const onWin = (w) => { confirmWin = w; };
  bot.on('message', onMsg);
  bot.on('windowOpen', onWin);

  const click = (s) => Promise.resolve(bot.clickWindow(s, 0, 0)).catch((err) => log(username, `[CRATE] Peringatan klik slot ${s}: ${err.message}`));
  click(slot);

  // 1) tunggu GUI konfirmasi (kalau key kurang, server langsung membalas dengan pesan dan GUI ini tidak muncul)
  const t0 = Date.now();
  while (Date.now() - t0 < 3500 && !confirmWin && !verdict) await sleep(100);
  if (confirmWin && !verdict) {
    await sleep(500);
    const cslot = findSlot(confirmWin, 'confirm', CONFIRM_FALLBACK_SLOT);
    log(username, `[CRATE] Klik Confirm (slot ${cslot})`);
    click(cslot);
  }

  // 2) tunggu hasil: pesan "You claimed ..." atau item baru di inventaris
  const t1 = Date.now();
  let got = [];
  while (Date.now() - t1 < timeoutMs) {
    await sleep(300);
    got = diffNew(before, snapshot(bot));
    if (verdict || got.length) break;
  }
  bot.removeListener('message', onMsg);
  bot.removeListener('windowOpen', onWin);

  if (verdict && !verdict.ok) return { ok: false, info: verdict.info, got: [] };
  if (got.length) return { ok: true, info: verdict ? verdict.info : 'Hadiah diterima.', got };
  if (verdict) return { ok: true, info: verdict.info, got: [] }; // hadiah non-item (booster, efek, dst.)
  return { ok: false, uncertain: true, info: 'Tidak ada konfirmasi dari server. Cek inventaris / chat di game.', got: [] };
}

// ======================= Sesi =======================

async function restoreNow(bot, acc) {
  clearTimeout(bot._crateTimer);
  bot._crateTimer = null;
  closeWindowSafe(bot);

  const prev = bot._crateReturnTo;
  bot._crateReturnTo = null;
  const st = stats.get(acc.id);
  if (st.location !== 'Crates' || bot._disconnected) return;

  if (prev === 'AFK' || prev === 'Farm') {
    log(acc.username, '[CRATE] Kembali ke AFK...');
    bot.chat('/afk');
    st.location = 'AFK';
    await sleep(4000);
    if (prev === 'Farm' && !bot._disconnected) await goFarm(bot, acc, { skipAfk: true });
  }
}

function scheduleRestore(bot, acc) {
  clearTimeout(bot._crateTimer);
  bot._crateTimer = setTimeout(() => {
    if (!bot._crateBusy) restoreNow(bot, acc).catch(() => {});
  }, SESSION_MS);
}

// /warp crates (kalau belum di sana) lalu tunggu hologram crate termuat
async function ensureAtCrates(bot, acc) {
  const st = stats.get(acc.id);
  if (st.location !== 'Crates') {
    if (!bot._crateReturnTo) bot._crateReturnTo = st.location; // ingat lokasi sebelum pindah (untuk kembali AFK)
    log(acc.username, `[CRATE] ${WARP_COMMAND}...`);
    bot.chat(WARP_COMMAND);
    st.location = 'Crates';
    await sleep(4500);
  }
  for (let i = 0; i < 10; i++) {
    const crates = readCrates(bot);
    if (crates.length) return { ok: true, crates };
    await sleep(1000);
  }
  return { ok: false, info: 'Hologram crate tidak terbaca setelah /warp crates. Cek apakah warp-nya ada dan bot sudah sampai.' };
}

// Bungkus satu operasi: pindah ke crates → jalankan fn → (final) kembali AFK atau (tidak final) tunggu 2 menit lalu kembali
async function withCrates(bot, acc, fn, { final = false } = {}) {
  if (bot._state !== 'ecocpvp') return { ok: false, info: 'Bot belum berada di ecocpvp.' };
  if (bot._crateBusy || bot._walking || bot._buying || bot._selling) {
    return { ok: false, info: 'Bot sedang sibuk (crate/beli/jual/berjalan), coba lagi sebentar.' };
  }
  bot._crateBusy = true;
  try {
    const arrived = await ensureAtCrates(bot, acc);
    if (!arrived.ok) {
      await restoreNow(bot, acc);
      return arrived;
    }
    const out = await fn(arrived.crates);
    if (final) await restoreNow(bot, acc);
    else scheduleRestore(bot, acc);
    return out;
  } catch (err) {
    await restoreNow(bot, acc).catch(() => {});
    return { ok: false, info: err.message };
  } finally {
    bot._crateBusy = false;
  }
}

// Cari crate dari kata kunci: "crimson", "crimson crate", atau nomor urut (1, 2, ...)
function findCrate(crates, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  if (/^\d+$/.test(q) && crates[parseInt(q) - 1]) return crates[parseInt(q) - 1];
  return (
    crates.find((c) => c.short.toLowerCase() === q || c.name.toLowerCase() === q) ||
    crates.find((c) => c.name.toLowerCase().includes(q)) ||
    null
  );
}

// Cari hadiah dari nama ("boots") atau nomor slot ("12"). Hasil: { reward } atau { error }
function findReward(rewards, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { error: 'Sebutkan nama hadiah atau nomor slotnya.' };

  if (/^\d+$/.test(q)) {
    const bySlot = rewards.find((r) => r.slot === parseInt(q));
    return bySlot ? { reward: bySlot } : { error: `Tidak ada hadiah di slot ${q}.` };
  }
  const exact = rewards.filter((r) => r.name.toLowerCase() === q);
  if (exact.length === 1) return { reward: exact[0] };
  const part = rewards.filter((r) => r.name.toLowerCase().includes(q));
  if (part.length === 1) return { reward: part[0] };
  if (part.length > 1) {
    return { error: `"${query}" cocok dengan ${part.length} hadiah: ${part.map((r) => `${r.name} (slot ${r.slot})`).join(', ')}. Pakai nomor slot.` };
  }
  return { error: `Hadiah "${query}" tidak ditemukan. Yang ada: ${rewards.map((r) => r.name).join(', ')}` };
}

// ======================= API =======================

// Daftar crate + jumlah key (sesi tetap terbuka 2 menit supaya bisa langsung memilih crate)
function listCrates(bot, acc, { final = false } = {}) {
  return withCrates(bot, acc, async (crates) => ({ ok: true, crates }), { final });
}

// Buka satu crate dan baca isi hadiahnya
function openCrateByName(bot, acc, query) {
  return withCrates(bot, acc, async (crates) => {
    const crate = findCrate(crates, query);
    if (!crate) return { ok: false, info: `Crate "${query}" tidak ditemukan. Yang ada: ${crates.map((c) => c.short).join(', ')}` };
    const opened = await openCrate(bot, crate);
    closeWindowSafe(bot);
    if (!opened.ok) return { ok: false, info: opened.info };
    return { ok: true, crate, title: opened.title, rewards: opened.rewards, noKey: opened.noKey };
  });
}

// Ambil satu hadiah (memakai 1 key). pilihan: { slot, name } (dari menu) atau { itemQuery } (nama / nomor slot).
function claimReward(bot, acc, crateQuery, pilihan = {}) {
  return withCrates(bot, acc, async (crates) => {
    const crate = findCrate(crates, crateQuery);
    if (!crate) return { ok: false, info: `Crate "${crateQuery}" tidak ditemukan. Yang ada: ${crates.map((c) => c.short).join(', ')}` };
    const opened = await openCrate(bot, crate);
    if (!opened.ok) return { ok: false, info: opened.info };

    let target = null;
    if (pilihan.itemQuery) {
      const found = findReward(opened.rewards, pilihan.itemQuery);
      if (found.error) {
        closeWindowSafe(bot);
        return { ok: false, info: found.error };
      }
      target = found.reward;
    } else {
      // dari menu: pastikan slot masih berisi hadiah yang sama (isi crate bisa berubah)
      target =
        opened.rewards.find((r) => r.slot === pilihan.slot && (!pilihan.name || r.name === pilihan.name)) ||
        (pilihan.name && opened.rewards.find((r) => r.name === pilihan.name)) ||
        null;
    }
    if (!target) {
      closeWindowSafe(bot);
      return { ok: false, info: 'Hadiah itu sudah tidak ada di slot yang dipilih (isi crate berubah). Buka crate lagi dan pilih ulang.' };
    }

    log(acc.username, `[CRATE] Ambil "${target.name}" dari ${crate.name} (slot ${target.slot})`);
    const res = await clickReward(bot, opened.window, target.slot, acc.username);
    closeWindowSafe(bot);
    // Item hadiah di hotbar → bisa langsung dijual: !ah <harga>
    if (res.ok && res.got && res.got[0] && res.got[0].hotbar) bot._lastBought = { ...res.got[0], at: Date.now() };
    return { ...res, crate, reward: target };
  }, { final: true });
}

// Hanya jumlah key semua crate (lalu langsung kembali AFK)
function readKeys(bot, acc) {
  return listCrates(bot, acc, { final: true });
}

module.exports = {
  walkNear, readCrates, parseCrate, findChest, parseRewards, describeReward, findCrate,
  listCrates, openCrateByName, claimReward, readKeys, restoreNow, findReward
};
