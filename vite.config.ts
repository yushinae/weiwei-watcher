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
      // HMR is disabled in weiwei.watcher via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
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
        '/bybit-api': {
          target: 'https://api.bybit.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/bybit-api/, ''),
        },
        // Binance 公开行情端点（klines）—— data-api.binance.vision 无需 key、不受交易 API 地域限制
        '/binance-api': {
          target: 'https://data-api.binance.vision',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/binance-api/, ''),
        },
        // Hyperliquid 链上账户读取（info 端点，按钱包地址只读，无需密钥）
        '/hyperliquid-api': {
          target: 'https://api.hyperliquid.xyz',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/hyperliquid-api/, ''),
        },
        '/deribit-ws': {
          target: 'wss://www.deribit.com',
          ws: true,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/deribit-ws/, '/ws/api/v2'),
        },
        // Public Bybit OPTION ticker stream (no auth) — routed for dev/prod consistency.
        '/bybit-ws-option': {
          target: 'wss://stream.bybit.com',
          ws: true,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/bybit-ws-option/, '/v5/public/option'),
        },
      },
    },
  };
});
