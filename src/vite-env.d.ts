/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DERIBIT_API_KEY?: string;
  readonly VITE_DERIBIT_API_SECRET?: string;
  readonly VITE_BYBIT_API_KEY?: string;
  readonly VITE_BYBIT_API_SECRET?: string;
  // Hyperliquid 钱包地址（只读，可逗号分隔多个）
  readonly VITE_HYPERLIQUID_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
