const Report = require('../models/report');

async function getReport(req, res) {
    try {
        const report = await Report.findOne({ repoId: req.params.repoId });
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: "Report not found" });
    }
}

module.exports = {
    getReport
};
