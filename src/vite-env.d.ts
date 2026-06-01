/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DERIBIT_API_KEY?: string;
  readonly VITE_DERIBIT_API_SECRET?: string;
  readonly VITE_BYBIT_API_KEY?: string;
  readonly VITE_BYBIT_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
