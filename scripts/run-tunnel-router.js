import {startRouter} from '@dot-bridge/core/router/main.js';
import {larkAdapter} from '../src/tunnel-adapter.js';
await startRouter([larkAdapter]);
