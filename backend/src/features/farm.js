const fs = require('fs');
const path = require('path');
const { goals } = require('mineflayer-pathfinder');
const { accounts } = require('../core/config');
const { log } = require('../core/utils');
const stats = require('../core/stats');

// Titik farm yang diatur lewat !setfarm disimpan di sini (tetap ada setelah program di-restart).
// Kalau belum diatur, dipakai BOTn_TARGET_X / BOTn_TARGET_Z dari .env.
const FILE = path.join(__dirname, '..', '..', 'data', 'farm.json'); // data/ tidak ikut ke Git

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Titik farm akun: { x, z, source } atau null kalau belum diatur
function farmSpot(accId) {
  const o = loadOverrides()[accId];
  if (o && Number.isFinite(o.x) && Number.isFinite(o.z)) return { x: o.x, z: o.z, source: 'tersimpan' };
  const acc = accounts.find((a) => a.id === accId);
  if (acc && (acc.targetX || acc.targetZ)) return { x: acc.targetX, z: acc.targetZ, source: '.env' };
  return null;
}

function setFarmSpot(accId, x, z) {
  const o = loadOverrides();
  o[accId] = { x, z };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(o, null, 2));
}

// Posisi bot (dibulatkan ke bawah): { x, y, z } atau null
function posOf(bot) {
  const p = bot.entity && bot.entity.position;
  return p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null;
}

// Jalan ke koordinat X/Z lewat pathfinder. Resolve { ok, info }.
function walkTo(bot, x, z, timeoutMs = 90000) {
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

    const onReached = () => finish({ ok: true, info: `Sampai di X:${x} Z:${z}.` });
    const onPath = (r) => {
      if (r && r.status === 'noPath') finish({ ok: false, info: `Tidak ada jalur ke X:${x} Z:${z}.` });
    };
    const onEnd = () => finish({ ok: false, info: 'Bot terputus saat berjalan.' });

    timer = setTimeout(() => finish({ ok: false, info: `Timeout: bot belum sampai di X:${x} Z:${z}.` }), timeoutMs);

    bot.on('goal_reached', onReached);
    bot.on('path_update', onPath);
    bot.on('end', onEnd);

    try {
      bot.pathfinder.setGoal(new goals.GoalXZ(x, z));
    } catch (err) {
      finish({ ok: false, info: err.message });
    }
  });
}

// AFK di farm: (kalau belum) /afk → jalan ke titik farm → lokasi jadi "Farm"
// opts.skipAfk = true kalau /afk baru saja dikirim (dipakai oleh AUTO_FARM)
async function goFarm(bot, acc, opts = {}) {
  const spot = farmSpot(acc.id);
  if (!spot) {
    return {
      ok: false,
      info: `Titik farm ${acc.username} belum diatur. Pakai: !setfarm b${acc.id} [x z] (atau isi BOT${acc.id}_TARGET_X/Z di .env).`
    };
  }
  if (bot._state !== 'ecocpvp') return { ok: false, info: 'Bot belum berada di ecocpvp.' };
  if (bot._walking) return { ok: false, info: 'Bot sedang berjalan, coba lagi sebentar.' };

  bot._walking = true;
  try {
    const st = stats.get(acc.id);
    bot._hold = false; // kembali ke farm mengakhiri mode diam setelah teleport

    if (!opts.skipAfk && st.location !== 'AFK' && st.location !== 'Farm') {
      log(acc.username, '[FARM 1/2] /afk dulu...');
      bot.chat('/afk');
      st.location = 'AFK';
      await sleep(4000); // tunggu pindah ke area AFK
      if (bot._disconnected) return { ok: false, info: 'Bot terputus.' };
    }

    log(acc.username, `[FARM 2/2] Jalan ke X:${spot.x} Z:${spot.z}...`);
    const res = await walkTo(bot, spot.x, spot.z);
    if (res.ok) st.location = 'Farm';
    return { ...res, spot };
  } finally {
    bot._walking = false;
  }
}

module.exports = { farmSpot, setFarmSpot, posOf, walkTo, goFarm };
