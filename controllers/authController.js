const User = require('../models/user');

exports.syncUser = async (req, res) => {
  try {
    const { githubId, email, name, accessToken } = req.body;
    await User.findOneAndUpdate(
      { githubId },
      { email, name, accessToken, lastLogin: new Date() },
      { upsert: true }
    );
    return res.status(200).send("Synced"); 
  } catch (err) {
    return res.status(500).send(err.message);
  }
};