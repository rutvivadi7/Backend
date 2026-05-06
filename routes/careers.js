import express from 'express';
import { body, validationResult } from 'express-validator';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

const careerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: {
    success: false,
    message: 'Too many applications. Please try again later.'
  },
});

const createTransporter = () => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const talentValidation = [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2–50 characters.'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2–50 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),

  body('phone')
    .optional({ checkFalsy: true })
    .matches(/^[0-9]{10}$/)
    .withMessage('Phone number must be exactly 10 digits.'),

  body('location').trim().isLength({ min: 2, max: 100 }).withMessage('Location must be 2–100 characters.'),
  body('jobCategory').isIn(['construction', 'engineering', 'management', 'safety', 'operations', 'other']).withMessage('Invalid job category.'),
  body('experience').isIn(['entry', '1-3', '3-5', '5-10', '10+']).withMessage('Invalid experience level.'),
  body('availability').isIn(['immediate', '2-weeks', '1-month', '3-months']).withMessage('Invalid availability.'),
];

// ─── POST /api/careers/talent-network ─────────────────────────────────────
// Only saves data. Email with PDF should be sent from upload/resume route.
router.post('/api/talent-network', careerLimiter, talentValidation, async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
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
    phone = '',
    location,
    jobCategory = 'other',
    experience = 'entry',
    availability = 'immediate',
  } = req.body;

  const ip = req.ip || req.socket.remoteAddress || '';

  try {
    const [result] = await pool.query(
      `INSERT INTO talent_network
       (first_name, last_name, email, phone, location, job_category, experience, availability, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstName,
        lastName,
        email,
        phone || '',
        location,
        jobCategory || 'other',
        experience || 'entry',
        availability || 'immediate',
        ip,
      ]
    );

    res.json({
      success: true,
      message: 'Thank you for joining our talent network! We will contact you when suitable opportunities arise.',
      data: { id: result.insertId },
    });

  } catch (err) {
    console.error('Talent network MySQL error:', err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ─── GET /api/careers/jobs ─────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const [jobs] = await pool.query(
      `SELECT id, title, department, location, type, experience_required AS experience,
              salary_range, description, posted_at
       FROM jobs
       WHERE is_active = 1
       ORDER BY posted_at DESC`
    );

    res.json({
      success: true,
      data: jobs,
    });

  } catch (err) {
    console.error('Get jobs error:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs.',
    });
  }
});

// ─── GET /api/careers/jobs/:id ─────────────────────────────────────────────
router.get('/jobs/:id', async (req, res) => {
  const jobId = parseInt(req.params.id, 10);

  if (isNaN(jobId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid job ID.',
    });
  }

  try {
    const [[job]] = await pool.query(
      `SELECT id, title, department, location, type, experience_required AS experience,
              salary_range, description, posted_at
       FROM jobs 
       WHERE id = ? AND is_active = 1`,
      [jobId]
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found.',
      });
    }

    const [[reqs], [resps], [bens]] = await Promise.all([
      pool.query('SELECT requirement FROM job_requirements WHERE job_id = ? ORDER BY sort_order', [jobId]),
      pool.query('SELECT responsibility FROM job_responsibilities WHERE job_id = ? ORDER BY sort_order', [jobId]),
      pool.query('SELECT benefit FROM job_benefits WHERE job_id = ? ORDER BY sort_order', [jobId]),
    ]);

    res.json({
      success: true,
      data: {
        ...job,
        requirements: reqs.map(r => r.requirement),
        responsibilities: resps.map(r => r.responsibility),
        benefits: bens.map(b => b.benefit),
      },
    });

  } catch (err) {
    console.error('Get job detail error:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch job.',
    });
  }
});

// ─── POST /api/careers/jobs ────────────────────────────────────────────────
router.post('/jobs', authMiddleware, async (req, res) => {
  const {
    title,
    department,
    location,
    type,
    experience_required,
    salary_range,
    description,
    requirements = [],
    responsibilities = [],
    benefits = [],
  } = req.body;

  if (!title || !department || !location || !experience_required || !description) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields.',
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO jobs 
       (title, department, location, type, experience_required, salary_range, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        department,
        location,
        type || 'Full-time',
        experience_required,
        salary_range || null,
        description,
      ]
    );

    const jobId = result.insertId;

    if (requirements.length) {
      await conn.query(
        'INSERT INTO job_requirements (job_id, requirement, sort_order) VALUES ?',
        [requirements.map((r, i) => [jobId, r, i])]
      );
    }

    if (responsibilities.length) {
      await conn.query(
        'INSERT INTO job_responsibilities (job_id, responsibility, sort_order) VALUES ?',
        [responsibilities.map((r, i) => [jobId, r, i])]
      );
    }

    if (benefits.length) {
      await conn.query(
        'INSERT INTO job_benefits (job_id, benefit, sort_order) VALUES ?',
        [benefits.map((b, i) => [jobId, b, i])]
      );
    }

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'Job created.',
      data: { id: jobId },
    });

  } catch (err) {
    await conn.rollback();

    console.error('Create job error:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to create job.',
    });

  } finally {
    conn.release();
  }
});

// ─── PUT /api/careers/jobs/:id ─────────────────────────────────────────────
router.put('/jobs/:id', authMiddleware, async (req, res) => {
  const jobId = parseInt(req.params.id, 10);

  const {
    title,
    department,
    location,
    type,
    experience_required,
    salary_range,
    description,
    is_active,
    requirements = [],
    responsibilities = [],
    benefits = [],
  } = req.body;

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE jobs 
       SET title = ?, department = ?, location = ?, type = ?, experience_required = ?,
           salary_range = ?, description = ?, is_active = ?
       WHERE id = ?`,
      [
        title,
        department,
        location,
        type,
        experience_required,
        salary_range,
        description,
        is_active ?? 1,
        jobId,
      ]
    );

    await conn.query('DELETE FROM job_requirements WHERE job_id = ?', [jobId]);
    await conn.query('DELETE FROM job_responsibilities WHERE job_id = ?', [jobId]);
    await conn.query('DELETE FROM job_benefits WHERE job_id = ?', [jobId]);

    if (requirements.length) {
      await conn.query(
        'INSERT INTO job_requirements (job_id, requirement, sort_order) VALUES ?',
        [requirements.map((r, i) => [jobId, r, i])]
      );
    }

    if (responsibilities.length) {
      await conn.query(
        'INSERT INTO job_responsibilities (job_id, responsibility, sort_order) VALUES ?',
        [responsibilities.map((r, i) => [jobId, r, i])]
      );
    }

    if (benefits.length) {
      await conn.query(
        'INSERT INTO job_benefits (job_id, benefit, sort_order) VALUES ?',
        [benefits.map((b, i) => [jobId, b, i])]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: 'Job updated.',
    });

  } catch (err) {
    await conn.rollback();

    console.error('Update job error:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to update job.',
    });

  } finally {
    conn.release();
  }
});

// ─── DELETE /api/careers/jobs/:id ──────────────────────────────────────────
router.delete('/jobs/:id', authMiddleware, async (req, res) => {
  const jobId = parseInt(req.params.id, 10);

  try {
    await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);

    res.json({
      success: true,
      message: 'Job deleted.',
    });

  } catch (err) {
    console.error('Delete job error:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to delete job.',
    });
  }
});

export default router;