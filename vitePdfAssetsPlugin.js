import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RESOURCE_DIRECTORIES = ['cmaps', 'standard_fonts'];
const ASSET_PREFIX = 'assets/pdfjs/';

export default function pdfAssetsPlugin() {
    let resourcesPromise;
    const loadResources = () => {
        resourcesPromise ||= (async () => {
            const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
            const resources = new Map();
            for (const directory of RESOURCE_DIRECTORIES) {
                const sourceDirectory = path.join(packageRoot, directory);
                const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isFile()) continue;
                    const fileName = `${ASSET_PREFIX}${directory}/${entry.name}`;
                    resources.set(fileName, await fs.readFile(path.join(sourceDirectory, entry.name)));
                }
            }
            return resources;
        })();
        return resourcesPromise;
    };

    return {
        name: 'bookmanager-pdf-assets',
        async generateBundle() {
            for (const [fileName, source] of await loadResources()) {
                this.emitFile({ type: 'asset', fileName, source });
            }
        },
        async configureServer(server) {
            const resources = await loadResources();
            server.middlewares.use((request, response, next) => {
                const rawPath = String(request.url || '').split('?')[0];
                if (!rawPath.startsWith(`/${ASSET_PREFIX}`)) return next();
                let fileName;
                try {
                    fileName = decodeURIComponent(rawPath.slice(1));
                } catch {
                    response.statusCode = 400;
                    response.end('Invalid resource path.');
                    return;
                }
                const resource = resources.get(fileName);
                if (!resource) {
                    response.statusCode = 404;
                    response.end('PDF resource not found.');
                    return;
                }
                if (request.method !== 'GET' && request.method !== 'HEAD') {
                    response.statusCode = 405;
                    response.setHeader('Allow', 'GET, HEAD');
                    response.end();
                    return;
                }
                const contentType = path.basename(fileName).startsWith('LICENSE')
                    ? 'text/plain; charset=utf-8'
                    : fileName.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream';
                response.setHeader('Content-Type', contentType);
                response.setHeader('Content-Length', resource.length);
                response.setHeader('Cache-Control', 'no-cache');
                response.setHeader('X-Content-Type-Options', 'nosniff');
                response.end(request.method === 'HEAD' ? undefined : resource);
            });
        },
    };
}
