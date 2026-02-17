require('dotenv').config();
const client = require('prom-client');
const express = require('express');
const connectDB = require('./config/db');
const authRouter = require('./routers/authRouter');
const repoRouter = require('./routers/repoRouter');
const app = express();
const cors = require('cors');
//  INITIALIZE METRICS
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

app.use((req, res, next) => {
  res.on('finish', () => {
    // This records EVERY request that hits your server
    httpRequestCounter.labels(req.method, req.path, res.statusCode).inc();
  });
  next();
})


app.use(cors({
  origin: process.env.FRONTEND_URL, 
  credentials: true
}));
connectDB();

app.use(express.json());
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
app.get('/health', (req, res) => {
  res.send('API is running and DB is connected...');
});

app.use('/api/auth', authRouter);
app.use('/api/repos', repoRouter);
const PORT = process.env.PORT;
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));