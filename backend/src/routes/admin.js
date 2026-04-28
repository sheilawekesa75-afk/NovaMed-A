/**
 * Admin routes (server-side only — never linked from the frontend).
 *
 * Restrictions enforced:
 *   - Admin can VIEW user accounts only (NO patient medical data)
 *   - Admin can enable / disable users
 *   - Every admin login is logged via audit_log + console alert
 */
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);
router.use(requireRole('admin'));

/* ── Account-only info: no PHI / patient medical data exposed ── */

router.get('/users', async (_req, res) => {
  const { rows } = await db.query(`
    SELECT id, full_name, email, role, specialty, is_verified, is_active,
           last_login_at, created_at,
           (SELECT COUNT(*) FROM patients p WHERE p.created_by = u.id)::int AS patients_count,
           (SELECT COUNT(*) FROM encounters e WHERE e.doctor_id = u.id)::int AS encounters_count
      FROM users u
     WHERE role != 'admin'
     ORDER BY created_at DESC
  `);
  res.json({ ok: true, users: rows });
});

router.post('/users/:id/enable', async (req, res) => {
  await db.query(`UPDATE users SET is_active = TRUE WHERE id = $1 AND role != 'admin'`, [req.params.id]);
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1, 'admin.user.enabled', 'user', $2, $3)`,
    [req.user.sub, req.params.id, JSON.stringify({ ts: new Date() })]
  );
  res.json({ ok: true });
});

router.post('/users/:id/disable', async (req, res) => {
  await db.query(`UPDATE users SET is_active = FALSE WHERE id = $1 AND role != 'admin'`, [req.params.id]);
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1, 'admin.user.disabled', 'user', $2, $3)`,
    [req.user.sub, req.params.id, JSON.stringify({ ts: new Date() })]
  );
  res.json({ ok: true });
});

router.get('/stats', async (_req, res) => {
  const c = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role != 'admin')                    AS users,
      (SELECT COUNT(*) FROM users WHERE role != 'admin' AND is_active)      AS users_active,
      (SELECT COUNT(*) FROM users WHERE role != 'admin' AND NOT is_active)  AS users_disabled,
      (SELECT COUNT(*) FROM patients)                                       AS patients,
      (SELECT COUNT(*) FROM encounters)                                     AS encounters,
      (SELECT COUNT(*) FROM diseases)                                       AS diseases
  `);
  res.json({ ok: true, stats: c.rows[0] });
});

router.get('/audit', async (_req, res) => {
  const { rows } = await db.query(`
    SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at,
           u.full_name AS user_name, u.email AS user_email
      FROM audit_log a
 LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT 200
  `);
  res.json({ ok: true, log: rows });
});

module.exports = router;
