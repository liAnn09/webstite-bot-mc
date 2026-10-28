const botCore = require('../../core/bot');
const { accounts } = require('../../core/config');
const stats = require('../../core/stats');
const { rateOf } = require('../../features/rate');
const { walkTo, farmSpot } = require('../../features/farm');
const spawner = require('../../features/spawner');
const crates = require('../../features/crates');
const { emitAlert } = require('../socket');

function getBotInstance(idStr) {
  const n = parseInt(idStr, 10);
  const botMap = botCore.botMap;
  if (isNaN(n) || !botMap || !botMap.has(n)) return null;
  return botMap.get(n);
}

exports.getAllBots = (req, res) => {
  const botMap = botCore.botMap;
  const result = (accounts || []).map((acc) => {
    const bot = botMap ? botMap.get(acc.id) : null;
    const st = stats.get(acc.id);
    const r = rateOf(st);
    return {
      id: acc.id,
      username: acc.username,
      online: !!bot && !bot._disconnected,
      ping: bot?.player?.ping ?? 0,
      health: bot?.health ?? 0,
      food: bot?.food ?? 0,
      location: st?.location || '-',
      shards: st?.lastShards || 0,
      rateHr: r?.perHour || 0,
      money: st?.money || '-',
      bones: st?.bones || 0,
      pos: bot?.entity?.position ? {
        x: Math.round(bot.entity.position.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(bot.entity.position.z)
      } : null
    };
  });
  res.json({ ok: true, data: result });
};

exports.handleLifecycle = async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  if (id === 'all') {
    accounts.forEach((acc) => {
      if (action === 'stop') botCore.stopBot(acc.id);
      if (action === 'start') botCore.startBot(acc.id);
      if (action === 'restart') botCore.restartBot(acc.id);
    });
    emitAlert('info', `Action ${action} triggered for all bots`);
    return res.json({ ok: true, message: `All bots: ${action}` });
  }

  const idx = parseInt(id, 10);
  const acc = accounts.find(a => a.id === idx);
  if (isNaN(idx) || !acc) {
    return res.status(404).json({ ok: false, error: 'Invalid bot ID' });
  }

  if (action === 'stop') botCore.stopBot(idx);
  else if (action === 'start') botCore.startBot(idx);
  else if (action === 'restart') botCore.restartBot(idx);
  else return res.status(400).json({ ok: false, error: 'Unknown action' });

  emitAlert('info', `Action ${action} executed for Bot #${idx}`, idx);
  res.json({ ok: true, message: `Bot #${idx} ${action} triggered` });
};

exports.triggerAction = async (req, res) => {
  const bot = getBotInstance(req.params.id);
  if (!bot) return res.status(404).json({ ok: false, error: 'Bot offline / not found' });

  const { action, x, z } = req.body;
  const acc = accounts[bot.accId];

  if (action === 'afk') {
    bot.chat('/afk');
  } else if (action === 'jump') {
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 300);
  } else if (action === 'goto' && x !== undefined && z !== undefined) {
    walkTo(bot, acc.username, x, z);
  } else if (action === 'farm') {
    const spot = farmSpot(bot.accId);
    if (!spot) return res.status(400).json({ ok: false, error: 'Farm spot not set' });
    walkTo(bot, acc.username, spot.x, spot.z, true);
  } else if (action === 'drop_bone') {
    spawner.dropSession(bot, acc.username);
  } else {
    return res.status(400).json({ ok: false, error: 'Invalid action' });
  }

  res.json({ ok: true, message: `Action ${action} sent` });
};

exports.sendCmd = (req, res) => {
  const bot = getBotInstance(req.params.id);
  if (!bot) return res.status(404).json({ ok: false, error: 'Bot offline' });

  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ ok: false, error: 'Command missing' });

  bot.chat(cmd.startsWith('/') ? cmd : `/${cmd}`);
  res.json({ ok: true, sent: cmd });
};

exports.getInventory = (req, res) => {
  const bot = getBotInstance(req.params.id);
  if (!bot || !bot.inventory) return res.status(404).json({ ok: false, error: 'Bot offline' });

  const rawItems = bot.inventory.items();
  const hotbar = [];
  for (let i = 0; i < 9; i++) {
    const slot = bot.inventory.slots[36 + i];
    hotbar.push({
      slot: i + 1,
      name: slot ? slot.name : null,
      displayName: slot ? slot.displayName : 'Empty',
      count: slot ? slot.count : 0
    });
  }

  res.json({
    ok: true,
    hotbar,
    totalItems: rawItems.length,
    items: rawItems.map(item => ({
      slot: item.slot,
      name: item.name,
      displayName: item.displayName,
      count: item.count
    }))
  });
};

exports.getSpawner = (req, res) => {
  const idx = parseInt(req.params.id, 10);
  const st = stats.get(idx);
  const settings = spawner.getSettings(idx);
  res.json({
    ok: true,
    bones: st?.bones ?? 0,
    lastUpdated: st?.bonesAt ?? null,
    autoDrop: settings.auto,
    threshold: settings.threshold,
    keep: settings.keep
  });
};

exports.getCrates = async (req, res) => {
  const bot = getBotInstance(req.params.id);
  if (!bot) return res.status(404).json({ ok: false, error: 'Bot offline' });

  const acc = accounts[bot.accId];
  try {
    const list = await crates.readKeys(bot, acc);
    res.json({ ok: true, keys: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
