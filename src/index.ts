import app from './app';
import { env } from './config/env';

// Local development entrypoint only. On Vercel, the app is imported
// directly by api/index.ts as a serverless function (no listen()).
app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Network Service Ticketing API listening on port ${env.port} (${env.nodeEnv})`);
});
