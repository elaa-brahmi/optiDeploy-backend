const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  githubId: { type: String, required: true, unique: true },
  email: String,
  name: String,
  accessToken: String,
  lastLogin: { type: Date, default: Date.now }
});

module.exports = mongoose.model('users', UserSchema);