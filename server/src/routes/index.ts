/**
 * Root API Router Aggregator
 * Indian Railways WRS Raipur (Phase 1 & Phase 2)
 */

import { Router } from '../framework/index.ts';
import { classifyRouter } from './classify.ts';
import { inspectionsRouter } from './inspections.ts';
import { authRouter } from './auth.ts';
import { healthRouter } from './health.ts';
import { i18nRouter } from './i18n.ts';
import { syncRouter } from './sync.ts';
import { wagonsRouter } from './wagons.ts';
import { checklistRouter } from './checklist.ts';
import { photosRouter } from './photos.ts';
import { analyticsRouter } from './analytics.ts';
import { gaugesRouter } from './gauges.ts';
import { inventoryRouter } from './inventory.ts';
import { cvRouter } from './cv.ts';
import { acousticRouter } from './acoustic.ts';
import { componentsRouter } from './components.ts';
import { learningRouter } from './learning.ts';
import { manualRouter } from './manual.ts';
import { auditRouter } from './audit.ts';
import { sortingRouter } from './sorting.ts';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/inspections', inspectionsRouter);
apiRouter.use('/i18n', i18nRouter);
apiRouter.use('/sync', syncRouter);
apiRouter.use('/wagons', wagonsRouter);
apiRouter.use('/checklist', checklistRouter);
apiRouter.use('/photos', photosRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/gauges', gaugesRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/cv', cvRouter);
apiRouter.use('/acoustic', acousticRouter);
apiRouter.use('/components', componentsRouter);
apiRouter.use('/learning', learningRouter);
apiRouter.use('/manual', manualRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/sorting', sortingRouter);
apiRouter.use('/classification', classifyRouter);
apiRouter.use('/', classifyRouter);
apiRouter.use('/', healthRouter);


