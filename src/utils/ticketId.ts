import { PoolClient } from 'pg';

/**
 * Generates the next ticket ID in the format DDMMYYNNNN, e.g. 1209260001.
 * The 4-digit sequence resets every day.
 *
 * Concurrency safety: the increment happens as a single atomic
 * UPSERT statement (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`),
 * which Postgres executes atomically even under concurrent transactions,
 * so two simultaneous ticket creations can never receive the same number.
 * This must be called from within the same transaction that inserts
 * the ticket row, so the caller should pass the transaction's client.
 */
export async function nextTicketId(client: PoolClient, now: Date = new Date()): Promise<string> {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const dateKey = `${dd}${mm}${yy}`;

  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO ticket_sequences (date_key, last_seq)
     VALUES ($1, 1)
     ON CONFLICT (date_key)
     DO UPDATE SET last_seq = ticket_sequences.last_seq + 1
     RETURNING last_seq`,
    [dateKey]
  );

  const seq = rows[0].last_seq;
  if (seq > 9999) {
    throw new Error(`Daily ticket sequence exhausted for ${dateKey} (max 9999)`);
  }
  const seqStr = String(seq).padStart(4, '0');
  return `${dateKey}${seqStr}`;
}
