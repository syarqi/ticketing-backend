import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/error';
import { upload } from '../middleware/upload';
import { nextTicketId } from '../utils/ticketId';

const router = Router();
router.use(requireAuth);

/* ------------------------------------------------------------------ */
/* Shared select fragments                                             */
/* ------------------------------------------------------------------ */

const TICKET_SELECT = `
  SELECT
    t.id, t.issue_type, t.detail, t.status, t.created_at, t.updated_at, t.closed_at,
    l.id AS location_id, l.name AS location_name,
    p.id AS priority_id, p.name AS priority_name, p.color AS priority_color, p.level AS priority_level,
    creator.id AS created_by_id, creator.full_name AS created_by_name,
    tech.id AS assigned_to_id, tech.full_name AS assigned_to_name
  FROM tickets t
  JOIN locations l ON l.id = t.location_id
  JOIN priorities p ON p.id = t.priority_id
  JOIN users creator ON creator.id = t.created_by
  LEFT JOIN users tech ON tech.id = t.assigned_to
`;

function mapTicketRow(row: any) {
  return {
    id: row.id,
    issueType: row.issue_type,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    location: { id: row.location_id, name: row.location_name },
    priority: {
      id: row.priority_id,
      name: row.priority_name,
      color: row.priority_color,
      level: row.priority_level,
    },
    createdBy: { id: row.created_by_id, fullName: row.created_by_name },
    assignedTo: row.assigned_to_id ? { id: row.assigned_to_id, fullName: row.assigned_to_name } : null,
  };
}

async function getTicketOr404(ticketId: string) {
  const { rows } = await pool.query(`${TICKET_SELECT} WHERE t.id = $1`, [ticketId]);
  if (rows.length === 0) throw new ApiError(404, 'Ticket not found');
  return mapTicketRow(rows[0]);
}

function attachmentUrl(filePath: string) {
  return `/uploads/${path.basename(filePath)}`;
}

/* ------------------------------------------------------------------ */
/* Create ticket                                                       */
/* ------------------------------------------------------------------ */

const createTicketSchema = z.object({
  locationId: z.string().uuid('locationId must be a valid location'),
  issueType: z.string().min(1, 'Jenis gangguan wajib diisi').max(200),
  priorityId: z.string().uuid('priorityId must be a valid priority'),
  detail: z.string().max(4000).optional().nullable(),
});

router.post(
  '/',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const data = createTicketSchema.parse(req.body);
    const userId = req.user!.id;

    // Validate referenced master data is active.
    const [loc, prio] = await Promise.all([
      pool.query('SELECT id, is_active FROM locations WHERE id = $1', [data.locationId]),
      pool.query('SELECT id, is_active FROM priorities WHERE id = $1', [data.priorityId]),
    ]);
    if (loc.rows.length === 0 || !loc.rows[0].is_active) {
      throw new ApiError(400, 'Selected location is invalid or inactive');
    }
    if (prio.rows.length === 0 || !prio.rows[0].is_active) {
      throw new ApiError(400, 'Selected priority is invalid or inactive');
    }

    const ticketId = await withTransaction(async (client) => {
      const id = await nextTicketId(client);
      await client.query(
        `INSERT INTO tickets (id, location_id, issue_type, priority_id, detail, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'OPEN', $6)`,
        [id, data.locationId, data.issueType, data.priorityId, data.detail ?? null, userId]
      );
      await client.query(
        `INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by)
         VALUES ($1, NULL, 'OPEN', $2)`,
        [id, userId]
      );
      if (req.file) {
        await client.query(
          `INSERT INTO ticket_attachments (ticket_id, ticket_update_id, file_path, original_name, mime_type, size_bytes, uploaded_by)
           VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
          [id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, userId]
        );
      }
      return id;
    });

    const ticket = await getTicketOr404(ticketId);
    res.status(201).json({ ticket });
  })
);

/* ------------------------------------------------------------------ */
/* Board: OPEN + IN_PROGRESS, sorted by priority then age              */
/* ------------------------------------------------------------------ */

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `${TICKET_SELECT}
       WHERE t.status IN ('OPEN', 'IN_PROGRESS')
       ORDER BY p.level ASC, t.created_at ASC`
    );
    res.json({ tickets: rows.map(mapTicketRow) });
  })
);

/* ------------------------------------------------------------------ */
/* My Tickets: tickets currently assigned to the logged-in technician  */
/* ------------------------------------------------------------------ */

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `${TICKET_SELECT}
       WHERE t.assigned_to = $1 AND t.status = 'IN_PROGRESS'
       ORDER BY p.level ASC, t.created_at ASC`,
      [req.user!.id]
    );
    res.json({ tickets: rows.map(mapTicketRow) });
  })
);

/* ------------------------------------------------------------------ */
/* Closed archive with search/filter                                   */
/* ------------------------------------------------------------------ */

const closedQuerySchema = z.object({
  ticketId: z.string().optional(),
  location: z.string().optional(),
  issueType: z.string().optional(),
  priority: z.string().optional(),
  technician: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

router.get(
  '/closed',
  asyncHandler(async (req, res) => {
    const q = closedQuerySchema.parse(req.query);
    const clauses: string[] = [`t.status = 'CLOSED'`];
    const values: unknown[] = [];
    let idx = 1;

    if (q.ticketId) {
      clauses.push(`t.id ILIKE $${idx++}`);
      values.push(`%${q.ticketId}%`);
    }
    if (q.location) {
      clauses.push(`l.name ILIKE $${idx++}`);
      values.push(`%${q.location}%`);
    }
    if (q.issueType) {
      clauses.push(`t.issue_type ILIKE $${idx++}`);
      values.push(`%${q.issueType}%`);
    }
    if (q.priority) {
      clauses.push(`p.name ILIKE $${idx++}`);
      values.push(`%${q.priority}%`);
    }
    if (q.technician) {
      clauses.push(`tech.full_name ILIKE $${idx++}`);
      values.push(`%${q.technician}%`);
    }
    if (q.dateFrom) {
      clauses.push(`t.closed_at >= $${idx++}`);
      values.push(q.dateFrom);
    }
    if (q.dateTo) {
      clauses.push(`t.closed_at <= $${idx++}`);
      values.push(q.dateTo);
    }

    const { rows } = await pool.query(
      `${TICKET_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY t.closed_at DESC`,
      values
    );
    res.json({ tickets: rows.map(mapTicketRow) });
  })
);

/* ------------------------------------------------------------------ */
/* Detail: ticket + timeline of updates + attachments                  */
/* ------------------------------------------------------------------ */

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const ticket = await getTicketOr404(req.params.id);

    const [updatesResult, attachmentsResult] = await Promise.all([
      pool.query(
        `SELECT tu.id, tu.note, tu.created_at,
                u.id AS user_id, u.full_name AS user_full_name,
                ut.id AS update_type_id, ut.name AS update_type_name
         FROM ticket_updates tu
         JOIN users u ON u.id = tu.user_id
         LEFT JOIN update_types ut ON ut.id = tu.update_type_id
         WHERE tu.ticket_id = $1
         ORDER BY tu.created_at ASC`,
        [ticket.id]
      ),
      pool.query(
        `SELECT id, ticket_update_id, file_path, original_name, created_at
         FROM ticket_attachments WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticket.id]
      ),
    ]);

    const attachmentsByUpdate = new Map<string | null, any[]>();
    for (const a of attachmentsResult.rows) {
      const key = a.ticket_update_id;
      const list = attachmentsByUpdate.get(key) ?? [];
      list.push({ id: a.id, url: attachmentUrl(a.file_path), originalName: a.original_name, createdAt: a.created_at });
      attachmentsByUpdate.set(key, list);
    }

    const updates = updatesResult.rows.map((u: any) => ({
      id: u.id,
      note: u.note,
      createdAt: u.created_at,
      user: { id: u.user_id, fullName: u.user_full_name },
      updateType: u.update_type_id ? { id: u.update_type_id, name: u.update_type_name } : null,
      attachments: attachmentsByUpdate.get(u.id) ?? [],
    }));

    res.json({
      ticket: {
        ...ticket,
        initialAttachments: attachmentsByUpdate.get(null) ?? [],
      },
      updates,
    });
  })
);

/* ------------------------------------------------------------------ */
/* AMBIL: OPEN -> IN_PROGRESS, assign to current user                  */
/* ------------------------------------------------------------------ */

router.post(
  '/:id/take',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    const ticket = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, status FROM tickets WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      if (rows.length === 0) throw new ApiError(404, 'Ticket not found');
      if (rows[0].status !== 'OPEN') {
        throw new ApiError(409, 'Ticket has already been taken or is no longer open');
      }

      await client.query(
        `UPDATE tickets SET status = 'IN_PROGRESS', assigned_to = $1 WHERE id = $2`,
        [userId, req.params.id]
      );
      await client.query(
        `INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by)
         VALUES ($1, 'OPEN', 'IN_PROGRESS', $2)`,
        [req.params.id, userId]
      );
      return req.params.id;
    });

    res.json({ ticket: await getTicketOr404(ticket) });
  })
);

/* ------------------------------------------------------------------ */
/* Ownership guard shared by updates + close                           */
/* ------------------------------------------------------------------ */

async function assertOwnsInProgressTicket(ticketId: string, userId: string, role: string) {
  const { rows } = await pool.query('SELECT status, assigned_to FROM tickets WHERE id = $1', [ticketId]);
  if (rows.length === 0) throw new ApiError(404, 'Ticket not found');
  if (rows[0].status !== 'IN_PROGRESS') {
    throw new ApiError(409, 'Ticket is not in progress');
  }
  if (rows[0].assigned_to !== userId && role !== 'ADMIN') {
    throw new ApiError(403, 'Only the assigned technician (or an admin) may modify this ticket');
  }
}

/* ------------------------------------------------------------------ */
/* Add a progress update                                                */
/* ------------------------------------------------------------------ */

const addUpdateSchema = z.object({
  updateTypeId: z.string().uuid('updateTypeId is required'),
  note: z.string().max(4000).optional().nullable(),
});

router.post(
  '/:id/updates',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const data = addUpdateSchema.parse(req.body);
    const userId = req.user!.id;

    await assertOwnsInProgressTicket(req.params.id, userId, req.user!.role);

    const updateType = await pool.query('SELECT id, is_active FROM update_types WHERE id = $1', [data.updateTypeId]);
    if (updateType.rows.length === 0 || !updateType.rows[0].is_active) {
      throw new ApiError(400, 'Selected update type is invalid or inactive');
    }

    const updateId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ticket_updates (ticket_id, user_id, update_type_id, note)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.params.id, userId, data.updateTypeId, data.note ?? null]
      );
      const newUpdateId = rows[0].id;
      if (req.file) {
        await client.query(
          `INSERT INTO ticket_attachments (ticket_id, ticket_update_id, file_path, original_name, mime_type, size_bytes, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.params.id, newUpdateId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, userId]
        );
      }
      return newUpdateId;
    });

    res.status(201).json({ updateId });
  })
);

/* ------------------------------------------------------------------ */
/* Close ticket: IN_PROGRESS -> CLOSED                                  */
/* ------------------------------------------------------------------ */

router.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    await assertOwnsInProgressTicket(req.params.id, userId, req.user!.role);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE tickets SET status = 'CLOSED', closed_at = now() WHERE id = $1`,
        [req.params.id]
      );
      await client.query(
        `INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by)
         VALUES ($1, 'IN_PROGRESS', 'CLOSED', $2)`,
        [req.params.id, userId]
      );
    });

    res.json({ ticket: await getTicketOr404(req.params.id) });
  })
);

export default router;
