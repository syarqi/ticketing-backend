export type Role = 'ADMIN' | 'TEKNISI' | 'USER';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
  fullName: string;
}

// Extend Express Request with the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
