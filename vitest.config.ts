import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], define: { __APP_VERSION__: JSON.stringify('test'), __PUBLIC_CONFIG__: JSON.stringify({ status: 'unavailable', fields: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] }) }, test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['src/test-setup.ts'] } });
