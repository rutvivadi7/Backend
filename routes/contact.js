import express from 'express';
import { body, validationResult } from 'express-validator';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many contact form submissions. Please try again later.' },
});

const createTransporter = () => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_PORT === '465',
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
};

const contactValidation = [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2–50 characters.'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2–50 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone().withMessage('Valid phone number required.'),
  body('inquiryType').isIn(['general','careers','services','partnership','other']).withMessage('Invalid inquiry type.'),
  body('message').trim().isLength({ min: 5, max: 1000 }).withMessage('Message must be at least 5 characters.'),
  body('captchaVerified').isBoolean().custom(v => {
    if (!v) throw new Error('Please verify you are not a robot.');
    return true;
  }),
];

// ─── POST /api/contact ────────────────────────────────────────────────────
router.post('/', contactLimiter, contactValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
  }

  const { firstName, lastName, email, phone, inquiryType, message } = req.body;
  const ip = req.ip || req.socket.remoteAddress;

  try {
    // Persist to MySQL
    const [result] = await pool.query(
      `INSERT INTO contact_submissions
         (first_name, last_name, email, phone, inquiry_type, message, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [firstName, lastName, email, phone || null, inquiryType, message, ip]
    );

    // Send notification email (non-blocking — a failed email never fails the request)
    const transporter = createTransporter();
    if (transporter) {
      const emailContent = {
        from:    process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: (process.env.EMAIL_TO || 'jaykrishna.surat@gmail.com')
      .split(',')
      .map(e => e.trim()),
        subject: `New Contact Form Submission #${result.insertId} — ${inquiryType.toUpperCase()}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#2563eb;color:#fff;padding:20px;text-align:center">
              <h1 style="margin:0">New Contact Submission</h1>
            </div>
            <div style="padding:20px;background:#f8fafc">
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:bold;width:30%">ID:</td>
                    <td style="padding:10px;border-bottom:1px solid #e2e8f0">#${result.insertId}</td></tr>
                <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:bold">Name:</td>
                    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${firstName} ${lastName}</td></tr>
                <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:bold">Email:</td>
                    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${email}</td></tr>
                ${phone ? `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:bold">Phone:</td>
                    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${phone}</td></tr>` : ''}
                <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:bold">Inquiry:</td>
                    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${inquiryType.charAt(0).toUpperCase() + inquiryType.slice(1)}</td></tr>
              </table>
              <h3 style="color:#1e40af;margin-top:24px">Message:</h3>
              <div style="background:#fff;padding:15px;border-radius:5px;border-left:4px solid #2563eb">
                ${message.replace(/\n/g, '<br>')}
              </div>
              <p style="margin-top:16px;font-size:13px;color:#64748b">
                Submitted: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
              </p>
            </div>
          </div>`,
      };
      transporter.sendMail(emailContent).catch(mailErr => {
        console.warn('Email notification failed (submission still saved):', mailErr.message);
      });
    }

    res.json({ success: true, message: 'Thank you! We will get back to you soon.' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
  }
});

// ─── GET /api/contact/test ────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  const transporter = createTransporter();
  if (!transporter) return res.json({ success: false, message: 'Email configuration missing.' });
  try {
    await transporter.verify();
    res.json({ success: true, message: 'Email configuration valid.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Email test failed.', error: err.message });
  }
});

export default router;
