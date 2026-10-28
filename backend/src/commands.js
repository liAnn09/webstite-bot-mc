const readline = require('readline');
const { accounts } = require('./core/config');
const { log, randomDelay, printStatus, countShards, printHelp } = require('./core/utils');
const { botMap, controlBots } = require('./core/bot');
const { readBoard, shardsText } = require('./features/board');
const { rateText } = require('./features/rate');
const { buildTp, cancelAutoReturn, watchTeleport } = require('./features/tp');
const { farmSpot, setFarmSpot, posOf, walkTo, goFarm } = require('./features/farm');
const stats = require('./core/stats');
const { snapshot: playersSnapshot, playersText } = require('./features/players');
const { serverAdmin } = require('./discord/discordBot');
const crates = require('./features/crates');
const { setHome, goHome, delHome, listHomes } = require('./features/homes');
const spawner = require('./features/spawner');
const { buyItem, listShop, parseBuyArgs, formatShop } = require('./features/shop');
const { gotMessage } = require('./features/inv');
const { pickBot, pickSellBot, parseAhArgs, hotbarLines, sellHotbar, sellResultText } = require('./features/hotbar');

function resolveBots(tag) {
  if (!tag) return Array.from(botMap.values());
  const clean = tag.toLowerCase().replace('b', '');
  const n = parseInt(clean);
  if (!isNaN(n) && botMap.has(n)) return [botMap.get(n)];
  return [];
}

function nameOf(bot) {
  return accounts.find(a => a.id === bot.accId)?.username || 'Bot';
}

function setupCommands() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('line', (line) => {
    // Hilangkan tanda [ dan ] jika pengguna mengetik contohnya [ping] atau [buy b1]
    const cleanedLine = line.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    const parts = cleanedLine.split(/\s+/);
    if (parts.length === 0 || !parts[0]) return;

    const action = parts[0].toLowerCase();

    // ====== shop [b1] ======
    // Lihat isi /shardshop beserta nomor slot-nya
    if (action === 'shop') {
      const targetBots = resolveBots(parts[1]);
      if (targetBots.length === 0) {
        console.log(`Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }
      const bot = targetBots[0];
      listShop(bot, nameOf(bot)).then((res) => {
        if (!res.ok) return console.log(`[SHOP ERROR] ${res.info}`);
        console.log(`\n── Isi /shardshop (slot → item) ──`);
        formatShop(res.items).forEach((l) => console.log('  ' + l));
        console.log('Beli: buy [b1] <slot|nama> [x3]   contoh: buy b1 21   |   buy money x3\n');
      });
      return;
    }

    // ====== help ======
    if (action === 'help' || action === '?') {
      printHelp();
      return;
    }

    // ====== buy [b1] [slot|nama] [xN] ======
    // Contoh: buy | buy b1 | buy 21 | buy b2 21 | buy b1 money x3
    // Alur: /shardshop → klik item pilihan → GUI konfirmasi → klik Confirm hijau
    if (action === 'buy') {
      const opt = parseBuyArgs(parts.slice(1));
      const targetBots = resolveBots(opt.botTag);
      if (targetBots.length === 0) {
        console.log(`Bot ${opt.botTag || ''} tidak aktif.`);
        return;
      }

      targetBots.forEach(async (bot) => {
        const username = nameOf(bot);
        const what = opt.slot !== null ? `slot ${opt.slot}` : opt.keyword ? `"${opt.keyword}"` : 'Money (default)';
        log(username, `Beli ${what}${opt.times > 1 ? ` x${opt.times}` : ''} di /shardshop...`);
        const res = await buyItem(bot, username, { slot: opt.slot, keyword: opt.keyword }, opt.times);
        log(username, res.ok
          ? `[BUY COMPLETE] ${res.done}x berhasil. ${res.info}`
          : `[BUY ERROR] ${res.done}/${res.times} berhasil. ${res.info}`);
        const where = gotMessage(res.got, bot.accId, '');
        if (where) where.split('\n').forEach((l) => log(username, `[BUY] ${l}`));
      });
      return;
    }

    // ====== hotbar [b1] ======
    if (action === 'hotbar') {
      const bot = pickBot(parts[1]);
      if (!bot) {
        console.log(`Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }
      console.log(`\n── Hotbar ${nameOf(bot)} ──`);
      hotbarLines(bot).forEach((l) => console.log('  ' + l));
      console.log('Jual: ah [b1] <hotbar 1-9> <harga>   contoh: ah b1 3 5000\n');
      return;
    }

    // ====== ah [b1] [hotbar 1-9] <harga> ======
    // Jual item dari hotbar lewat /ah sell. Tanpa nomor hotbar = item yang terakhir dibeli.
    if (action === 'ah') {
      const opt = parseAhArgs(parts.slice(1));
      const bot = pickSellBot(opt.botTag);
      if (!bot) {
        console.log(opt.botTag
          ? `Bot ${opt.botTag} tidak aktif.`
          : 'Ada lebih dari 1 bot aktif dan belum ada yang baru beli item. Sebutkan botnya, contoh: ah b1 3 5000');
        return;
      }
      const hotbar = opt.hotbar !== null ? opt.hotbar : (bot._lastBought ? bot._lastBought.hotbar : null);
      if (!opt.price || hotbar === null) {
        console.log('Format: ah [b1] <hotbar 1-9> <harga>   contoh: ah 3 5000  (tanpa hotbar = item terakhir yang dibeli)');
        return;
      }
      const username = nameOf(bot);
      sellHotbar(bot, username, hotbar, opt.price).then((res) => {
        log(username, res.ok ? `[BUY AH LISTED] ${sellResultText(res)}` : `[BUY AH ERROR] ${res.info}`);
      });
      return;
    }

    // ====== money [b1] [raw] ======
    // Saldo Money / Shards / Coins dari papan skor (sidebar). "money raw" = tampilkan semua baris mentah.
    if (action === 'money') {
      const raw = parts.slice(1).some((p) => p.toLowerCase() === 'raw');
      const tag = parts.slice(1).find((p) => /^b?\d+$/i.test(p));
      const targetBots = resolveBots(tag);
      if (targetBots.length === 0) {
        console.log(`Bot ${tag || ''} tidak aktif.`);
        return;
      }
      targetBots.forEach((bot) => {
        const b = readBoard(bot);
        console.log(`\n── Papan skor ${nameOf(bot)}${b.title ? ` (${b.title})` : ''} ──`);
        if (!b.lines.length) {
          console.log('  Papan skor tidak terbaca (bot di lobby / belum dimuat).');
        } else if (raw) {
          b.lines.forEach((l) => console.log('  ' + l));
        } else {
          console.log(`  Money : ${b.values.money || '-'}`);
          console.log(`  Shards: ${b.values.shards || '-'}`);
          console.log(`  Coins : ${b.values.coins || '-'}`);
          if (!b.values.money && !b.values.shards) console.log('  (label tidak ditemukan — coba: money raw)');
        }
      });
      console.log('');
      return;
    }

    // ====== rate [b1] ======
    if (action === 'rate') {
      const n = parts[1] ? parseInt(parts[1].replace(/^b/i, '')) : null;
      console.log(rateText(isNaN(n) ? null : n));
      return;
    }

    // ====== bot <stop|start|restart> [b1|all] ======
    // (di console "stop" sudah dipakai untuk berhenti bergerak, jadi pakai awalan "bot")
    if (action === 'bot') {
      const sub = (parts[1] || '').toLowerCase();
      if (!['stop', 'start', 'restart'].includes(sub)) {
        console.log('Format: bot <stop|start|restart> <b1|all>');
        return;
      }
      if (sub === 'stop' && !parts[2]) {
        console.log('Sebutkan bot: bot stop b1  atau  bot stop all');
        return;
      }
      controlBots(sub, parts[2]).forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.info}`));
      return;
    }

    // ====== tp <b1|all> <pemain|spawn|home [nama]|warp <nama>> ======
    if (action === 'tp') {
      const tag = (parts[1] || '').toLowerCase();
      if (!(tag === 'all' || /^b\d+$/.test(tag))) {
        console.log('Sebutkan bot: tp b1 <tujuan>  atau  tp all <tujuan>   (tujuan: pemain | spawn | home [nama] | warp <nama>)');
        return;
      }
      const tp = buildTp(parts.slice(2));
      if (tp.error) return console.log(tp.error);
      const targetBots = resolveBots(tag === 'all' ? null : tag);
      if (targetBots.length === 0) return console.log(`Bot ${tag} tidak aktif.`);
      targetBots.forEach((bot) => {
        if (tp.kind === 'player') cancelAutoReturn(bot);
        bot.chat(tp.cmd);
        log(nameOf(bot), `[CMD SENT] ${tp.cmd}`);
        if (tp.kind === 'player') {
          watchTeleport(bot, accounts.find((a) => a.id === bot.accId), `TP ${tp.player}`);
          log(nameOf(bot), `[TP] Setelah ${tp.player} menerima, bot diam di sana (tidak kembali AFK). Kembali: farm b${bot.accId}`);
        }
      });
      return;
    }

    // ====== tpaccept [b1|all] ======
    if (action === 'tpaccept') {
      const targetBots = resolveBots(!parts[1] || parts[1].toLowerCase() === 'all' ? null : parts[1]);
      if (targetBots.length === 0) return console.log(`Bot ${parts[1] || ''} tidak aktif.`);
      targetBots.forEach((bot) => {
        bot.chat('/tpaccept');
        log(nameOf(bot), '[CMD SENT] /tpaccept');
        watchTeleport(bot, accounts.find((a) => a.id === bot.accId), 'TP');
      });
      return;
    }

    // ====== pos [b1] ======
    if (action === 'pos') {
      const targetBots = resolveBots(!parts[1] || parts[1].toLowerCase() === 'all' ? null : parts[1]);
      if (targetBots.length === 0) return console.log(`Bot ${parts[1] || ''} tidak aktif.`);
      targetBots.forEach((bot) => {
        const p = posOf(bot);
        const f = farmSpot(bot.accId);
        const dist = p && f ? Math.round(Math.hypot(p.x - f.x, p.z - f.z)) : null;
        log(nameOf(bot), `[POS] ${p ? `X:${p.x} Y:${p.y} Z:${p.z}` : 'belum diketahui'} | lokasi: ${stats.get(bot.accId).location}` +
          (f ? ` | farm: X:${f.x} Z:${f.z}${dist !== null ? ` (${dist} blok)` : ''}` : ' | farm: belum diatur'));
      });
      return;
    }

    // ====== goto <b1> <x> <z> ======
    if (action === 'goto') {
      const x = parseInt(parts[2]);
      const z = parseInt(parts[3]);
      if (!/^b\d+$/i.test(parts[1] || '') || isNaN(x) || isNaN(z)) return console.log('Format: goto <b1> <x> <z>');
      const bot = resolveBots(parts[1])[0];
      if (!bot) return console.log(`Bot ${parts[1]} tidak aktif.`);
      log(nameOf(bot), `[GOTO] Jalan ke X:${x} Z:${z}...`);
      walkTo(bot, x, z).then((res) => log(nameOf(bot), `[GOTO] ${res.ok ? '✅' : '❌'} ${res.info}`));
      return;
    }

    // ====== farm [b1|all] — /afk (kalau belum) lalu jalan ke titik farm ======
    if (action === 'farm') {
      const targetBots = resolveBots(!parts[1] || parts[1].toLowerCase() === 'all' ? null : parts[1]);
      if (targetBots.length === 0) return console.log(`Bot ${parts[1] || ''} tidak aktif.`);
      targetBots.forEach((bot) => {
        const acc = accounts.find((a) => a.id === bot.accId);
        goFarm(bot, acc).then((res) => log(nameOf(bot), res.ok ? `[FARM] ✅ ${res.info} AFK di farm.` : `[FARM ERROR] ${res.info}`));
      });
      return;
    }

    // ====== setfarm <b1> [x z] — simpan titik farm (tanpa x z = posisi bot sekarang) ======
    if (action === 'setfarm') {
      if (!/^b\d+$/i.test(parts[1] || '')) return console.log('Format: setfarm <b1> [x z]   (tanpa x z = pakai posisi bot sekarang)');
      const bot = resolveBots(parts[1])[0];
      if (!bot) return console.log(`Bot ${parts[1]} tidak aktif.`);
      let x = parseInt(parts[2]);
      let z = parseInt(parts[3]);
      if (isNaN(x) || isNaN(z)) {
        const p = posOf(bot);
        if (!p) return console.log('Posisi bot belum diketahui.');
        x = p.x;
        z = p.z;
      }
      setFarmSpot(bot.accId, x, z);
      log(nameOf(bot), `[FARM] Titik farm disimpan: X:${x} Z:${z}. Jalankan: farm b${bot.accId}`);
      return;
    }

    // ====== players [b1] [nama] — pemain online di server (dari tab list) ======
    if (action === 'players' || action === 'online') {
      const args = parts.slice(1);
      const tag = args.find((a) => /^b\d+$/i.test(a));
      const search = args.filter((a) => a !== tag).join(' ');
      const snap = playersSnapshot(tag || null);
      if (!snap) return console.log(tag ? `Bot ${tag} tidak aktif.` : 'Tidak ada bot online untuk membaca daftar pemain.');
      console.log(playersText(snap, search));
      return;
    }

    // ====== server <create|setup|invite> ======
    // create = bot membuat server Discord baru lengkap dengan channel & role | setup = bangun/perbaiki server yang ada
    if (action === 'server') {
      const sub = (parts[1] || '').toLowerCase();
      serverAdmin(sub)
        .then((lines) => lines.forEach((l) => console.log(l)))
        .catch((err) => console.log(`[DISCORD] Gagal: ${err.message}\n  Kalau "server create" ditolak Discord, buat server kosong secara manual, undang bot (server invite), isi DISCORD_GUILD_ID di .env.`));
      return;
    }

    // ====== spawner [b1] | spawner drop <b1> | spawner auto on|off <b1|all> | spawner limit <jumlah> <b1|all> | spawner stop [b1] ======
    if (action === 'spawner') {
      const SUBS = ['drop', 'auto', 'limit', 'stop', 'status'];
      const first = (parts[1] || '').toLowerCase();
      const sub = SUBS.includes(first) ? first : 'status';
      const rest = SUBS.includes(first) ? parts.slice(2) : parts.slice(1);
      const tag = rest.find((a) => /^(b\d+|all)$/i.test(a));
      const others = rest.filter((a) => a !== tag);
      const accOf = (bot) => accounts.find((a) => a.id === bot.accId);
      const online = Array.from(botMap.values()).filter((b) => b._state === 'ecocpvp');
      let bots;
      if (tag && tag.toLowerCase() === 'all') bots = online;
      else if (tag) bots = resolveBots(tag);
      else bots = sub === 'status' ? online : online.length === 1 ? online : [];
      if (!bots.length) return console.log(tag ? `Bot ${tag} tidak aktif.` : 'Sebutkan botnya (b1 / all), atau tidak ada bot online di ecocpvp.');
      const fmt = (n) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('id-ID'));

      if (sub === 'status') {
        bots.forEach((bot, i) => setTimeout(() => {
          const s = spawner.getSettings(bot.accId);
          spawner.readCount(bot, accOf(bot)).then((r) => log(nameOf(bot), r.ok
            ? `[SPAWNER] Bone ${fmt(r.count)} | batas ${fmt(s.threshold)} | auto ${s.auto ? 'aktif' : 'mati'}`
            : `[SPAWNER] Gagal: ${r.info}`));
        }, i * 1200));
        return;
      }
      if (sub === 'drop') {
        if (bots.length !== 1) return console.log('Drop untuk satu bot saja: spawner drop b1');
        const bot = bots[0];
        const s = spawner.getSettings(bot.accId);
        log(nameOf(bot), `[SPAWNER] Drop dimulai (sisa dipertahankan ${fmt(s.keep)}). Bisa 15-20 menit...`);
        spawner.dropSession(bot, accOf(bot), { keep: s.keep }).then((d) => log(nameOf(bot), d.ok
          ? `[SPAWNER] Drop selesai: ${fmt(d.before)} → ${fmt(d.after)} (${d.rounds} ronde, ${d.seconds} detik)`
          : `[SPAWNER] Drop berhenti: ${d.info}${d.before !== undefined ? ` (${fmt(d.before)} → ${fmt(d.after)})` : ''}`));
        return;
      }
      if (sub === 'auto') {
        const mode = (others[0] || '').toLowerCase();
        if (mode !== 'on' && mode !== 'off') return console.log('Format: spawner auto on|off <b1|all>');
        bots.forEach((bot) => spawner.saveSettings(bot.accId, { auto: mode === 'on' }));
        console.log(`Pantau spawner ${mode === 'on' ? 'AKTIF' : 'MATI'}: ${bots.map(nameOf).join(', ')}`);
        if (mode === 'on') bots.forEach((bot) => { if (spawner.eligible(bot, accOf(bot))) spawner.checkOnce(bot, accOf(bot)).catch(() => {}); });
        return;
      }
      if (sub === 'limit') {
        const amount = spawner.parseAmount(others[0]);
        if (amount === null || amount < 1) return console.log('Format: spawner limit <jumlah> <b1|all>   contoh: spawner limit 500k b1');
        bots.forEach((bot) => spawner.saveSettings(bot.accId, { threshold: amount }));
        console.log(`Batas drop ${bots.map(nameOf).join(', ')} = ${fmt(amount)} bone`);
        return;
      }
      if (sub === 'stop') {
        const stopped = bots.filter((b) => spawner.stopDrop(b));
        console.log(stopped.length ? `Drop dihentikan: ${stopped.map(nameOf).join(', ')}` : 'Tidak ada drop yang berjalan.');
        return;
      }
    }

    // ====== sethome <nama> <b1|all> | home [nama] <b1|all> | delhome <nama> <b1|all> | homes [b1] ======
    if (action === 'sethome' || action === 'home' || action === 'delhome' || action === 'homes') {
      const args = parts.slice(1);
      const tag = args.find((a) => /^(b\d+|all)$/i.test(a));
      const name = args.filter((a) => a !== tag)[0] || null;
      const usage = { sethome: 'sethome <nama> <b1|all>', home: 'home [nama] <b1|all>', delhome: 'delhome <nama> <b1|all>', homes: 'homes [b1]' }[action];

      let targets;
      if (tag && tag.toLowerCase() !== 'all') targets = resolveBots(tag);
      else if (tag) targets = resolveBots(null);
      else {
        const online = resolveBots(null);
        targets = action === 'homes' ? online.slice(0, 1) : online.length === 1 ? online : [];
      }
      if (!targets.length) return console.log(tag ? `Bot ${tag} tidak aktif.` : `Sebutkan botnya agar tidak terkirim ke semua akun. Format: ${usage}`);
      if ((action === 'sethome' || action === 'delhome') && !name) return console.log(`Nama home wajib diisi. Format: ${usage}`);

      const fn = { sethome: setHome, home: goHome, delhome: delHome, homes: listHomes }[action];
      targets.forEach((bot, i) => {
        setTimeout(() => {
          fn(bot, accounts.find((a) => a.id === bot.accId), name).then((res) => {
            log(nameOf(bot), `[HOME] ${res.ok ? 'OK' : 'GAGAL'}: ${res.info}`);
            if (action === 'home' && res.ok) log(nameOf(bot), '[HOME] Bot AFK di sini dan lompat otomatis (anti-AFK). Kembali ke farm: farm b' + bot.accId);
          });
        }, i * 800);
      });
      return;
    }

    // ====== Crates ======
    const crateBot = (tag) => {
      const t = tag && /^b\d+$/i.test(tag) ? tag : null;
      const list = resolveBots(t);
      return list.find((b) => b._state === 'ecocpvp') || list[0] || null;
    };
    const keyLine = (c) => `${c.name}: ${c.keys === null ? '?' : c.keys} key`;

    // crates [b1] — daftar crate + jumlah key
    if (action === 'crates') {
      const bot = crateBot(parts[1]);
      if (!bot) return console.log('Tidak ada bot online.');
      log(nameOf(bot), '[CRATE] Pindah ke /warp crates dan membaca crate...');
      crates.listCrates(bot, accounts.find((a) => a.id === bot.accId)).then((res) => {
        if (!res.ok) return log(nameOf(bot), `[CRATE ERROR] ${res.info}`);
        console.log(`\n── Crates (dari ${nameOf(bot)}) ──`);
        res.crates.forEach((c, i) => console.log(`  ${i + 1}. ${keyLine(c)}`));
        console.log('Buka: crate <nama>   |   Bot kembali AFK otomatis setelah 2 menit\n');
      });
      return;
    }

    // crate <nama> [b1] — buka crate, tampilkan hadiah dengan nomor slot
    if (action === 'crate') {
      const tag = parts.slice(1).find((p) => /^b\d+$/i.test(p));
      const query = parts.slice(1).filter((p) => p !== tag).join(' ');
      if (!query) return console.log('Format: crate <nama> [b1]   contoh: crate common');
      const bot = crateBot(tag);
      if (!bot) return console.log('Tidak ada bot online.');
      log(nameOf(bot), `[CRATE] Membuka crate "${query}"...`);
      crates.openCrateByName(bot, accounts.find((a) => a.id === bot.accId), query).then((res) => {
        if (!res.ok) return log(nameOf(bot), `[CRATE ERROR] ${res.info}`);
        console.log(`\n── ${res.crate.name} · key: ${res.crate.keys === null ? '?' : res.crate.keys}${res.noKey ? ' · TIDAK PUNYA KEY' : ''} ──`);
        res.rewards.forEach((r) => {
          const d = crates.describeReward(r);
          console.log(`  ${String(r.slot).padStart(2)} │ ${r.name}${d ? ' — ' + d : ''}`);
        });
        console.log(`Ambil: claim ${res.crate.short} <item|slot>   (memakai 1 key)\n`);
      });
      return;
    }

    // claim <crate> <item|slot> [b1] — ambil hadiah
    if (action === 'claim' || action === 'ambil') {
      const tag = parts.slice(1).find((p) => /^b\d+$/i.test(p));
      const rest = parts.slice(1).filter((p) => p !== tag);
      if (rest.length < 2) return console.log('Format: claim <crate> <item|slot> [b1]   contoh: claim common boots');
      const bot = crateBot(tag);
      if (!bot) return console.log('Tidak ada bot online.');
      log(nameOf(bot), `[CRATE] Mengambil "${rest.slice(1).join(' ')}" dari ${rest[0]} (memakai 1 key)...`);
      crates.claimReward(bot, accounts.find((a) => a.id === bot.accId), rest[0], { itemQuery: rest.slice(1).join(' ') }).then((res) => {
        log(nameOf(bot), res.ok ? `[CRATE] Berhasil: ${res.info}` : `[CRATE ERROR] ${res.info}`);
        if (res.ok && res.got && res.got.length) res.got.forEach((g) => log(nameOf(bot), `[CRATE] ${g.label} x${g.count} masuk ${g.hotbar ? 'hotbar ' + g.hotbar : 'inventaris'}`));
      });
      return;
    }

    // keys [b1|all] — jumlah key tiap crate
    if (action === 'keys') {
      const all = !parts[1] || parts[1].toLowerCase() === 'all';
      const bots = all ? Array.from(botMap.values()).filter((b) => b._state === 'ecocpvp') : resolveBots(parts[1]);
      if (!bots.length) return console.log('Tidak ada bot online di ecocpvp.');
      bots.forEach((bot, i) => {
        setTimeout(() => {
          log(nameOf(bot), '[CRATE] Membaca key...');
          crates.readKeys(bot, accounts.find((a) => a.id === bot.accId)).then((res) => {
            if (!res.ok) return log(nameOf(bot), `[CRATE ERROR] ${res.info}`);
            log(nameOf(bot), `[CRATE] Key → ${res.crates.map(keyLine).join(' | ')}`);
          });
        }, i * 1500);
      });
      return;
    }

    // ====== ping [b1/b2/b3] ======
    if (action === 'ping') {
      const targetBots = resolveBots(parts[1]);
      if (targetBots.length === 0) {
        console.log(`Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }

      targetBots.forEach((bot) => {
        const ping = bot.player ? bot.player.ping : 'N/A';
        log(nameOf(bot), `[PING] ${ping}ms`);
      });
      return;
    }

    // ====== shards [b1/b2/b3] ======
    if (action === 'shards' || action === 'shard') {
      const targetBots = resolveBots(parts[1]);
      if (targetBots.length === 0) {
        console.log(`Bot ${parts[1] || ''} tidak aktif.`);
        return;
      }

      targetBots.forEach((bot) => {
        const total = shardsText(bot);
        log(nameOf(bot), `[SHARDS TOTAL] Total Shard: ${total}`);
      });
      return;
    }

    // ====== status ======
    if (action === 'status') {
      printStatus(botMap, accounts);
      return;
    }

    // ====== pay <player> <jumlah> [b1/b2/b3] ======
    if (action === 'pay') {
      const targetPlayer = parts[1];
      const amount = parts[2];

      if (!targetPlayer || !amount) {
        console.log('Format: pay <player> <jumlah> [b1/b2/b3]');
        return;
      }

      const targetBots = resolveBots(parts[3]);
      if (targetBots.length === 0) {
        console.log(`Bot ${parts[3] || ''} tidak aktif.`);
        return;
      }

      targetBots.forEach((bot) => {
        const cmd = `/pay ${targetPlayer} ${amount}`;
        setTimeout(() => {
          bot.chat(cmd);
          log(nameOf(bot), `[PAY SENT] ${cmd}`);
        }, randomDelay(300, 100));
      });
      return;
    }

    // ====== cmd <perintah custom> [b1/b2/b3] ======
    // Contoh: cmd /spawn b1  atau  cmd /balance  atau  cmd /clan home b2
    if (action === 'cmd' || action === 'run') {
      const lastArg = parts[parts.length - 1];
      const lastNum = parseInt(lastArg.replace(/^b/i, ''));
      const isTargeted = parts.length > 2 && !isNaN(lastNum) && botMap.has(lastNum);

      const targetBots = isTargeted ? [botMap.get(lastNum)] : Array.from(botMap.values());
      const cmdWords = isTargeted ? parts.slice(1, -1) : parts.slice(1);

      if (targetBots.length === 0 || cmdWords.length === 0) {
        console.log('Format: cmd <perintah_minecraft> [b1/b2/b3]');
        return;
      }

      const customCmd = cmdWords.join(' ');
      targetBots.forEach((bot) => {
        bot.chat(customCmd);
        log(nameOf(bot), `[CMD SENT] ${customCmd}`);
      });
      return;
    }

    // ====== say <pesan> [b1/b2/b3] ======
    if (action === 'say') {
      const lastArg = parts[parts.length - 1];
      const lastNum = parseInt(lastArg.replace(/^b/i, ''));
      const isTargeted = parts.length > 2 && !isNaN(lastNum) && botMap.has(lastNum);

      const targetBots = isTargeted ? [botMap.get(lastNum)] : Array.from(botMap.values());
      const msgWords = isTargeted ? parts.slice(1, -1) : parts.slice(1);

      if (targetBots.length === 0 || msgWords.length === 0) {
        console.log('Format: say <pesan> [b1/b2/b3]');
        return;
      }

      targetBots.forEach((bot) => bot.chat(msgWords.join(' ')));
      return;
    }

    // ====== w/s/a/d/space/stop [b1/b2/b3] ======
    const targetBots = resolveBots(parts[1]);
    if (targetBots.length === 0) {
      console.log(`Bot ${parts[1] || ''} tidak aktif.`);
      return;
    }

    targetBots.forEach((bot) => {
      if (action === 'w') bot.setControlState('forward', true);
      else if (action === 's') bot.setControlState('back', true);
      else if (action === 'a') bot.setControlState('left', true);
      else if (action === 'd') bot.setControlState('right', true);
      else if (action === 'space') {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 300);
      } else if (action === 'stop') bot.clearControlStates();
    });
  });
}

module.exports = { setupCommands };
