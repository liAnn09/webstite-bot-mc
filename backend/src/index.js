const { startBot } = require('./core/bot');
const { setupCommands } = require('./commands');
const { printBanner } = require('./core/utils');
const { initDiscord } = require('./discord/discordBot');
const { startWatchdog } = require('./discord/liveStatus');
const { startServer } = require('./server/server');

printBanner();
initDiscord();
setupCommands();
startWatchdog();

const WEB_PORT = process.env.WEB_PORT || 3000;
startServer(WEB_PORT);

startBot(0);
