import { logger } from '../utils/logger.js';
import { startIcCounterLoop } from '../utils/icCounter.js';

export default {
  name: 'clientReady',
  once: true,
  async execute(client, runtime) {
    try {
      await startIcCounterLoop(client, runtime);
    } catch (error) {
      logger.error('IC-Counter konnte nicht gestartet werden.', error);
    }
  }
};