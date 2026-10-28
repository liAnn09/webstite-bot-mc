const { labelOf } = require('./items');

// Slot inventaris pemain di mineflayer: 9-35 = inventaris utama, 36-44 = hotbar 1-9
const HOTBAR_START = 36;

// Foto isi inventaris + hotbar: { slot: { name, count, label } }
function snapshot(bot) {
  const out = {};
  if (!bot.inventory) return out;
  for (let i = 9; i <= 44; i++) {
    const it = bot.inventory.slots[i];
    if (it) out[i] = { name: it.name, count: it.count, label: labelOf(it) };
  }
  return out;
}

// Bandingkan dua snapshot → item yang baru masuk / bertambah jumlahnya
function diffNew(before, after) {
  const found = [];
  for (const [slotStr, it] of Object.entries(after)) {
    const slot = parseInt(slotStr);
    const b = before[slot];
    const sameItem = b && b.name === it.name;
    if (!sameItem || it.count > b.count) {
      found.push({
        slot,
        label: it.label,
        count: sameItem ? it.count - b.count : it.count,
        hotbar: slot >= HOTBAR_START ? slot - HOTBAR_START + 1 : null
      });
    }
  }
  // Hotbar didahulukan
  return found.sort((x, y) => (y.hotbar ? 1 : 0) - (x.hotbar ? 1 : 0));
}

function where(g) {
  return g.hotbar ? `Hotbar ${g.hotbar}` : `Inventaris (slot ${g.slot - 9 + 1}, bukan hotbar)`;
}

// Teks pemberitahuan setelah beli, contoh:
// "📦 Drill ×1 → Hotbar 3 · jual: !ah b1 3 <harga>"
function gotMessage(got, accId, prefix = '!') {
  if (!got || !got.length) return '';
  return got.map((g) => {
    const hint = g.hotbar ? ` · jual: ${prefix}ah b${accId} ${g.hotbar} <harga>` : '';
    return `📦 ${g.label} ×${g.count} → ${where(g)}${hint}`;
  }).join('\n');
}

module.exports = { HOTBAR_START, snapshot, diffNew, gotMessage };
