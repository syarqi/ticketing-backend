import app from '../src/app';

// Vercel serverless entrypoint: exporting the Express app directly
// works because Express apps are callable as (req, res) handlers.
export default app;
