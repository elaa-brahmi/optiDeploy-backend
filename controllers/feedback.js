const Feedback = require('../models/feedback');
const User = require('../models/user')
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendFeedback(req, res) {
    try {
      const { githubId } = req.params;
      const { message } = req.body;
  
      const user = await User.findOne({ githubId: String(githubId) });
      if (!user) return res.status(404).json({ success: false, error: "User not found" });
  
      const newFeedback = new Feedback({
        userId: githubId,
        userEmail: user.email,
        message,
      });
      await newFeedback.save();
  
      res.status(201).json({ success: true, message: 'Feedback shared!' });
  
      resend.emails.send({
        from: 'optiDeploy Copilot <onboarding@resend.dev>',
        to: process.env.EMAIL,
        subject: '🚀 New Feedback Received for optiDeploy!',
        html: `
          <h3>New Feedback from ${user.email}</h3>
          <p><strong>Message:</strong> ${message}</p>
          <p><em>User ID: ${githubId}</em></p>
        `,
      })
        .then(() => console.log("Feedback email sent successfully"))
        .catch((err) => console.error(" Background Email Error:", err));
  
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
      console.error("General Feedback Error:", error);
    }
  }
async function getUserFeedback(req, res) {
  try {
    const { githubId } = req.params;

    const feedbacks = await Feedback.find({ userId: String(githubId) }).sort({
      createdAt: -1,
    });

    return res.status(200).json({ success: true, feedbacks });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: error.message });
  }
}

module.exports = { sendFeedback, getUserFeedback }