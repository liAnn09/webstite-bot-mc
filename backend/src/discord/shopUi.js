const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const { botMap } = require('../core/bot');
const { accounts } = require('../core/config');
const { listShop, buildEntries } = require('../features/shop');
const { isAllowed } = require('./auth');

const MAX_OPTIONS_PER_MENU = 25; // batas Discord
const MAX_MENUS = 5;             // batas Discord (5 baris komponen)

let lastEntries = [];            // daftar item terakhir yang ditampilkan
const selections = new Map();    // userId → { slot, label, price }

function pickBot(tag) {
  if (tag && /^b?\d+$/i.test(tag)) {
    return botMap.get(parseInt(tag.replace(/^b/i, '')));
  }
  // Tanpa tag: bot pertama (urutan akun) yang sedang online
  for (const acc of accounts) {
    const bot = botMap.get(acc.id);
    if (bot && !bot._disconnected) return bot;
  }
  return null;
}

// !shardshop [b1] → embed daftar item + menu pilihan
async function showShop(message, tag) {
  const bot = pickBot(tag);
  if (!bot) {
    message.reply(`❌ Bot ${tag || ''} tidak aktif.`).catch(() => {});
    return;
  }

  const username = accounts.find((a) => a.id === bot.accId)?.username || 'Bot';
  const wait = await message.reply('⏳ Membuka /shardshop...');

  const res = await listShop(bot, username);
  if (!res.ok) {
    wait.edit(`❌ ${res.info}`).catch(() => {});
    return;
  }

  const entries = buildEntries(res.items).slice(0, MAX_OPTIONS_PER_MENU * MAX_MENUS);
  if (!entries.length) {
    wait.edit('❌ Isi shop tidak terbaca.').catch(() => {});
    return;
  }
  lastEntries = entries;

  // Embed: daftar nama + harga
  let lines = entries.map((e) => `${String(e.slot).padStart(2, ' ')} │ ${e.label}${e.price ? ` — ${e.price}` : ''}`);
  let body = lines.join('\n');
  while (body.length > 3900 && lines.length) {
    lines.pop();
    body = lines.join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle('🛍️ Shard Shop')
    .setDescription('```\n' + body + '\n```')
    .setColor(0x9b59b6)
    .setFooter({ text: 'Pilih item di menu bawah, lalu ketik !buy' });

  // Menu pilihan (maks 25 item per menu)
  const rows = [];
  for (let i = 0; i < entries.length && rows.length < MAX_MENUS; i += MAX_OPTIONS_PER_MENU) {
    const chunk = entries.slice(i, i + MAX_OPTIONS_PER_MENU);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`shopsel:${i / MAX_OPTIONS_PER_MENU}`)
      .setPlaceholder(`Pilih item (${i + 1}-${i + chunk.length} dari ${entries.length})`)
      .addOptions(
        chunk.map((e) => ({
          label: e.label.slice(0, 100),
          description: `Slot ${e.slot}${e.price ? ` · ${e.price}` : ''}`.slice(0, 100),
          value: String(e.slot)
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  await wait.edit({ content: '', embeds: [embed], components: rows }).catch(() => {});
}

// Tangani pilihan dari menu
function initShopUi(client) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu || !interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('shopsel:')) return;

    if (!isAllowed(interaction.user.id, interaction.member)) {
      interaction.reply({ content: '⛔ Kamu tidak punya izin memakai menu ini.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const slot = parseInt(interaction.values[0]);
    const entry = lastEntries.find((e) => e.slot === slot);

    if (!entry) {
      interaction.reply({
        content: '❌ Daftar sudah kedaluwarsa. Ketik `!shardshop` lagi.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return;
    }

    selections.set(interaction.user.id, { slot, label: entry.label, price: entry.price });

    interaction.reply({
      content:
        `✅ Dipilih: **${entry.label}** (slot ${slot})${entry.price ? ` — ${entry.price}` : ''}\n` +
        'Ketik `!buy` untuk membeli. Bisa juga `!buy b1` (satu bot) atau `!buy x3` (3 kali).',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  });
}

function getSelection(userId) {
  return selections.get(userId) || null;
}

module.exports = { showShop, initShopUi, getSelection };
