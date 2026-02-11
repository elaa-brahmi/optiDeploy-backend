require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');

// 1. Initialize Express
const app = express();

// 2. Connect to Database
connectDB();

// 3. Middleware
app.use(express.json());

// 4. Test Route
app.get('/health', (req, res) => {
  res.send('API is running and DB is connected...');
});

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));