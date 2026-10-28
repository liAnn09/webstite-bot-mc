const http = require('http');
const express = require('express');
const cors = require('cors');
const { initSocket } = require('./socket');
const { authMiddleware } = require('./auth');
const botRoutes = require('./routes/botRoutes');

function startServer(port = 3000) {
  const app = express();
  const server = http.createServer(app);

  app.use(cors());
  app.use(express.json());

  app.use('/api/bots', authMiddleware, botRoutes);

  initSocket(server);

  server.listen(port, () => {
    console.log(`[WEB SERVER] Running at http://localhost:${port}`);
  });

  return { app, server };
}

module.exports = { startServer };
