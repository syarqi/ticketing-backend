import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),

  databaseUrl: process.env.DATABASE_URL,
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME ?? 'network_service_ticketing',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
  },

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',

  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  // On Vercel the filesystem is read-only except for /tmp, and files
  // written there are not guaranteed to persist between requests.
  uploadDir: process.env.VERCEL
    ? '/tmp/uploads'
    : path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads'),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB ?? '8', 10),

  seedAdminUsername: process.env.SEED_ADMIN_USERNAME ?? 'admin',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? '',
  seedAdminFullname: process.env.SEED_ADMIN_FULLNAME ?? 'Administrator',
};
