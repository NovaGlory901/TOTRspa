import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The server only accepts requests whose Origin matches its Host, so in dev the browser talks to
// this Vite server and Vite forwards /api to the real server with the Origin rewritten. The server
// is wherever you run it; set TOTR_SERVER (env or .env.local) to change it.
//
// `npm run publish:web` (PUBLISH_WEB=1) builds straight into the folder named by TOTR_APP_OUT (the
// server's static/app/). Every build gets a BUILD_ID, baked into the bundle and written to
// version.json next to it; a running app compares the two to learn that a newer build is waiting.
// publish.config.json holds the oldest installed shell (Electron / Android launcher) this build
// still works with, and where to download a newer one.
const gitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
};

// The portal's DejaVuAmp / FalseHorizon files are plain scripts that set a window global in a
// browser and `module.exports` under Node (so their tests can run). The bundler would pick the Node
// path and the window global would never appear, so this takes that branch out while the files are
// bundled; the files themselves are not touched.
const browserGlobals = () => ({
  name: 'totr-browser-globals',
  enforce: 'pre',
  transform(code, id) {
    if (!/vendor\/js\/(dejavuamp|falsehorizon)[^/]*\.js$/.test(id.split('?')[0])) return null;
    return code
      .replace(/typeof module !== 'undefined' && module\.exports \? module\.exports :/g, '')
      .replace(/typeof module !== 'undefined' && module\.exports/g, 'false')
      .replace(/typeof require !== 'undefined'/g, 'false');
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // set TOTR_SERVER (env or .env, not committed) to the real one
  const target = process.env.TOTR_SERVER || env.TOTR_SERVER || 'http://localhost:8080';
  const buildId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${gitHash()}`;
  const publish = !!process.env.PUBLISH_WEB;
  const publishDir = process.env.TOTR_APP_OUT || env.TOTR_APP_OUT;
  if (publish && !publishDir)
    throw new Error(
      'publish:web needs TOTR_APP_OUT (env or .env.local): the folder the server serves the app from, for example ../../TOTRsrv/static/app',
    );
  const outDir = publish ? path.resolve(__dirname, publishDir) : 'dist';
  const shell = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../shared/publish.config.json'), 'utf8'),
  );
  return {
    // relative URLs, so the same build works from the server's /app/, from Electron and from
    // Capacitor
    base: './',
    plugins: [
      browserGlobals(),
      react(),
      {
        name: 'totr-version',
        apply: 'build',
        closeBundle() {
          fs.writeFileSync(
            path.join(outDir, 'version.json'),
            JSON.stringify({ buildId, ...shell }, null, 2) + '\n',
          );
        },
      },
    ],
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    build: { outDir, emptyOutDir: true },
    server: {
      // DejaVuAmp and FalseHorizon are imported from vendor/js (copied by tools/sync-vendor.cjs)
      fs: { allow: [__dirname] },
      proxy: {
        '/static': { target, changeOrigin: true }, // the fonts (static/fonts/) come from the server
        '/api': {
          target,
          changeOrigin: true,
          configure: proxy =>
            proxy.on('proxyReq', req => {
              if (req.getHeader('origin')) req.setHeader('origin', target);
            }),
        },
      },
    },
  };
});
