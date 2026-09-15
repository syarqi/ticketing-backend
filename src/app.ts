import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';

import authRoutes from './routes/auth.routes';
import ticketsRoutes from './routes/tickets.routes';
import masterDataRoutes from './routes/masterData.routes';
import usersRoutes from './routes/users.routes';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

// Static file serving for uploaded ticket photos.
// Note: on serverless platforms (Vercel) this directory is ephemeral —
// uploaded files are not guaranteed to persist between requests.
app.use('/uploads', express.static(env.uploadDir));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/master', masterDataRoutes);
app.use('/api/users', usersRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
