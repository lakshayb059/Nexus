const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.GATEWAY_PORT || process.env.PORT || 3000;

// Explicitly allowed origins
const ALLOWED_ORIGINS = [
  'https://crm-eight-sage.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Also allow any vercel.app subdomain
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    return callback(null, true); // Allow all for now — tighten later
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight for ALL routes

app.use(morgan('dev'));

// Helper to inject CORS headers on any response (needed when proxy errors)
const injectCorsHeaders = (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
};

// Service Routes
const services = [
  {
    path: ['/api/auth', '/api/users', '/auth', '/users'],
    target: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  },
  {
    path: ['/api/contacts', '/api/leads', '/api/leads-management', '/contacts', '/leads', '/leads-management'],
    target: process.env.LEAD_SERVICE_URL || 'http://localhost:3002',
  },
  {
    path: ['/api/notifications', '/notifications'],
    target: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3003',
  },
  {
    path: '/socket.io',
    target: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3003',
    ws: true
  },
  {
    path: ['/api/reports', '/api/upload', '/reports', '/upload'],
    target: process.env.REPORT_SERVICE_URL || 'http://localhost:3004',
  }
];

// Health check with downstream warmup pings for Render Free plan
const axios = require('axios');

const handleHealth = (req, res) => {
  const downstreamUrls = [
    process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
    process.env.LEAD_SERVICE_URL || 'http://localhost:3002',
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3003',
    process.env.REPORT_SERVICE_URL || 'http://localhost:3004'
  ];

  // Fire-and-forget pings in the background
  downstreamUrls.forEach(url => {
    axios.get(`${url}/health`).catch(() => {});
  });

  res.json({ 
    status: 'Gateway is up', 
    services: 'Warmup pings dispatched to downstream microservices',
    timestamp: new Date() 
  });
};

app.get('/health', handleHealth);
app.get('/', handleHealth);

// Setup Proxies
services.forEach(service => {
  app.use(createProxyMiddleware(service.path, {
    target: service.target,
    changeOrigin: true,
    ws: service.ws || false,
    secure: service.target.startsWith('https:'),
    pathRewrite: (path) => {
      return path.startsWith('/api') ? path.replace('/api', '') : path;
    },
    logLevel: 'debug',
    onError: (err, req, res) => {
      console.error(`❌ [Gateway Proxy Error] ${req.method} ${req.url} -> ${service.target}:`, err.message);
      // ALWAYS inject CORS headers before sending error — prevents browser CORS block
      injectCorsHeaders(req, res);
      if (!res.headersSent) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: '📡 Server is waking up from sleep (Render Free Tier cold start). Please wait 10-15 seconds and try again!',
          details: err.message,
          target: service.target,
          path: req.url
        });
      }
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`📡 [Gateway Proxy] ${req.method} ${req.url} -> ${service.target}${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
      // Inject CORS headers on all proxied responses too
      const origin = req.headers.origin || '*';
      proxyRes.headers['access-control-allow-origin'] = origin;
      proxyRes.headers['access-control-allow-credentials'] = 'true';
      console.log(`✅ [Gateway Response] ${proxyRes.statusCode} from ${service.target} for ${req.method} ${req.url}`);
    },
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
      proxyReq.setHeader('Origin', service.target);
    }
  }));
});

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on http://localhost:${PORT}`);
});

