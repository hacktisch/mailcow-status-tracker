import dotenv from 'dotenv';
// Load environment variables
dotenv.config();
import cron from 'node-cron';
import { syncLogsWithDb } from './logs.js';
import { router } from './router.js';

const { NODE_ENV, CRON_SCHEDULE, PORT } = process.env;
const devMode = NODE_ENV === 'development';

// Set up cron job if a schedule is defined
if (CRON_SCHEDULE) {
  console.log(`Running sync function with cron schedule: ${CRON_SCHEDULE}`);

  cron.schedule(CRON_SCHEDULE, async () => {
    if (devMode) {
      console.log(`Mailcow sync executing at ${new Date().toISOString()}`);
    }
    try {
      const result = await syncLogsWithDb();
      if (devMode) {
        console.log(result);
      }
    } catch (error) {
      console.error('Error during sync:', error.message);
    }
  });
}

// Start the server
const port = PORT || 3005;
router.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

