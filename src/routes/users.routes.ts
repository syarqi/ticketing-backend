import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/error';
import { hashPassword } from '../utils/password';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, username, full_name, role, is_active, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: rows });
  })
);

const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dot, dash, underscore'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1).max(150),
  role: z.enum(['ADMIN', 'TEKNISI']),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createUserSchema.parse(req.body);

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [data.username]);
    if (existing.rows.length > 0) {
      throw new ApiError(409, 'Username already exists');
    }

    const passwordHash = await hashPassword(data.password);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, full_name, role, is_active, created_at`,
      [data.username, passwordHash, data.fullName, data.role]
    );
    res.status(201).json({ user: rows[0] });
  })
);

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(150).optional(),
  role: z.enum(['ADMIN', 'TEKNISI']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateUserSchema.parse(req.body);
    const { id } = req.params;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.fullName !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(data.fullName);
    }
    if (data.role !== undefined) {
      fields.push(`role = $${idx++}`);
      values.push(data.role);
    }
    if (data.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(data.isActive);
    }
    if (data.password !== undefined) {
      const hash = await hashPassword(data.password);
      fields.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (fields.length === 0) {
      throw new ApiError(400, 'No fields to update');
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, username, full_name, role, is_active, created_at`,
      values
    );

    if (rows.length === 0) throw new ApiError(404, 'User not found');
    res.json({ user: rows[0] });
  })
);

export default router;
