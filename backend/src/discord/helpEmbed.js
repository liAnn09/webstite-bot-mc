const { EmbedBuilder } = require('discord.js');
const { accounts } = require('../core/config');

// Embed daftar command (dipakai oleh !help dan pesan sambutan channel command)
function buildHelpEmbed(client) {
  const tags = accounts.map((a) => `\`b${a.id}\``).join(' ') || '`b1`';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⛏️ RelxMC Bot — Daftar Command')
    .setDescription(
      'Awali dengan `!` atau pakai kurung siku, contoh `[ping b1]`.\n' +
      `Pilih bot dengan tag ${tags} — tanpa tag, command berlaku untuk **semua bot**.`
    )
    .addFields(
      {
        name: '📊  Monitor',
        value: [
          '`!status` — status semua bot',
          '`!shards [bot]` — jumlah shard',
          '`!ping [bot]` — latency bot',
          '`!players [bot] [nama]` — pemain online di server (bisa cari nama)',
          '`!tab [bot]` — tampilan tab list server, sama seperti di game',
          '`!money [bot]` — saldo Money / Shards / Coins dari papan skor',
          '`!rate [bot]` — shard per jam & estimasi per hari',
          '`!live [detik]` — status live otomatis · `!live stop` untuk berhenti'
        ].join('\n')
      },
      {
        name: '🛍️  Shop & Jual',
        value: [
          '`!shardshop [bot]` — daftar item (nama + harga), pilih lewat menu',
          '`!buy [bot] [slot|nama] [x3]` — beli item yang dipilih / langsung',
          '`!hotbar [bot]` — isi hotbar 1–9',
          '`!ah [bot] [hotbar] <harga>` — jual item lewat /ah sell'
        ].join('\n')
      },
      {
        name: '🎁  Crates',
        value: [
          '`!crates [bot]` — daftar crate + jumlah key, pilih crate lewat menu',
          '`!crate <nama> [bot]` — buka crate, lihat nama item hadiahnya',
          '`!claim` — ambil hadiah yang dipilih · `!claim <crate> <item|slot>` langsung',
          '`!keys [bot|all]` — jumlah key tiap crate'
        ].join('\n')
      },
      {
        name: '🦴  Spawner',
        value: [
          '`!spawner [bot]` — jumlah bone di storage + batas drop',
          '`!spawner auto on|off <bot|all>` — drop otomatis saat batas tercapai',
          '`!spawner drop <bot>` — buang bone sekarang · `!spawner stop`',
          '`!spawner limit <jumlah> <bot|all>` — ubah batas (mis. 500k)'
        ].join('\n')
      },
      {
        name: '🏠  Home',
        value: [
          '`!sethome <nama> <bot|all>` — simpan posisi bot sebagai home',
          '`!home [nama] <bot|all>` — teleport ke home, bot AFK + lompat otomatis di sana',
          '`!delhome <nama> <bot|all>` — hapus home',
          '`!homes [bot]` — daftar home milik akun'
        ].join('\n')
      },
      {
        name: '🧭  Teleport & Farm',
        value: [
          '`!tp <bot|all> <pemain|spawn|home|warp x>` — teleport (ke pemain: bot diam di sana)',
          '`!tpaccept [bot]` — terima permintaan teleport',
          '`!farm [bot]` — /afk lalu jalan ke titik farm & AFK',
          '`!setfarm <bot> [x z]` — simpan titik farm (tanpa x z = posisi sekarang)',
          '`!goto <bot> <x> <z>` · `!pos [bot]` — jalan ke koordinat · lihat posisi'
        ].join('\n')
      },
      {
        name: '⚙️  Kontrol Bot',
        value: [
          '`!stop <bot|all>` — matikan bot (tidak reconnect otomatis)',
          '`!start [bot|all]` — nyalakan bot yang mati',
          '`!restart [bot|all]` — putus lalu sambung ulang',
          '`!setup` — (admin) bangun / perbaiki struktur server Discord',
          '`!role add|remove <@user> <operator|viewer>` — (admin) atur role'
        ].join('\n')
      },
      {
        name: '🎮  Aksi Bot',
        value: [
          '`!pay <player> <jumlah> [bot]` — bayar player',
          '`!say <pesan> [bot]` — chat di server',
          '`!cmd <perintah> [bot]` — jalankan command Minecraft'
        ].join('\n')
      },
      {
        name: '💡  Contoh',
        value: [
          '```',
          '!buy b1 x3        beli item pilihan 3 kali',
          '!ah 5000          jual item yang terakhir dibeli',
          '!ah b1 3 5k      jual hotbar 3 seharga 5k',
          '!cmd /spawn b2    kirim /spawn ke bot 2',
          '```'
        ].join('\n')
      }
    )
    .setFooter({ text: `${accounts.length} bot terdaftar • ketik !help kapan saja` });

  try {
    const avatar = client && client.user && client.user.displayAvatarURL();
    if (avatar) embed.setThumbnail(avatar);
  } catch (e) {}

  return embed;
}

module.exports = { buildHelpEmbed };
