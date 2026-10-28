const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', '.env'); // .env di folder utama proyek

// Tulis nilai ke .env: ganti kalau barisnya sudah ada, tambahkan kalau belum (file dibuat kalau belum ada).
// updates  = selalu ditimpa.
// defaults = hanya diisi kalau belum ada / masih kosong (tidak menimpa pilihan kamu).
// process.env ikut diperbarui supaya langsung berlaku tanpa restart.
function saveEnv(updates = {}, defaults = {}) {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (e) {}

  const setKey = (key, value, onlyIfEmpty) => {
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const m = content.match(re);
    if (m) {
      if (onlyIfEmpty && m[1].trim() !== '') return false;
      content = content.replace(re, () => `${key}=${value}`);
    } else {
      content += (content && !content.endsWith('\n') ? '\n' : '') + `${key}=${value}\n`;
    }
    return true;
  };

  for (const [k, v] of Object.entries(updates)) {
    setKey(k, v, false);
    process.env[k] = String(v);
  }
  for (const [k, v] of Object.entries(defaults)) {
    if (setKey(k, v, true)) process.env[k] = String(v);
  }

  fs.writeFileSync(ENV_PATH, content);
}

module.exports = { saveEnv, ENV_PATH };
