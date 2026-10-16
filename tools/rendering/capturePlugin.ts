import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Local development evidence only. Never registered in the production server. */
export function renderingCapture(): Plugin {
  return { name: 'rendering-capture', apply: 'serve', configureServer(server) {
    server.middlewares.use('/__rendering/capture', async (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) throw new Error('Capture too large');
          chunks.push(Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!/^[a-z0-9-]{1,80}-\d{2,4}x\d{2,4}$/.test(body.name) || !body.png?.startsWith('data:image/png;base64,')) throw new Error('Invalid capture');
        const dir = resolve(server.config.root, 'docs/rendering/captures'); mkdirSync(dir, { recursive: true });
        const png = Buffer.from(body.png.slice('data:image/png;base64,'.length), 'base64');
        if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
        writeFileSync(resolve(dir, `${body.name}.png`), png);
        writeFileSync(resolve(dir, `${body.name}.json`), JSON.stringify(body.metadata, null, 2));
        res.end(`docs/rendering/captures/${body.name}.png`);
      } catch (e) { res.statusCode = 400; res.end(String(e)); }
    });
  } };
}
