import express from 'express';
import { body, validationResult } from 'express-validator';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many contact form submissions. Please try again later.',
  },
});

const createTransporter = () => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 465,
    secure: String(process.env.EMAIL_PORT) === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const contactValidation = [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2–50 characters.'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2–50 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('phone').optional({ checkFalsy: true }).trim(),
  body('inquiryType').optional({ checkFalsy: true }).trim(),
  body('message').trim().isLength({ min: 5, max: 1000 }).withMessage('Message must be at least 5 characters.'),
  body('captchaVerified').optional().isBoolean(),
];

router.post('/', contactLimiter, contactValidation, async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: errors.array(),
    });
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    inquiryType = 'general',
    message,
  } = req.body;

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

  try {
    const [result] = await pool.query(
      `INSERT INTO contact_submissions
        (first_name, last_name, email, phone, inquiry_type, message, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        firstName,
        lastName,
        email,
        phone || null,
        inquiryType,
        message,
        ip,
      ]
    );

    const transporter = createTransporter();

    if (transporter) {
      transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: (process.env.EMAIL_TO || process.env.EMAIL_USER)
          .split(',')
          .map((e) => e.trim()),
        subject: `New Contact Form Submission #${result.insertId}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><b>Name:</b> ${firstName} ${lastName}</p>
          <p><b>Email:</b> ${email}</p>
          <p><b>Phone:</b> ${phone || '-'}</p>
          <p><b>Inquiry Type:</b> ${inquiryType}</p>
          <p><b>Message:</b></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `,
      }).catch((mailErr) => {
        console.warn('Email failed but form saved:', mailErr.message);
      });
    }

    return res.json({
      success: true,
      message: 'Thank you! We will get back to you soon.',
    });
  } catch (err) {
    console.error('Contact form error:', err.message);

    return res.status(500).json({
      success: false,
      message: 'Failed to send message. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

router.get('/test', async (req, res) => {
  const transporter = createTransporter();

  if (!transporter) {
    return res.json({
      success: false,
      message: 'Email configuration missing.',
    });
  }

  try {
    await transporter.verify();

    return res.json({
      success: true,
      message: 'Email configuration valid.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Email test failed.',
      error: err.message,
    });
  }
});

export default router;