import express from 'express';
import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────
router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').notEmpty().withMessage('Password required.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const [rows] = await pool.query(
        'SELECT id, name, email, password_hash, role FROM admin_users WHERE email = ? AND is_active = 1',
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      const admin = rows[0];
      const match = await bcrypt.compare(password, admin.password_hash);
      if (!match) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      const token = jwt.sign(
        { id: admin.id, email: admin.email, role: admin.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
      );

      res.json({
        success: true,
        message: 'Login successful.',
        data: {
          token,
          user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ success: false, message: 'Server error.' });
    }
  }
);

// ─── POST /api/auth/register  (requires existing super_admin token) ────────
router.post(
  '/register',
  authMiddleware,
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 chars.'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role').optional().isIn(['admin', 'super_admin']).withMessage('Invalid role.'),
  ],
  async (req, res) => {
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can register new users.' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email, password, role = 'admin' } = req.body;

    try {
      const [existing] = await pool.query('SELECT id FROM admin_users WHERE email = ?', [email]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'Email already registered.' });
      }

      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.query(
        'INSERT INTO admin_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, email, hash, role]
      );

      res.status(201).json({
        success: true,
        message: 'Admin user created.',
        data: { id: result.insertId, name, email, role },
      });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ success: false, message: 'Server error.' });
    }
  }
);

// ─── POST /api/auth/change-password ───────────────────────────────────────
router.post(
  '/change-password',
  authMiddleware,
  [
    body('currentPassword').notEmpty().withMessage('Current password required.'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    try {
      const [rows] = await pool.query('SELECT password_hash FROM admin_users WHERE id = ?', [req.admin.id]);
      if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });

      const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!match) return res.status(401).json({ success: false, message: 'Current password incorrect.' });

      const hash = await bcrypt.hash(newPassword, 12);
      await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, req.admin.id]);

      res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
      console.error('Change-password error:', err);
      res.status(500).json({ success: false, message: 'Server error.' });
    }
  }
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, created_at FROM admin_users WHERE id = ?',
      [req.admin.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

export default router;
