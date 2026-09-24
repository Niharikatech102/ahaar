import { createApp } from '../src/server.js';
const app = createApp();
export default (req: any, res: any) => app(req, res);
