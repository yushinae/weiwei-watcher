import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // 重型第三方库单独成包，不阻塞主包解析
            'vendor-echarts':  ['echarts', 'echarts-for-react'],
            'vendor-motion':   ['motion'],
            'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET ?? 'http://localhost:8787',
          changeOrigin: true,
        },
        '/ws': {
          target: (env.API_PROXY_TARGET ?? 'http://localhost:8787').replace('http', 'ws'),
          ws: true,
          changeOrigin: true,
        },
        '/deribit-ws': {
          target: 'wss://www.deribit.com',
          ws: true,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/deribit-ws/, '/ws/api/v2'),
        },
      },
    },
  };
});
