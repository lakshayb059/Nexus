const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.GATEWAY_PORT || process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));

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

  // Fire-and-forget pings in the background. Even if they return 404, Render registers the inbound request and keeps them awake!
  downstreamUrls.forEach(url => {
    axios.get(`${url}/health`).catch(() => {
      // Quietly ignore connection errors or 404s
    });
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
    secure: service.target.startsWith('https:'), // Enable SSL certificate verification for remote HTTPS targets (SNI required by Render)
    pathRewrite: (path) => {
      return path.startsWith('/api') ? path.replace('/api', '') : path;
    },
    logLevel: 'debug',
    onError: (err, req, res) => {
      console.error(`❌ [Gateway Proxy Error] Failed to proxy ${req.method} ${req.url} to ${service.target}:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Bad Gateway',
          message: 'The API Gateway failed to communicate with the downstream service.',
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
      console.log(`✅ [Gateway Response] Received ${proxyRes.statusCode} from ${service.target} for ${req.method} ${req.url}`);
    },
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
      // Ensure WebSocket handshake headers are perfectly preserved
      proxyReq.setHeader('Origin', service.target);
    }
  }));
});

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on http://localhost:${PORT}`);
});
