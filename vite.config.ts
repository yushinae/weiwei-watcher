import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// lightweight-charts 打的是 node_modules 内补丁，但 Vite 预打包 URL 的 ?v= 哈希只看
// lockfile+配置、不看文件内容，且响应是 immutable 强缓存——补丁内容变了浏览器也永远
// 拿不到新代码。把补丁脚本内容哈希掺进 optimizeDeps 配置哈希，补丁一变 URL 必变。
const lwcPatchRev = (() => {
  try {
    return createHash('md5')
      .update(readFileSync(path.resolve(__dirname, 'scripts/patch-lightweight-charts.mjs')))
      .digest('hex')
      .slice(0, 8);
  } catch {
    return 'none';
  }
})();

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      esbuildOptions: {
        define: {__LWC_PATCH_REV__: JSON.stringify(lwcPatchRev)},
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // 函数形式：只把「实际被 import 的模块」归组。对象形式会把整个包
          // 入口强制打进 chunk —— echarts 全量 1.1MB 就是这么进来的。
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(echarts|zrender|echarts-for-react)\//.test(id)) return 'vendor-echarts';
            if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'vendor-motion';
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react';
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in weiwei.watcher via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/server/data/**', '**/.wrangler/**'],
      },
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
        '/binance-spot-api': {
          target: 'https://api.binance.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/binance-spot-api/, ''),
        },
        '/binance-fapi': {
          target: 'https://fapi.binance.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/binance-fapi/, ''),
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
