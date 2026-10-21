import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { validatePublicConfig } from './src/lib/config';
import { version } from './package.json';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // No automatic VITE_* exposure: only validated public fields reach the bundle.
  envPrefix: [],
  define: {
    __PUBLIC_CONFIG__: JSON.stringify(validatePublicConfig(loadEnv(mode, process.cwd(), 'VITE_SUPABASE_'))),
    __APP_VERSION__: JSON.stringify(`${version}+${new Date().toISOString()}`),
  },
}));
