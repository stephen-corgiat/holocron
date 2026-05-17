import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite attaches its own `error` listener inside `proxy.on('proxyReqWs', ...)`
// after the user's `configure` callback runs, so trying to swallow the event
// at the socket level is racy. Filter at the logger instead — vite passes the
// original `error` along in the log options, which lets us drop just the
// EPIPE / ECONNRESET writes that happen when the browser tears down the
// socket faster than the upstream can finish writing.
const logger = createLogger();
const originalError = logger.error;
logger.error = (msg, options) => {
  const err = options?.error as NodeJS.ErrnoException | undefined;
  if (err && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) return;
  originalError(msg, options);
};

export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Match prod nginx: strip the /api prefix before forwarding.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
