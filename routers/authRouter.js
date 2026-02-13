const express = require('express');
const router = express.Router();
const { syncUser } = require('../controllers/authController');
router.post('/sync-user', syncUser);
module.exports = router;