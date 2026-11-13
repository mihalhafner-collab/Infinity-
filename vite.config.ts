import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function disableHmrWebSocketPlugin(): Plugin {
  let hmrDisabled = false;
  return {
    name: 'disable-hmr-websocket-when-disabled',
    enforce: 'post',
    configResolved(resolved) {
      hmrDisabled =
        process.env.DISABLE_HMR === 'true' ||
        resolved.server.hmr === false ||
        resolved.server.ws === false;
    },
    transform(code, id) {
      if (!hmrDisabled || !id.includes('vite/dist/client/client.mjs')) {
        return null;
      }
      return {
        code: code
          .replace('console.debug("[vite] connecting...");', '/* HMR disabled */')
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR WebSocket disabled */'
          )
          .replace(
            'setupForwardConsoleHandler(transport, forwardConsole);',
            '/* Console forward disabled */'
          ),
        map: null,
      };
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      disableHmrWebSocketPlugin(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'favicon-64x64.png', 'apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'Infinity',
          short_name: 'Infinity',
          description: 'Mobiles Servicemanagement für Haus- und Gartenpflege, optimiert für Google Pixel 10 Pro.',
          theme_color: '#02061A',
          background_color: '#02061A',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: [
            '**/Screenshot_*.png',
            '**/file_000000003a1482108141859b06b3934c_*.png',
            '**/Eisbaer-Konzept-*.pdf',
          ],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//, /^\/mcp/, /^\/oauth\//, /^\/android-connect/, /^\/__\//],
          runtimeCaching: [
            {
              urlPattern: /^https?:\/\/[^/]+\/__\/(auth|firebase)\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase')) return 'vendor-firebase';
            if (id.includes('node_modules/jspdf')) return 'vendor-pdf';
            if (id.includes('node_modules/motion')) return 'vendor-motion';
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
            if (id.includes('node_modules/react')) return 'vendor-react';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.dirname(fileURLToPath(import.meta.url)),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
