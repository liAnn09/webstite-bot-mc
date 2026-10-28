const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const { botMap } = require('../core/bot');
const { accounts } = require('../core/config');
const { isAllowed } = require('./auth');
const crates = require('../features/crates');
const { gotMessage } = require('../features/inv');

const MAX_OPTIONS = 25; // batas Discord per menu
const MAX_MENUS = 5;    // batas Discord per pesan
const GOLD = 0xf1c40f;

let lastList = { botId: null, list: [] };               // crate yang terakhir ditampilkan (untuk menu)
let lastOpen = { botId: null, crate: null, rewards: [] }; // crate yang terakhir dibuka
const selections = new Map();                           // userId → { botId, crateName, slot, name }

const nameOf = (bot) => accounts.find((a) => a.id === bot.accId)?.username || 'Bot';
const accOf = (bot) => accounts.find((a) => a.id === bot.accId);
const keysText = (c) => (c.keys === null || c.keys === undefined ? '?' : String(c.keys));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Bot untuk operasi crate: tag (b1) → bot itu; tanpa tag → bot pertama yang online di ecocpvp
function pickBot(tag) {
  if (tag && /^b?\d+$/i.test(tag)) {
    const bot = botMap.get(parseInt(String(tag).replace(/^b/i, '')));
    return bot && !bot._disconnected ? bot : null;
  }
  const online = Array.from(botMap.values()).filter((b) => !b._disconnected);
  return online.find((b) => b._state === 'ecocpvp') || online[0] || null;
}

// ---------- embed ----------

function cratesEmbed(bot, list) {
  const w = Math.min(Math.max(...list.map((c) => c.name.length)) + 2, 24);
  const total = list.reduce((n, c) => n + (c.keys || 0), 0);
  const lines = list.map((c, i) => `${String(i + 1).padStart(2)}  ${c.name.padEnd(w)}${keysText(c)} key`);
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle('Crates')
    .setDescription(`dari **${nameOf(bot)}**  ·  total **${total}** key\n\`\`\`\n${lines.join('\n')}\n\`\`\``)
    .setFooter({ text: 'Pilih crate di menu untuk membuka dan melihat hadiahnya' })
    .setTimestamp();
}

function rewardLine(r) {
  const d = crates.describeReward(r);
  return clip(`${String(r.slot).padStart(2)} │ ${r.name}${r.count > 1 ? ` x${r.count}` : ''}${d ? ` — ${d}` : ''}`, 110);
}

function rewardsEmbed(bot, res) {
  const noKey = res.noKey || res.crate.keys === 0;
  let body = res.rewards.map(rewardLine).join('\n');
  if (body.length > 3600) body = body.slice(0, 3590) + '\n…';
  const warn = noKey
    ? '\nAkun ini **tidak punya key** untuk crate ini, jadi hadiah hanya bisa dilihat, belum bisa diambil.'
    : '';
  return new EmbedBuilder()
    .setColor(noKey ? 0xe67e22 : GOLD)
    .setTitle(res.crate.name)
    .setDescription(`Key: **${keysText(res.crate)}**  ·  dari **${nameOf(bot)}**${warn}\n\`\`\`\n${body}\n\`\`\``)
    .setFooter({ text: 'Pilih hadiah di menu, lalu ketik !claim (memakai 1 key)' })
    .setTimestamp();
}

function crateMenu(list) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cratesel:0')
    .setPlaceholder('Pilih crate yang dibuka')
    .addOptions(
      list.slice(0, MAX_OPTIONS).map((c, i) => ({
        label: clip(c.name, 100),
        description: `${keysText(c)} key`,
        value: String(i)
      }))
    );
  return [new ActionRowBuilder().addComponents(menu)];
}

function rewardMenus(res) {
  const rows = [];
  for (let i = 0; i < res.rewards.length && rows.length < MAX_MENUS; i += MAX_OPTIONS) {
    const chunk = res.rewards.slice(i, i + MAX_OPTIONS);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rwdsel:${i / MAX_OPTIONS}`)
      .setPlaceholder(`Pilih hadiah (${i + 1}-${i + chunk.length} dari ${res.rewards.length})`)
      .addOptions(
        chunk.map((r) => ({
          label: clip(r.name, 100),
          description: clip(crates.describeReward(r) || `Slot ${r.slot}`, 100),
          value: String(r.slot)
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  return rows;
}

// ---------- command ----------

// !crates [bot] — daftar crate + jumlah key, dengan menu untuk membuka salah satunya
async function showCrates(message, tag) {
  const bot = pickBot(tag);
  if (!bot) {
    message.reply(tag ? `Bot ${tag} tidak aktif.` : 'Tidak ada bot online.').catch(() => {});
    return;
  }
  const wait = await message.reply('Pindah ke /warp crates dan membaca crate... (sekitar 10-15 detik)');
  const res = await crates.listCrates(bot, accOf(bot));
  if (!res.ok) {
    wait.edit(`Gagal: ${res.info}`).catch(() => {});
    return;
  }
  lastList = { botId: bot.accId, list: res.crates };
  await wait.edit({ content: '', embeds: [cratesEmbed(bot, res.crates)], components: crateMenu(res.crates) }).catch(() => {});
}

// !crate <nama> [bot] — buka crate langsung (tanpa menu), tampilkan hadiahnya
async function showCrate(message, query, tag) {
  const bot = pickBot(tag);
  if (!bot) {
    message.reply(tag ? `Bot ${tag} tidak aktif.` : 'Tidak ada bot online.').catch(() => {});
    return;
  }
  const wait = await message.reply(`Membuka crate "${query}"... (sekitar 10-15 detik)`);
  const res = await crates.openCrateByName(bot, accOf(bot), query);
  if (!res.ok) {
    wait.edit(`Gagal: ${res.info}`).catch(() => {});
    return;
  }
  lastOpen = { botId: bot.accId, crate: res.crate, rewards: res.rewards };
  await wait.edit({ content: '', embeds: [rewardsEmbed(bot, res)], components: rewardMenus(res) }).catch(() => {});
}

// !claim [bot]                      → ambil hadiah yang dipilih di menu
// !claim <crate> <item|slot> [bot]  → ambil langsung, mis. !claim common boots
async function claimCommand(message, args) {
  const tag = args.find((a) => /^b\d+$/i.test(a));
  const rest = args.filter((a) => a !== tag);

  let botId;
  let crateQuery;
  let pilihan;
  let label;

  if (rest.length === 0) {
    const sel = selections.get(message.author.id);
    if (!sel) {
      message.reply('Belum ada hadiah yang dipilih. Ketik `!crates`, pilih crate dan hadiahnya di menu, lalu `!claim`.\nAtau langsung: `!claim <crate> <item|slot>`, contoh `!claim common boots`.').catch(() => {});
      return;
    }
    botId = tag ? parseInt(tag.replace(/^b/i, '')) : sel.botId;
    crateQuery = sel.crateName;
    pilihan = { slot: sel.slot, name: sel.name };
    label = `${sel.name} dari ${sel.crateName}`;
  } else {
    if (rest.length < 2) {
      message.reply('Format: `!claim <crate> <item|slot> [bot]` — contoh `!claim common boots` atau `!claim gold 12`.').catch(() => {});
      return;
    }
    const bot0 = pickBot(tag);
    botId = bot0 ? bot0.accId : null;
    crateQuery = rest[0];
    pilihan = { itemQuery: rest.slice(1).join(' ') };
    label = `"${pilihan.itemQuery}" dari crate ${crateQuery}`;
  }

  const bot = botMap.get(botId);
  if (!bot || bot._disconnected) {
    message.reply('Bot tidak aktif.').catch(() => {});
    return;
  }

  const wait = await message.reply(`Mengambil ${label} (memakai 1 key)... sekitar 15-20 detik`);
  const res = await crates.claimReward(bot, accOf(bot), crateQuery, pilihan);

  if (!res.ok) {
    wait.edit(`Gagal: ${res.info}`).catch(() => {});
    return;
  }
  const lines = [`Berhasil: ${res.info}`];
  const where = gotMessage(res.got, bot.accId, '!');
  if (where) lines.push(where);
  wait.edit(lines.join('\n')).catch(() => {});
}

// !keys [bot|all] — jumlah key tiap crate (bot kembali AFK setelah membaca)
async function showKeys(message, tag) {
  let bots;
  if (tag && tag.toLowerCase() !== 'all') {
    const b = pickBot(tag);
    bots = b ? [b] : [];
  } else {
    bots = Array.from(botMap.values()).filter((b) => !b._disconnected && b._state === 'ecocpvp');
  }
  if (!bots.length) {
    message.reply('Tidak ada bot online di ecocpvp.').catch(() => {});
    return;
  }

  const wait = await message.reply(`Membaca key dari ${bots.length} bot... (bot kembali AFK setelah selesai, sekitar 20-30 detik)`);
  const results = await Promise.all(
    bots.map(async (bot, i) => {
      await new Promise((r) => setTimeout(r, i * 1500)); // jangan serempak
      return { bot, res: await crates.readKeys(bot, accOf(bot)) };
    })
  );

  const embed = new EmbedBuilder().setColor(GOLD).setTitle('Key Crate').setTimestamp()
    .setFooter({ text: 'Dibaca dari hologram di /warp crates' });
  let grand = 0;
  const fields = results.map(({ bot, res }) => {
    if (!res.ok) return { name: nameOf(bot), value: `Gagal: ${clip(res.info, 200)}`, inline: false };
    const w = Math.min(Math.max(...res.crates.map((c) => c.name.length)) + 2, 24);
    const total = res.crates.reduce((n, c) => n + (c.keys || 0), 0);
    grand += total;
    const lines = res.crates.map((c) => `${c.name.padEnd(w)}${keysText(c)}`);
    return { name: `${nameOf(bot)}  ·  ${total} key`, value: '```\n' + lines.join('\n') + '\n```', inline: false };
  });
  embed.setDescription(`Total semua akun: **${grand}** key`).addFields(fields);
  wait.edit({ content: '', embeds: [embed] }).catch(() => {});
}

// ---------- menu (select) ----------

function initCratesUi(client) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu || !interaction.isStringSelectMenu()) return;
    const id = interaction.customId || '';
    if (!id.startsWith('cratesel:') && !id.startsWith('rwdsel:')) return;

    if (!isAllowed(interaction.user.id, interaction.member)) {
      interaction.reply({ content: 'Kamu tidak punya izin memakai menu ini.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // --- pilih crate → buka dan tampilkan hadiahnya ---
    if (id.startsWith('cratesel:')) {
      const crate = lastList.list[parseInt(interaction.values[0])];
      const bot = botMap.get(lastList.botId);
      if (!crate || !bot || bot._disconnected) {
        interaction.reply({ content: 'Daftar sudah kedaluwarsa. Ketik `!crates` lagi.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      await interaction.deferReply().catch(() => {});
      const res = await crates.openCrateByName(bot, accOf(bot), crate.name);
      if (!res.ok) {
        interaction.editReply(`Gagal membuka ${crate.name}: ${res.info}`).catch(() => {});
        return;
      }
      lastOpen = { botId: bot.accId, crate: res.crate, rewards: res.rewards };
      interaction.editReply({ embeds: [rewardsEmbed(bot, res)], components: rewardMenus(res) }).catch(() => {});
      return;
    }

    // --- pilih hadiah → simpan; klaim lewat !claim ---
    const slot = parseInt(interaction.values[0]);
    const reward = lastOpen.rewards.find((r) => r.slot === slot);
    if (!reward || !lastOpen.crate) {
      interaction.reply({ content: 'Daftar hadiah sudah kedaluwarsa. Buka crate lagi.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    selections.set(interaction.user.id, {
      botId: lastOpen.botId,
      crateName: lastOpen.crate.name,
      slot,
      name: reward.name
    });
    const d = crates.describeReward(reward);
    interaction.reply({
      content:
        `Dipilih: **${reward.name}** dari ${lastOpen.crate.name}${d ? ` (${d})` : ''}\n` +
        'Ketik `!claim` untuk mengambilnya. Ini memakai 1 key.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  });
}

module.exports = { showCrates, showCrate, showKeys, claimCommand, initCratesUi };
