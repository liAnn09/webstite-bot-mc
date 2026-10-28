const express = require('express');
const router = express.Router();
const botCtrl = require('../controllers/botController');

router.get('/', botCtrl.getAllBots);
router.post('/:id/lifecycle', botCtrl.handleLifecycle);
router.post('/:id/action', botCtrl.triggerAction);
router.post('/:id/cmd', botCtrl.sendCmd);
router.get('/:id/inventory', botCtrl.getInventory);
router.get('/:id/spawner', botCtrl.getSpawner);
router.get('/:id/crates', botCtrl.getCrates);

module.exports = router;
