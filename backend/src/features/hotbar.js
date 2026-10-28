const { botMap } = require('../core/bot');
const { accounts } = require('../core/config');
const { log } = require('../core/utils');
const { labelOf } = require('./items');
const { findSlot } = require('./shop');
const { HOTBAR_START } = require('./inv');

// Dari video: GUI /ah sell punya 5 baris, tombol hijau konfirmasi ada di bawah tengah (slot 40),
// tombol merah (batal) di pojok kanan bawah (slot 44). Durasi default sudah terpilih (7 hari).
const CONFIRM_FALLBACK_SLOT = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PRICE_RE = /^\d+(\.\d+)?[kmb]?$/i;

function nameOfBot(bot) {
  return accounts.find((a) => a.id === bot.accId)?.username || 'Bot';
}

// Pilih bot: tag "b2" → bot itu, tanpa tag → bot online pertama
function pickBot(tag) {
  if (tag) {
    const bot = botMap.get(parseInt(String(tag).replace(/^b/i, '')));
    return bot && !bot._disconnected ? bot : null;
  }
  for (const acc of accounts) {
    const bot = botMap.get(acc.id);
    if (bot && !bot._disconnected) return bot;
  }
  return null;
}

// Pilih bot untuk jual: tag → bot itu; tanpa tag → kalau hanya 1 bot online pakai itu,
// kalau lebih → bot yang paling baru membeli item
function pickSellBot(tag) {
  if (tag) return pickBot(tag);
  const online = Array.from(botMap.values()).filter((b) => !b._disconnected);
  if (online.length === 1) return online[0];
  const recent = online.filter((b) => b._lastBought).sort((a, b) => b._lastBought.at - a._lastBought.at);
  return recent[0] || null;
}

// Parse: ah [b1] [hotbar 1-9] <harga>   (harga boleh 5000 / 5k / 1.5m)
function parseAhArgs(args) {
  const out = { botTag: null, hotbar: null, price: null };
  const nums = [];
  for (const a of args) {
    if (/^b\d+$/i.test(a)) out.botTag = a.toLowerCase();
    else if (PRICE_RE.test(a)) nums.push(a);
  }
  if (nums.length >= 2) {
    out.hotbar = parseInt(nums[0]);
    out.price = nums[1];
  } else if (nums.length === 1) {
    out.price = nums[0];
  }
  return out;
}

// Isi hotbar sebagai baris teks: "3 │ Drill ×1  ◀ baru dibeli"
function hotbarLines(bot) {
  const lines = [];
  for (let i = 0; i < 9; i++) {
    const it = bot.inventory?.slots[HOTBAR_START + i];
    const mark = bot._lastBought && bot._lastBought.hotbar === i + 1 ? '  ◀ baru dibeli' : '';
    lines.push(`${i + 1} │ ${it ? `${labelOf(it)} ×${it.count}` : '(kosong)'}${mark}`);
  }
  return lines;
}

// Jual item dari hotbar lewat /ah sell <harga> (item harus di tangan utama).
// Alur sesuai video: pegang slot → /ah sell <harga> → GUI → klik Confirm → "Listing created!"
function sellHotbar(bot, username, hotbarNo, price, timeoutMs = 20000) {
  if (!(hotbarNo >= 1 && hotbarNo <= 9)) {
    return Promise.resolve({ ok: false, info: 'Nomor hotbar harus 1-9.' });
  }
  if (!PRICE_RE.test(String(price))) {
    return Promise.resolve({ ok: false, info: 'Harga tidak valid. Contoh: 5000, 5k, 1.5m' });
  }
  if (bot._buying || bot._selling) {
    return Promise.resolve({ ok: false, info: 'Bot sedang sibuk (beli/jual), coba lagi sebentar.' });
  }
  const item = bot.inventory?.slots[HOTBAR_START + hotbarNo - 1];
  if (!item) {
    return Promise.resolve({ ok: false, info: `Hotbar ${hotbarNo} kosong. Cek isi hotbar dengan: hotbar (console) atau !hotbar (Discord).` });
  }

  bot._selling = true;
  const itemName = labelOf(item);

  return new Promise((resolve) => {
    let finished = false;
    let clicked = false;
    let timer = null;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      bot.removeListener('windowOpen', onWindow);
      bot.removeListener('message', onMessage);
      try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (e) {}
      setTimeout(() => {
        bot._selling = false;
        resolve(result);
      }, 300);
    };

    const onMessage = (jsonMsg) => {
      const text = jsonMsg.toString().trim();
      const lower = text.toLowerCase();

      if (lower.includes('listing created')) {
        // "Listing created! #7130 Ender Pearl for $100. fee: $0. expires in 6D 23H 59M."
        const m = text.match(/#(\d+)\s+(.+?)\s+for\s+\$?([\d.,]+[kKmMbB]?)\.?\s+fee:?\s*\$?([\d.,]+[kKmMbB]?)\.?\s+expires in\s+(.+?)\.?\s*$/i);
        if (bot._lastBought && bot._lastBought.hotbar === hotbarNo) bot._lastBought = null;
        finish({
          ok: true,
          info: text,
          id: m ? m[1] : null,
          name: m ? m[2] : itemName,
          price: m ? m[3].replace(/[.,]+$/, '') : price,
          fee: m ? m[4].replace(/[.,]+$/, '') : null,
          expires: m ? m[5] : null
        });
      } else if (
        lower.startsWith('usage:') || lower.includes('hold the item') ||
        lower.includes('cannot list') || lower.includes("can't list") ||
        lower.includes('too many listings') || lower.includes('maximum listings') ||
        lower.includes('cannot sell')
      ) {
        finish({ ok: false, info: text });
      }
    };

    const onWindow = async (window) => {
      if (clicked) return;
      clicked = true;
      await sleep(700); // tunggu GUI selesai dimuat
      const slot = findSlot(window, 'confirm', findSlot(window, 'create', CONFIRM_FALLBACK_SLOT));
      log(username, `[AH 2/2] Klik Confirm (slot ${slot})`);
      Promise.resolve(bot.clickWindow(slot, 0, 0)).catch((err) => {
        log(username, `[AH] Peringatan klik slot ${slot}: ${err.message}`);
      });
    };

    timer = setTimeout(
      () => finish({ ok: false, info: 'Timeout: tidak ada konfirmasi listing dari server.' }),
      timeoutMs
    );

    bot.on('windowOpen', onWindow);
    bot.on('message', onMessage);

    (async () => {
      try {
        bot.setQuickBarSlot(hotbarNo - 1); // pegang item di tangan utama
        await sleep(400);
        log(username, `[AH 1/2] Hotbar ${hotbarNo} (${itemName}) → /ah sell ${price}`);
        bot.chat(`/ah sell ${price}`);
      } catch (err) {
        finish({ ok: false, info: err.message });
      }
    })();
  });
}

// Teks hasil jual untuk ditampilkan
function sellResultText(res) {
  if (!res.ok) return res.info;
  if (!res.id) return res.info;
  return `${res.name} — $${res.price} · fee $${res.fee} · expires ${res.expires} (#${res.id})`;
}

module.exports = { pickBot, pickSellBot, parseAhArgs, hotbarLines, sellHotbar, sellResultText, nameOfBot };
