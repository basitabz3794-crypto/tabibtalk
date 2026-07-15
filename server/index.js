require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const { router: authRoutes } = require('./routes/auth');
const plansRoutes = require('./routes/plans');
const instapayRoutes = require('./routes/instapay');
const upiRoutes = require('./routes/upi');
const paypalRoutes = require('./routes/paypal');
const recommendationRoutes = require('./routes/recommendations');
const progressRoutes = require('./routes/progress');
const notificationRoutes = require('./routes/notifications');
const sharesRoutes = require('./routes/shares');
const interestsRoutes = require('./routes/interests');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production',
  },
}));

// Static frontend + uploaded payment-proof screenshots
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/instapay', instapayRoutes);
app.use('/api/upi', upiRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/shares', sharesRoutes);
app.use('/api/interests', interestsRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Firebase client config, served from env so it lives in one place.
// These values are safe to expose publicly — a Firebase web API key identifies
// the project, it doesn't authorise anything on its own. The Admin SDK service
// account (FIREBASE_SERVICE_ACCOUNT_JSON) is the secret, and never leaves the server.
app.get('/api/config/firebase', (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: process.env.FIREBASE_DATABASE_URL || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tabib Talk web server running on http://localhost:${PORT}`);
});
