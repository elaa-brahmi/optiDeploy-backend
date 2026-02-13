require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const authRouter = require('./routers/authRouter');
const repoRouter = require('./routers/repoRouter');
const app = express();
const cors = require('cors');

app.use(cors({
  origin: process.env.FRONTEND_URL, 
  credentials: true
}));
connectDB();

app.use(express.json());

app.get('/health', (req, res) => {
  res.send('API is running and DB is connected...');
});

app.use('/api/auth', authRouter);
app.use('/api/repos', repoRouter);
const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));