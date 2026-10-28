const apiKey = process.env.WEB_API_KEY || 'relx-secret-key-123';

function authMiddleware(req, res, next) {
  const token = req.headers['x-api-key'] || req.query.apiKey;
  if (!token || token !== apiKey) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid API Key' });
  }
  next();
}

function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.apiKey;
  if (!token || token !== apiKey) {
    return next(new Error('Unauthorized'));
  }
  next();
}

module.exports = { authMiddleware, socketAuth };
