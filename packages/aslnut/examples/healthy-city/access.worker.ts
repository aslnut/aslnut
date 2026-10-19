// Park access for the whole place, made off the main thread (access-place.ts): the walking graph, the parks, their
// entrances, the one pass and the walk bands, once at load; then each house once as its tile arrives.
import { serve } from '../../src/core/runtime/workers.ts';
import { accessPlace } from './access-place.ts';

serve(accessPlace());
