// -----------------------------------------------------------------------------
// Entry point of the Foscam integration for Gladys Assistant.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them: `new GladysIntegration()` is enough.
//
// Everything else is in src/app.js, which registers the handlers before
// connect().
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp(gladys);

// A camera that answers garbage must never take the integration down.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

// SIGTERM / SIGINT from the supervisor: stop the loops and any PTZ move, then
// the SDK disconnects and exits with code 0.
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await app.stop();
});

logger.info('Starting the Foscam integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
