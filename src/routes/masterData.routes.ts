import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/error';

const router = Router();

router.use(requireAuth);

/* ------------------------------------------------------------------ */
/* Generic helpers for the three simple lookup tables                  */
/* ------------------------------------------------------------------ */

function buildLookupRouter(table: 'locations' | 'priorities' | 'update_types', extraColumns: string[] = []) {
  const r = Router();

  // Anyone authenticated can read active + inactive lists (frontend
  // decides what to show; tickets form only uses active=true items).
  r.get(
    '/',
    asyncHandler(async (_req, res) => {
      const orderBy = table === 'priorities' ? 'level ASC' : 'name ASC';
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
      res.json({ items: rows });
    })
  );

  // Mutations are Admin-only.
  r.use(requireRole('ADMIN'));

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const nameSchema = z.object({ name: z.string().min(1).max(200) }).passthrough();
      const data = nameSchema.parse(req.body);

      if (table === 'priorities') {
        const schema = z.object({
          name: z.string().min(1).max(50),
          color: z.string().min(1).max(20),
          level: z.number().int().min(1).max(100),
        });
        const p = schema.parse(req.body);
        const { rows } = await pool.query(
          `INSERT INTO ${table} (name, color, level) VALUES ($1, $2, $3) RETURNING *`,
          [p.name, p.color, p.level]
        );
        return res.status(201).json({ item: rows[0] });
      }

      const { rows } = await pool.query(
        `INSERT INTO ${table} (name) VALUES ($1) RETURNING *`,
        [data.name]
      );
      res.status(201).json({ item: rows[0] });
    })
  );

  r.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const schema = z.object({
        name: z.string().min(1).max(200).optional(),
        isActive: z.boolean().optional(),
        color: z.string().min(1).max(20).optional(),
        level: z.number().int().min(1).max(100).optional(),
      });
      const data = schema.parse(req.body);

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) {
        fields.push(`name = $${idx++}`);
        values.push(data.name);
      }
      if (data.isActive !== undefined) {
        fields.push(`is_active = $${idx++}`);
        values.push(data.isActive);
      }
      if (table === 'priorities' && data.color !== undefined) {
        fields.push(`color = $${idx++}`);
        values.push(data.color);
      }
      if (table === 'priorities' && data.level !== undefined) {
        fields.push(`level = $${idx++}`);
        values.push(data.level);
      }

      if (fields.length === 0) throw new ApiError(400, 'No fields to update');

      values.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE ${table} SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) throw new ApiError(404, 'Not found');
      res.json({ item: rows[0] });
    })
  );

  void extraColumns;
  return r;
}

router.use('/locations', buildLookupRouter('locations'));
router.use('/priorities', buildLookupRouter('priorities'));
router.use('/update-types', buildLookupRouter('update_types'));

export default router;
