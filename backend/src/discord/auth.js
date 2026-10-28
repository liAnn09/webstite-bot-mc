require('../core/config'); // pastikan .env sudah dibaca

// Siapa yang boleh memakai command bot:
//  - DISCORD_OPERATOR_ROLE_ID  : anggota dengan role ini (diisi otomatis oleh setup server)
//  - DISCORD_ALLOWED_USER_IDS  : daftar ID pengguna dipisah koma (opsional)
//  - Administrator server / owner selalu boleh
// Kalau dua-duanya belum diisi → semua orang di channel command boleh (perilaku lama).
function isAllowed(userId, member) {
  const roleId = process.env.DISCORD_OPERATOR_ROLE_ID || '';
  const ids = (process.env.DISCORD_ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!roleId && ids.length === 0) return true;
  if (ids.includes(userId)) return true;
  if (!member) return false;

  try {
    if (member.permissions && member.permissions.has('Administrator')) return true;
  } catch (e) {}

  return !!(roleId && member.roles && member.roles.cache && member.roles.cache.has(roleId));
}

module.exports = { isAllowed };
