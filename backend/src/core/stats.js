// Statistik per akun. Disimpan per ID akun (bukan per instance bot)
// supaya tetap ada walau bot reconnect.
const store = new Map();

function get(id) {
  if (!store.has(id)) {
    store.set(id, {
      awal: null,        // jumlah shard saat sesi AFK dimulai
      afkStart: null,    // timestamp sesi AFK dimulai
      reconnects: 0,     // jumlah reconnect
      lastBeat: 0,       // timestamp packet terakhir dari server
      lastShards: 0,     // shard terakhir yang diketahui (untuk tampilan saat offline)
      location: '-',     // lokasi bot: AFK / Spawn / Crates / Lobby
      known: false,      // true kalau jumlah shard sudah diketahui
      chatSeen: false,   // true kalau shard dibaca dari pesan chat server
      boardSeen: false,  // true kalau shard dibaca dari papan skor (sidebar)
      money: null,       // teks Money dari papan skor, mis. "93.1M"
      coins: null,       // teks Coins dari papan skor
      bones: null,       // jumlah bone di Spawner Storage (pantau spawner)
      bonesAt: null,     // kapan terakhir dibaca
      bankGain: 0,       // shard yang didapat di sesi-sesi AFK sebelumnya
      bankMs: 0          // total durasi sesi-sesi AFK sebelumnya (ms)
    });
  }
  return store.get(id);
}

// Tutup sesi AFK yang sedang berjalan: simpan hasilnya ke "bank" supaya rate tetap akurat
// walau bot reconnect / terlempar ke lobby.
function bank(st) {
  if (st.afkStart && st.awal !== null) {
    st.bankMs += Date.now() - st.afkStart;
    st.bankGain += st.lastShards - st.awal;
  }
  st.afkStart = null;
  st.awal = null;
}

module.exports = { get, bank };
