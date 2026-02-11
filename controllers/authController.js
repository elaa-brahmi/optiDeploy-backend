const User = require('../models/user');

exports.syncUser = async (req, res) => {
  const { githubId, email, name, accessToken } = req.body;

  try {
    const user = await User.findOneAndUpdate(
      { githubId },
      { email, name, accessToken, lastLogin: Date.now() },
      { upsert: true, new: true }
    );
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};