const express = require('express');
const router = express.Router();
const { sendFeedback, getUserFeedback } = require('../controllers/feedback');

router.post('/:githubId', sendFeedback);
router.get('/:githubId', getUserFeedback);

module.exports = router