const { log } = require('../core/utils');

// Cadangan kalau item "Money" tidak ditemukan lewat nama (dari video: slot 21)
const MONEY_FALLBACK_SLOT = 21;
// GUI konfirmasi: tombol hijau "Confirm" (dari video: slot 23)
const CONFIRM_FALLBACK_SLOT = 23;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { plainText, labelOf, loreOf, itemText } = require('./items');
const { snapshot, diffNew } = require('./inv');

// Cari slot (hanya bagian GUI, bukan inventaris pemain) berdasarkan kata kunci nama item
function findSlot(window, keyword, fallback) {
  const end = window.inventoryStart ?? window.slots.length;
  for (let i = 0; i < end; i++) {
    const item = window.slots[i];
    if (item && itemText(item).includes(keyword)) return i;
  }
  return fallback;
}

// Parse argumen: buy [b1] [slot|nama item] [x3]
function parseBuyArgs(args) {
  const out = { botTag: null, slot: null, keyword: null, times: 1 };
  const words = [];
  for (const a of args) {
    if (/^b\d+$/i.test(a)) out.botTag = a;
    else if (/^x\d+$/i.test(a)) out.times = Math.min(Math.max(parseInt(a.slice(1)), 1), 20);
    else if (/^\d+$/.test(a)) out.slot = parseInt(a);
    else words.push(a);
  }
  if (words.length) out.keyword = words.join(' ').toLowerCase();
  return out;
}

// Buka /shardshop dan kembalikan daftar item: [{ slot, name, lore }]
function listShop(bot, username, timeoutMs = 10000) {
  if (bot._buying) return Promise.resolve({ ok: false, info: 'Bot sedang membeli, coba lagi sebentar.' });
  bot._buying = true;

  return new Promise((resolve) => {
    let finished = false;
    let timer = null;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      bot.removeListener('windowOpen', onWindow);
      bot._buying = false;
      resolve(result);
    };

    const onWindow = async (window) => {
      await sleep(500); // tunggu item selesai dimuat
      const end = window.inventoryStart ?? window.slots.length;
      const items = [];
      for (let i = 0; i < end; i++) {
        const item = window.slots[i];
        if (item) items.push({ slot: i, name: labelOf(item), lore: loreOf(item) });
      }
      // Tutup GUI sekarang juga (bukan ditunda) supaya tidak menutup GUI pembelian berikutnya
      try { bot.closeWindow(window); } catch (e) {}
      setTimeout(() => finish({ ok: true, items }), 300);
    };

    timer = setTimeout(() => finish({ ok: false, info: 'Timeout: GUI /shardshop tidak terbuka.' }), timeoutMs);
    bot.on('windowOpen', onWindow);
    log(username, 'Buka /shardshop untuk daftar item...');
    bot.chat('/shardshop');
  });
}

// Satu kali pembelian. choice = { slot?, keyword? }. Tanpa choice → item "Money".
function buyOnce(bot, username, choice = {}, timeoutMs = 15000) {
  if (bot._buying) {
    return Promise.resolve({ ok: false, info: 'Pembelian sebelumnya masih berjalan.' });
  }
  bot._buying = true;

  const before = snapshot(bot); // isi inventaris sebelum beli (untuk tahu item baru masuk ke slot mana)

  return new Promise((resolve) => {
    let step = 1;
    let finished = false;
    let lastWindow = null;
    let timer = null;

    const finish = (ok, info) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      bot.removeListener('windowOpen', onWindow);
      bot.removeListener('message', onMessage);
      // GUI konfirmasi tetap terbuka setelah beli (terlihat di video) → tutup sekarang juga
      try { if (lastWindow && bot.currentWindow) bot.closeWindow(lastWindow); } catch (e) {}
      setTimeout(async () => {
        // Kalau berhasil: tunggu sebentar sampai item baru muncul di inventaris, lalu catat posisinya
        let got = [];
        if (ok) {
          for (let i = 0; i < 5; i++) {
            got = diffNew(before, snapshot(bot));
            if (got.length) break;
            await sleep(250);
          }
        }
        bot._buying = false;
        resolve({ ok, info, got });
      }, 400);
    };

    const onMessage = (jsonMsg) => {
      const text = jsonMsg.toString().trim();
      const lower = text.toLowerCase();
      if (lower.includes('you bought')) {
        finish(true, text);
      } else if (
        lower.includes('not enough') || lower.includes('insufficient') ||
        lower.includes('cannot afford') || lower.includes("can't afford") ||
        lower.includes('need more')
      ) {
        finish(false, text);
      }
    };

    const click = (slot) => {
      // Tidak di-await: GUI shop sering berganti window sehingga promise clickWindow bisa tidak selesai.
      Promise.resolve(bot.clickWindow(slot, 0, 0)).catch((err) => {
        log(username, `[BUY] Peringatan klik slot ${slot}: ${err.message}`);
      });
    };

    const onWindow = async (window) => {
      lastWindow = window;
      try {
        if (step === 1) {
          step = 2;
          await sleep(500);

          const end = window.inventoryStart ?? window.slots.length;
          let slot;
          if (choice.slot !== null && choice.slot !== undefined) slot = choice.slot;
          else if (choice.keyword) slot = findSlot(window, choice.keyword, -1);
          else slot = findSlot(window, 'money', MONEY_FALLBACK_SLOT);

          if (slot < 0 || slot >= end) {
            return finish(false, choice.keyword && slot < 0
              ? `Item "${choice.keyword}" tidak ditemukan di shop. Ketik: shop`
              : `Slot ${slot} di luar GUI shop (0-${end - 1}). Ketik: shop`);
          }
          const item = window.slots[slot];
          if (!item) return finish(false, `Slot ${slot} kosong. Ketik: shop untuk lihat daftar slot.`);

          log(username, `[BUY 1/2] Klik slot ${slot} (${labelOf(item)})`);
          click(slot);
        } else if (step === 2) {
          step = 3;
          await sleep(700);
          const slot = findSlot(window, 'confirm', CONFIRM_FALLBACK_SLOT);
          log(username, `[BUY 2/2] Klik Confirm (slot ${slot})`);
          click(slot);
        }
      } catch (err) {
        finish(false, err.message);
      }
    };

    timer = setTimeout(
      () => finish(false, 'Timeout: tidak ada konfirmasi pembelian dari server.'),
      timeoutMs
    );

    bot.on('windowOpen', onWindow);
    bot.on('message', onMessage);
    bot.chat('/shardshop');
  });
}

// Beli beberapa kali berturut-turut (berhenti kalau ada yang gagal)
async function buyItem(bot, username, choice = {}, times = 1) {
  let done = 0;
  let last = { ok: false, info: '', got: [] };
  for (let i = 0; i < times; i++) {
    last = await buyOnce(bot, username, choice);
    if (!last.ok) break;
    done++;
    if (i < times - 1) await sleep(2500);
  }

  // Ingat item terakhir yang dibeli (dan posisinya) supaya bisa langsung dijual: !ah <harga>
  const got = last.got || [];
  if (done > 0 && got.length && got[0].hotbar) {
    bot._lastBought = { ...got[0], at: Date.now() };
  }
  return { ok: done === times, done, times, info: last.info, got };
}

// Format daftar item jadi teks (untuk console / Discord)
function formatShop(items) {
  return items.map((it) => {
    const price = it.lore.find((l) => /price|harga|cost/i.test(l));
    return `${String(it.slot).padStart(2, ' ')} → ${it.name}${price ? ` | ${price}` : ''}`;
  });
}

// Ambil teks harga dari lore: "Buy price: ★ 200 Shards" / "Price: 3,000 shards" → "200 Shards"
function priceOf(lore) {
  for (const l of lore) {
    const m = l.match(/(\d[\d.,]*\s*[kKmMbB]?)\s*shards?\b/i);
    if (m) return `${m[1].replace(/\s+/g, '')} Shards`;
  }
  return null;
}

// Daftar item yang bisa dipilih: [{ slot, label, price }]
// - Hanya item yang punya harga (kalau tidak ada yang terbaca, tampilkan semua selain tombol close/back)
// - Nama yang sama (mis. beberapa "Spawner" atau "Money") dibedakan dengan baris pertama lore (Cow, 1M, dst)
function buildEntries(items) {
  const withPrice = items.map((it) => ({ ...it, price: priceOf(it.lore) }));
  let pool = withPrice.filter((it) => it.price);
  if (!pool.length) {
    pool = withPrice.filter((it) => !/close|back|exit|info|next|prev|cancel/i.test(it.name));
  }

  const count = {};
  pool.forEach((it) => { count[it.name] = (count[it.name] || 0) + 1; });

  return pool.map((it) => {
    let label = it.name;
    if (count[it.name] > 1) {
      const extra = it.lore.find((l) => l && !/price|harga|cost|shards?/i.test(l));
      if (extra) label = `${it.name} — ${extra}`;
    }
    return { slot: it.slot, label: label.slice(0, 100), price: it.price };
  });
}

module.exports = { buyItem, listShop, parseBuyArgs, formatShop, buildEntries, priceOf, findSlot, buyMoney: (b, u) => buyItem(b, u) };
