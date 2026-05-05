const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const { seed } = require('./mongodb');
const AppointmentService = require('./services/appointmentService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // We allow all for dev, or restrict to specific origins
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Make io accessible in routes
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});
const PORT = process.env.PORT || 3000;

// CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.toLowerCase().replace(/\/$/, '');
    
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'https://crm-eight-sage.vercel.app',
      'https://crm-orcin-one.vercel.app',
      'https://crm-uf1s.onrender.com',
    ].filter(Boolean).map(o => o.toLowerCase().replace(/\/$/, ''));
    
    if (!origin || allowedOrigins.includes(origin.toLowerCase().replace(/\/$/, '')) || origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 200
};



app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(require('cookie-parser')());

// Serve static frontend files from client/dist (if built)
const distPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  console.warn('⚠️ Warning: frontend build (client/dist) not found. Run "npm run build" in the client directory if you want the server to serve the frontend.');
}

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/leads-management', require('./routes/leads-management'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/reports', require('./routes/reports'));

// Fallback route to serve frontend for any non-API routes
app.get('*', (req, res) => {
  const indexHtml = path.join(__dirname, '../client/dist', 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(404).json({ 
      error: 'Frontend build not found', 
      message: 'In development, please access the frontend via port 5173 (Vite). In production, run "npm run build" in the client directory.' 
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await seed();
  
  // Initialize appointment service
  const appointmentService = new AppointmentService(io);
  appointmentService.start();
  
  server.listen(PORT, () => {
    console.log(`\n✅ CRM Server running at http://localhost:${PORT}`);
    console.log(`\nDemo credentials:`);
    console.log(`  Admin:  admin / admin123`);
    console.log(`  TL:     tl_rohit / tl123`);
    console.log(`  Agent:  agent_priya / ag123`);
    console.log(`  Agent:  agent_amit / ag123\n`);
    console.log(`📅 Appointment notification service enabled`);
  });
}

start().catch(console.error);
