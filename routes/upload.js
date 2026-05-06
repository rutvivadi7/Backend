import express from 'express';
import multer  from 'multer';
import path    from 'path';
import fs      from 'fs';
import nodemailer from 'nodemailer';               // ← NEW
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many file uploads. Please try again later.' },
});

// Ensure uploads directory exists
const uploadsDir = path.resolve(process.env.UPLOAD_PATH || './uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_TYPES = ['.pdf', '.doc', '.docx', '.txt'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename:    (_req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `resume-${suffix}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits:     { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_TYPES.includes(ext)) return cb(null, true);
    cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and TXT allowed.'), false);
  },
});

const resumeValidation = [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2–50 characters.'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2–50 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone().withMessage('Valid phone number required.'),
  body('position').trim().isLength({ min: 2, max: 100 }).withMessage('Position must be 2–100 characters.'),
];

const cleanup = (file) => {
  if (file) fs.unlink(file.path, () => {});
};

// ─── NEW: reusable transporter factory (same pattern as contact.js) ────────
const createTransporter = () => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_PORT === '465',
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
};

// ─── POST /api/upload/resume ───────────────────────────────────────────────
router.post('/resume', uploadLimiter, upload.single('resume'), resumeValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      cleanup(req.file);
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a resume file.' });
    }

    const { firstName, lastName, email, phone, position } = req.body;
    const ip = req.ip || req.socket.remoteAddress;

    const [result] = await pool.query(
      `INSERT INTO resume_uploads
         (first_name, last_name, email, phone, position, file_name, original_name, file_size, file_type, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstName, lastName, email, phone || '', position,
        req.file.filename, req.file.originalname,
        req.file.size,
        path.extname(req.file.originalname).toLowerCase().replace('.', ''),
        ip,
      ]
    );

    // ─── Send email notification with resume attached ──────────────────
    const transporter = createTransporter();
    if (transporter) {
      const fileSizeKB = (req.file.size / 1024).toFixed(0);

      transporter.sendMail({
        from:    process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to:      process.env.EMAIL_TO   || 'jaykrishna.surat@gmail.com',
        subject: `New Resume — ${position} | ${firstName} ${lastName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#7c3aed;color:#fff;padding:20px;text-align:center">
              <h1 style="margin:0">📄 New Resume Received</h1>
            </div>
            <div style="padding:20px;background:#faf5ff">
              <table style="width:100%;border-collapse:collapse">
                <tr>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe;font-weight:bold;width:35%">Full Name:</td>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe">${firstName} ${lastName}</td>
                </tr>
                <tr>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe;font-weight:bold">Email:</td>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe">
                    <a href="mailto:${email}" style="color:#7c3aed">${email}</a>
                  </td>
                </tr>
                ${phone ? `
                <tr>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe;font-weight:bold">Phone:</td>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe">${phone}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe;font-weight:bold">Areas of Interest:</td>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe">${position}</td>
                </tr>
                <tr>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe;font-weight:bold">Resume File:</td>
                  <td style="padding:10px;border-bottom:1px solid #ede9fe">
                    📎 ${req.file.originalname}
                    <span style="color:#6b7280;font-size:12px"> (${fileSizeKB} KB)</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px;font-weight:bold">Submitted:</td>
                  <td style="padding:10px">
                    ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                  </td>
                </tr>
              </table>

              <div style="margin-top:16px;padding:12px;background:#ede9fe;border-radius:6px;font-size:13px;color:#5b21b6;text-align:center">
                📎 Resume is attached to this email — open the attachment below.
              </div>

              <p style="margin-top:20px;font-size:12px;color:#6b7280;text-align:center">
                JKC Construction — Resume Upload Notification
              </p>
            </div>
          </div>`,

        // ── Attach the actual resume file ──────────────────────────────
        attachments: [
          {
            filename: req.file.originalname,          // original name e.g. "Rutvi_Resume.pdf"
            path:     req.file.path,                  // absolute path on disk
            contentType: req.file.mimetype,           // e.g. application/pdf
          },
        ],
      }).catch(mailErr => {
        console.warn('Resume upload email failed (file still saved):', mailErr.message);
      });
    }
    // ──────────────────────────────────────────────────────────────────────

    res.json({
      success: true,
      message: 'Resume uploaded successfully! We will review your application and contact you soon.',
      data: {
        fileName:     req.file.filename,
        originalName: req.file.originalname,
        size:         req.file.size,
        uploadDate:   new Date().toISOString(),
      },
    });
  } catch (err) {
    cleanup(req.file);
    console.error('Resume upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed. Please try again.' });
  }
});

// ─── GET /api/upload/files/:filename  (admin-protected download) ───────────
router.get('/files/:filename', authMiddleware, (req, res) => {
  // Prevent path traversal
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }
  res.download(filePath);
});

// ─── Multer error handler ──────────────────────────────────────────────────
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File too large. Maximum size is 5 MB.' });
  }
  res.status(400).json({ success: false, message: err.message || 'File upload error.' });
});

export default router;