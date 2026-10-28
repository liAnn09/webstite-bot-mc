// Ubah teks JSON chat ("{"text":"Money"...}") atau teks biasa menjadi teks polos
function plainText(raw) {
  if (raw === null || raw === undefined) return '';
  const clean = (t) => String(t).replace(/§./g, '').trim();
  try {
    const node = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const walk = (n) => {
      if (typeof n === 'string') return n;
      if (Array.isArray(n)) return n.map(walk).join('');
      return (n.text || '') + (n.extra ? n.extra.map(walk).join('') : '');
    };
    return clean(walk(node));
  } catch (e) {
    return clean(raw);
  }
}

function labelOf(item) {
  const custom = item.customName ? plainText(item.customName) : '';
  return custom || item.displayName || item.name || '?';
}

function loreOf(item) {
  try {
    const lore = item.nbt?.value?.display?.value?.Lore?.value?.value || [];
    return lore.map(plainText).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function itemText(item) {
  return [item.name, item.displayName, item.customName ? plainText(item.customName) : '']
    .filter(Boolean).join(' ').toLowerCase();
}

module.exports = { plainText, labelOf, loreOf, itemText };
