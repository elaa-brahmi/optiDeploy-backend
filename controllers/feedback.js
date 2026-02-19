const nodemailer = require('nodemailer');
const Feedback = require('../models/feedback');
const User = require('../models/user')
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.MY_EMAIL,
    pass: process.env.EMAIL_APP_PASSWORD, 
  },
  tls: {
    family: 4 
  }
});

async function sendFeedback(req,res){
    try {
        const {githubId} = req.params;
        const { message } = req.body;
        const user = await User.findOne({ githubId: String(githubId) });


        const newFeedback = new Feedback({
          userId: githubId,
          userEmail: user.email,
          message,
        });
        await newFeedback.save();
    
        const mailOptions = {
          from: `"optiDeploy Copilot" <${process.env.MY_EMAIL}>`,
          to: process.env.EMAIL, 
          subject: '🚀 New Feedback Received for optiDeploy!',
          html: `
            <h3>New Feedback from ${user.email}</h3>
            <p><strong>Message:</strong> ${message}</p>
            <p><em>User ID: ${githubId}</em></p>
          `,
        };
    
        await transporter.sendMail(mailOptions);
        res.status(201).json({ success: true, message: 'Feedback shared!' });
    
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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