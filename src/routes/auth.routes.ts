import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { verifyPassword } from '../utils/password';
import { signToken, requireAuth } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/error';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);

    const { rows } = await pool.query(
      `SELECT id, username, password_hash, full_name, role, is_active
       FROM users WHERE username = $1`,
      [username]
    );

    // Generic error message regardless of which check fails, to avoid
    // leaking whether a username exists.
    const invalid = () => new ApiError(401, 'Invalid username or password');

    if (rows.length === 0) throw invalid();
    const user = rows[0];
    if (!user.is_active) throw new ApiError(403, 'Account is deactivated');

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw invalid();

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
      },
    });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);

export default router;
