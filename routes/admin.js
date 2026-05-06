import express from 'express';
import { body, param, validationResult } from 'express-validator';
import fs   from 'fs';                            // ← NEW
import path from 'path';                          // ← NEW
import pool from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// All admin routes require a valid JWT
router.use(authMiddleware);

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, message: 'Validation failed.', errors: errors.array() });
    return false;
  }
  return true;
};

// ────────────────────────────────────────────────────────────────────────────
// Dashboard stats
// ────────────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [[contacts]]  = await pool.query('SELECT COUNT(*) AS total, SUM(status="new") AS new_count FROM contact_submissions');
    const [[talent]]    = await pool.query('SELECT COUNT(*) AS total FROM talent_network');
    const [[resumes]]   = await pool.query('SELECT COUNT(*) AS total, SUM(status="new") AS new_count FROM resume_uploads');
    const [[jobs]]      = await pool.query('SELECT COUNT(*) AS total FROM jobs WHERE is_active = 1');
    const [[clients]]   = await pool.query('SELECT COUNT(*) AS total FROM clients');
    const [[projects]]  = await pool.query('SELECT COUNT(*) AS total FROM projects');

    res.json({
      success: true,
      data: {
        contacts:  { total: contacts.total,  new: contacts.new_count  },
        talent:    { total: talent.total  },
        resumes:   { total: resumes.total,   new: resumes.new_count   },
        activeJobs:  jobs.total,
        clients:   clients.total,
        projects:  projects.total,
      },
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Contact submissions  (read + status update)
// ────────────────────────────────────────────────────────────────────────────
router.get('/contact-submissions', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 500'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Fetch contacts error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch submissions.' });
  }
});

router.patch('/contact-submissions/:id/status',
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['new','read','replied','archived']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.query('UPDATE contact_submissions SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
      res.json({ success: true, message: 'Status updated.' });
    } catch (err) {
      console.error('Update contact status error:', err);
      res.status(500).json({ success: false, message: 'Failed to update status.' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// Talent network submissions  (read + status update)
// ────────────────────────────────────────────────────────────────────────────
router.get('/talent-network', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM talent_network ORDER BY created_at DESC LIMIT 500');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Fetch talent error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch talent network.' });
  }
});

router.patch('/talent-network/:id/status',
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['active','contacted','hired','inactive']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.query('UPDATE talent_network SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
      res.json({ success: true, message: 'Status updated.' });
    } catch (err) {
      console.error('Update talent status error:', err);
      res.status(500).json({ success: false, message: 'Failed to update status.' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// Resume uploads  (read + status update + DELETE)
// ────────────────────────────────────────────────────────────────────────────
router.get('/resumes', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM resume_uploads ORDER BY created_at DESC LIMIT 500');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Fetch resumes error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch resumes.' });
  }
});

router.patch('/resumes/:id/status',
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['new','reviewed','shortlisted','rejected']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.query('UPDATE resume_uploads SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
      res.json({ success: true, message: 'Status updated.' });
    } catch (err) {
      console.error('Update resume status error:', err);
      res.status(500).json({ success: false, message: 'Failed to update status.' });
    }
  }
);

// ─── NEW: DELETE /api/admin/resumes/:id ──────────────────────────────────
router.delete('/resumes/:id',
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    if (!validate(req, res)) return;

    try {
      // 1. Fetch the row so we know the physical file name
      const [[resume]] = await pool.query(
        'SELECT file_name FROM resume_uploads WHERE id = ?',
        [req.params.id]
      );

      if (!resume) {
        return res.status(404).json({ success: false, message: 'Resume not found.' });
      }

      // 2. Delete DB record first
      const [result] = await pool.query(
        'DELETE FROM resume_uploads WHERE id = ?',
        [req.params.id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Resume not found.' });
      }

      // 3. Delete physical file (non-blocking — DB record already removed)
      const uploadsDir = path.resolve(process.env.UPLOAD_PATH || './uploads');
      const safeName   = path.basename(resume.file_name);   // prevent traversal
      const filePath   = path.join(uploadsDir, safeName);

      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
          // Log but don't fail the response — DB row is already gone
          console.warn(`Could not delete file ${filePath}:`, unlinkErr.message);
        }
      });

      res.json({ success: true, message: 'Resume deleted successfully.' });
    } catch (err) {
      console.error('Delete resume error:', err);
      res.status(500).json({ success: false, message: 'Failed to delete resume.' });
    }
  }
);
// ─────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Clients  — full CRUD
// ────────────────────────────────────────────────────────────────────────────
const clientValidation = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('phone').trim().notEmpty().withMessage('Phone required.'),
  body('company').trim().isLength({ min: 2, max: 200 }).withMessage('Company must be 2–200 characters.'),
  body('project').trim().isLength({ min: 2, max: 200 }).withMessage('Project must be 2–200 characters.'),
  body('status').optional().isIn(['Active','Pending','Completed']).withMessage('Invalid status.'),
];

router.get('/clients', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Fetch clients error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch clients.' });
  }
});

router.post('/clients', clientValidation, async (req, res) => {
  if (!validate(req, res)) return;
  const { name, email, phone, company, project, status = 'Pending' } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO clients (name, email, phone, company, project, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, phone, company, project, status]
    );
    res.status(201).json({ success: true, message: 'Client created.', data: { id: result.insertId } });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: 'Failed to create client.' });
  }
});

router.put('/clients/:id', [param('id').isInt({ min: 1 }), ...clientValidation], async (req, res) => {
  if (!validate(req, res)) return;
  const { name, email, phone, company, project, status } = req.body;
  try {
    const [result] = await pool.query(
      'UPDATE clients SET name=?, email=?, phone=?, company=?, project=?, status=? WHERE id=?',
      [name, email, phone, company, project, status, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Client not found.' });
    res.json({ success: true, message: 'Client updated.' });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ success: false, message: 'Failed to update client.' });
  }
});

router.delete('/clients/:id', [param('id').isInt({ min: 1 })], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [result] = await pool.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Client not found.' });
    res.json({ success: true, message: 'Client deleted.' });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete client.' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Projects  — full CRUD
// ────────────────────────────────────────────────────────────────────────────
const projectValidation = [
  body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Title must be 2–200 characters.'),
  body('client').trim().isLength({ min: 2, max: 200 }).withMessage('Client must be 2–200 characters.'),
  body('status').optional().isIn(['Planning','In Progress','Completed','On Hold']).withMessage('Invalid status.'),
  body('start_date').isDate().withMessage('Valid start date required (YYYY-MM-DD).'),
  body('end_date').isDate().withMessage('Valid end date required (YYYY-MM-DD).'),
  body('budget').trim().notEmpty().withMessage('Budget required.'),
  body('description').trim().isLength({ min: 10 }).withMessage('Description must be at least 10 characters.'),
];

router.get('/projects', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Fetch projects error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch projects.' });
  }
});

router.post('/projects', projectValidation, async (req, res) => {
  if (!validate(req, res)) return;
  const { title, client, status = 'Planning', start_date, end_date, budget, description } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO projects (title, client, status, start_date, end_date, budget, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, client, status, start_date, end_date, budget, description]
    );
    res.status(201).json({ success: true, message: 'Project created.', data: { id: result.insertId } });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ success: false, message: 'Failed to create project.' });
  }
});

router.put('/projects/:id', [param('id').isInt({ min: 1 }), ...projectValidation], async (req, res) => {
  if (!validate(req, res)) return;
  const { title, client, status, start_date, end_date, budget, description } = req.body;
  try {
    const [result] = await pool.query(
      'UPDATE projects SET title=?, client=?, status=?, start_date=?, end_date=?, budget=?, description=? WHERE id=?',
      [title, client, status, start_date, end_date, budget, description, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Project not found.' });
    res.json({ success: true, message: 'Project updated.' });
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ success: false, message: 'Failed to update project.' });
  }
});

router.delete('/projects/:id', [param('id').isInt({ min: 1 })], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [result] = await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Project not found.' });
    res.json({ success: true, message: 'Project deleted.' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete project.' });
  }
});

export default router;