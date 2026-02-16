const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // GitHub ID 
  repoId: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  owner: { type: String, required: true },
  description: String,
  language: String,
  stars: { type: Number, default: 0 },
  htmlUrl: String,
  productionScore: { type: Number, default: 0 }, 
  lastScan: { type: Date, default: Date.now },
  addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('projects', ProjectSchema);