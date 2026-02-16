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
    securityHeatmap: {
        secrets: Number,
        cors: Number,
        headers: Number
    },
    costAnalysis: {
        estimatedMonthly: Number,
        tier: String,
        reason: String
    },
    resourceOptimizer: {
        explanation: String,
        memoryRequest: String,
        cpuRequest: String,
        memoryLimit: String,
        cpuLimit: String

    },
    iacConfigurations: {
        aws: {
            terraformCode: String,
            explanation: String,
            deploymentSteps: [String],
            cloudResources: [String]
        },
        azure: {
            terraformCode: String,
            explanation: String,
            deploymentSteps: [String],
            cloudResources: [String]
        },
        gcp: {
            terraformCode: String,
            explanation: String,
            deploymentSteps: [String],
            cloudResources: [String]
        }
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('reports', ReportSchema);