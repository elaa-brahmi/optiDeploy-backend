const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  repoId: { type: Number, required: true, unique: true },
  userId: { type: String, required: true },
  language: String,
  productionScore: Number,
  securityAlerts: [String],
  missingFiles: [String],
  deploymentTip: String,
  optimizationTips: String,
  generatedFiles: {
    dockerfile: String,
    cicd: String
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('reports', ReportSchema);