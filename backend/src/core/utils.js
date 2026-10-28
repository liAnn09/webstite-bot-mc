// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m'
};

// Palet warna untuk akun (urut sesuai BOT1, BOT2, ... di .env)
const palette = [colors.cyan, colors.magenta, colors.yellow, colors.green, colors.blue, colors.red];

// Icon per tipe log
const icons = {
  connect:     '🔌',
  lobby:       '🏠',
  login:       '🔑',
  server:      '🌐',
  afk:         '💤',
  ready:       '✅',
  shard:       '💎',
  pay:         '💰',
  buy:         '🛒',
  ping:        '📡',
  kick:        '🚫',
  ban:         '⛔',
  disconnect:  '❌',
  reconnect:   '🔄',
  maintenance: '🔧',
  error:       '⚠️',
  chat:        '💬',
  info:        '📋'
};

function getTime() {
  return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

function getBotColor(botName) {
  // Warna diambil dari urutan akun di .env (bukan dari nama akun)
  const { accounts } = require('./config');
  const i = accounts.findIndex((a) => a.username === botName);
  return i >= 0 ? palette[i % palette.length] : colors.white;
}

function log(botName, msg) {
  const time = getTime();
  const botColor = getBotColor(botName);
  const timeStr = `${colors.dim}[${time}]${colors.reset}`;
  const nameStr = `${botColor}${colors.bold}[${botName}]${colors.reset}`;

  // Deteksi tipe pesan & beri warna + icon
  let icon = '';
  let msgColor = colors.white;

  if (msg.includes('[SHARD DAPAT]')) {
    icon = icons.shard;
    msgColor = colors.green + colors.bold;
  } else if (msg.includes('[PAY SENT]')) {
    icon = icons.pay;
    msgColor = colors.yellow;
  } else if (msg.includes('[SERVER RESPONS]')) {
    icon = icons.chat;
    msgColor = colors.cyan;
  } else if (msg.includes('[BUY')) {
    icon = icons.buy;
    msgColor = colors.magenta;
  } else if (msg.includes('[REJOIN]')) {
    icon = icons.reconnect;
    msgColor = colors.yellow;
  } else if (msg.includes('[FARM') || msg.includes('[GOTO')) {
    icon = icons.afk;
    msgColor = colors.green;
  } else if (msg.includes('[PING]')) {
    icon = icons.ping;
    msgColor = colors.blue;
  } else if (msg.includes('[BANNED]')) {
    icon = icons.ban;
    msgColor = colors.bgRed + colors.white + colors.bold;
  } else if (msg.includes('[KICKED]')) {
    icon = icons.kick;
    msgColor = colors.red + colors.bold;
  } else if (msg.includes('[MAINTENANCE]')) {
    icon = icons.maintenance;
    msgColor = colors.yellow + colors.bold;
  } else if (msg.includes('[AUTO RECONNECT]')) {
    icon = icons.reconnect;
    msgColor = colors.blue;
  } else if (msg.includes('[DISCONNECT]')) {
    icon = icons.disconnect;
    msgColor = colors.red;
  } else if (msg.includes('[ERROR]')) {
    icon = icons.error;
    msgColor = colors.red;
  } else if (msg.includes('Masuk server')) {
    icon = icons.connect;
    msgColor = colors.blue;
  } else if (msg.includes('masuk lobby') || msg.includes('Berhasil masuk')) {
    icon = icons.lobby;
    msgColor = colors.green;
  } else if (msg.includes('Login')) {
    icon = icons.login;
    msgColor = colors.yellow;
  } else if (msg.includes('ecocpvp') || msg.includes('Switch')) {
    icon = icons.server;
    msgColor = colors.cyan;
  } else if (msg.includes('AFK') || msg.includes('afk')) {
    icon = icons.afk;
    msgColor = colors.dim;
  } else if (msg.includes('Bot siap')) {
    icon = icons.ready;
    msgColor = colors.green + colors.bold;
  } else {
    icon = icons.info;
    msgColor = colors.white;
  }

  console.log(`${timeStr} ${nameStr} ${icon} ${msgColor}${msg}${colors.reset}`);

  // Forward log ke Discord (jika terhubung)
  try {
    const { sendDiscordLog } = require('../discord/discordBot');
    sendDiscordLog(botName, msg, icon);
  } catch (e) {}
}

function printBanner() {
  const { host, accounts } = require('./config');
  const W = 46;
  const bar = (l, r) => l + '═'.repeat(W) + r;
  const row = (t = '') => `║ ${t.padEnd(W - 2)} ║`;
  const center = (t) => ' '.repeat(Math.max(0, Math.floor((W - 2 - t.length) / 2))) + t;

  console.log([
    '',
    colors.cyan + colors.bold + bar('╔', '╗'),
    row(center('RELXMC AFK BOT')),
    bar('╠', '╣'),
    row(`Server : ${host || '(HOST belum diisi di .env)'}`),
    row(`Bots   : ${accounts.length} akun`),
    row('Mode   : AFK Shard Farm'),
    bar('╠', '╣'),
    row('Console : ketik  help  untuk daftar command'),
    row('Discord : ketik  !help  di channel command'),
    bar('╚', '╝') + colors.reset,
    ''
  ].join('\n'));
}

// Daftar command console (ketik "help")
function printHelp() {
  const g = (title, lines) => `${colors.bold}${title}${colors.reset}\n` + lines.map((l) => '  ' + l).join('\n');
  console.log('\n' + [
    g('Monitor', [
      'status                       status semua bot',
      'shards [b1]                  jumlah shard',
      'money [b1] [raw]             saldo dari papan skor',
      'rate [b1]                    shard per jam & estimasi',
      'players [b1] [nama]          pemain online / cari nama',
      'ping [b1]                    latency'
    ]),
    g('Shop & Jual', [
      'shop [b1]                    isi /shardshop + nomor slot',
      'buy [b1] [slot|nama] [xN]    beli item',
      'hotbar [b1]                  isi hotbar 1-9',
      'ah [b1] [hotbar] <harga>     jual lewat /ah sell'
    ]),
    g('Teleport & Farm', [
      'tp <b1|all> <tujuan>         pemain | spawn | home [nama] | warp <nama> | here <pemain>',
      '                             (tp ke pemain: setelah teleport bot diam, tidak kembali AFK)',
      'tpaccept [b1]                terima teleport',
      'farm [b1]                    /afk lalu jalan ke titik farm',
      'setfarm <b1> [x z]           simpan titik farm',
      'goto <b1> <x> <z>            jalan ke koordinat',
      'pos [b1]                     posisi bot'
    ]),
    g('Spawner', [
      'spawner [b1]                 jumlah bone di storage + batas drop',
      'spawner auto on|off <b1|all> drop otomatis saat batas tercapai',
      'spawner drop <b1>            buang bone sekarang (spawner stop = hentikan)',
      'spawner limit <jumlah> <b1|all>  ubah batas, mis. 500k'
    ]),
    g('Home', [
      'sethome <nama> <b1|all>      simpan posisi bot sebagai home',
      'home [nama] <b1|all>         teleport ke home (bot AFK + lompat otomatis di sana)',
      'delhome <nama> <b1|all>      hapus home',
      'homes [b1]                   daftar home'
    ]),
    g('Crates', [
      'crates [b1]                  daftar crate + jumlah key (/warp crates)',
      'crate <nama> [b1]            buka crate, lihat hadiah + nomor slot',
      'claim <crate> <item|slot> [b1]  ambil hadiah (memakai 1 key)',
      'keys [b1|all]                jumlah key tiap crate'
    ]),
    g('Kontrol & Aksi', [
      'bot <stop|start|restart> <b1|all>',
      'server <create|setup|invite> server Discord otomatis',
      'pay <player> <jumlah> [b1]   bayar pemain',
      'say <pesan> [b1]             chat di server',
      'cmd <perintah> [b1]          jalankan command Minecraft',
      'w/a/s/d/space/stop [b1]      gerak manual'
    ]),
    `${colors.dim}[b1] = pilih bot, tanpa tag = semua bot${colors.reset}`
  ].join('\n\n') + '\n');
}

function printStatus(botMap, accounts) {
  console.log(`\n${colors.bold}${colors.white}── Status Bot ──${colors.reset}`);
  accounts.forEach(acc => {
    const bot = botMap.get(acc.id);
    const color = palette[(acc.id - 1) % palette.length];
    if (bot) {
      const ping = bot.player ? `${bot.player.ping}ms` : '...';
      console.log(`  ${color}● B${acc.id} ${acc.username}${colors.reset} ${colors.green}ONLINE${colors.reset} ${colors.dim}(${ping})${colors.reset}`);
    } else {
      console.log(`  ${color}○ B${acc.id} ${acc.username}${colors.reset} ${colors.red}OFFLINE${colors.reset}`);
    }
  });
  console.log(`${colors.dim}────────────────${colors.reset}\n`);
}

function randomDelay(baseMs, variance = 2000) {
  return baseMs + Math.floor(Math.random() * variance * 2) - variance;
}

function countShards(bot) {
  if (!bot.inventory) return 0;
  return bot.inventory.items().reduce((total, item) => {
    const name = item.name ? item.name.toLowerCase() : '';
    const customName = item.customName ? item.customName.toLowerCase() : '';
    const displayName = item.displayName ? item.displayName.toLowerCase() : '';
    if (name.includes('shard') || customName.includes('shard') || displayName.includes('shard')) {
      return total + item.count;
    }
    return total;
  }, 0);
}

module.exports = { log, randomDelay, countShards, printBanner, printHelp, printStatus, colors, icons };
