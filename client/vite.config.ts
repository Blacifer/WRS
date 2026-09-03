import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'WRS Raipur Quality Control',
        short_name: 'WRS QC',
        description: 'Indian Railways Bogie & Wagon Quality Control System',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        /*
         * Smart Vision is opt-in, so its code is not forced onto every tablet.
         *
         * TensorFlow.js is about 1.9 MB of JavaScript and it is only reachable
         * from one screen. Precaching it would more than double what an
         * inspector downloads in the background to make a feature their role
         * rarely opens available offline. It is fetched when the camera is
         * started and cached by the browser from then on.
         *
         * The 19 MB of model weights under /models are already outside the
         * glob above, having neither a listed extension nor any extension at
         * all — this keeps the code consistent with the weights it needs.
         */
        globIgnores: ['**/tensorflow-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,

    /*
     * Bind every interface, not just loopback.
     *
     * Without this the dev server answers only to localhost, so a tablet on
     * the shop wifi cannot reach it at all — which is most of the point of
     * testing on a tablet.
     */
    host: true,

    /*
     * Hosts the dev server will answer to.
     *
     * Vite 5 and later reject any request whose Host header it does not
     * recognise, as a defence against DNS rebinding. That is the right
     * default, and it means a Cloudflare tunnel — which arrives with a
     * Host of something.trycloudflare.com — gets "Blocked request. This host
     * is not allowed" rather than the app.
     *
     * A tunnel is worth supporting because it is the only straightforward way
     * to get HTTPS during testing, and the camera features (wagon number
     * reading, caliper photos, QR scanning) are unavailable without it: a
     * browser will not grant camera access to a plain-HTTP page unless it is
     * localhost.
     *
     * Listed by suffix rather than opened to everything, so this stays a
     * decision about which tunnels are expected rather than a blanket
     * disabling of the check. LAN addresses are covered by `host` above.
     */
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io', 'localhost'],

    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /*
         * Named rather than hash-only chunks for the two heavy libraries, so
         * the service worker can be told to skip TensorFlow by name. Vite
         * would otherwise emit them as index-<hash>.js, which cannot be
         * matched by a glob without also matching the entry chunk.
         */
        manualChunks(id: string) {
          if (id.includes('@tensorflow')) return 'tensorflow';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
          return undefined;
        }
      }
    }
  }
});
