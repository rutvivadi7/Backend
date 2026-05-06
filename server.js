import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'path';

// Import routes
import authRoutes    from './routes/auth.js';
import contactRoutes from './routes/contact.js';
import careerRoutes  from './routes/careers.js';
import uploadRoutes  from './routes/upload.js';
import adminRoutes   from './routes/admin.js';

// DB pool import triggers the connection check on startup
import './db.js';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── Security ──────────────────────────────────────────────────────────────
app.use(helmet());

// ─── Rate limiting (global) ────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
}));

const fallbackOrigins = [
  "http://localhost:5173",
];

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Use env if exists, otherwise fallback
const finalOrigins = allowedOrigins.length > 0 ? allowedOrigins : fallbackOrigins;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests like Postman or server-to-server (no origin)
    if (!origin) return callback(null, true);

    if (finalOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log("❌ Blocked by CORS:", origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ─── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static file serving for uploaded resumes ──────────────────────────────
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_PATH || './uploads')));

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'JKC Backend API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
  });
});

// ─── API routes ────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/careers', careerRoutes);
app.use('/api/upload',  uploadRoutes);
app.use('/api/admin',   adminRoutes);

// ─── 404 ───────────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

// ─── Global error handler ──────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Server Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 JKC Backend running on port ${PORT}`);
  console.log(`📍 Environment : ${process.env.NODE_ENV || 'production'}`);
  console.log(`🌐 CORS allowed: ${finalOrigins.join(', ')}`);
});

export default app;
