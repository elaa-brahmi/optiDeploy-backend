const express = require('express');
const router = express.Router();
const repoController = require('../controllers/repoController');
const reportController = require('../controllers/reportController');

router.post('/analyze/:repoId', repoController.analyzeRepo);
router.get('/search', repoController.searchRepos);
router.post('/import', repoController.importRepo);
router.get('/projects/:githubId', repoController.getProjects);
router.get('/report/:repoId', reportController.getReport);

module.exports = router;
