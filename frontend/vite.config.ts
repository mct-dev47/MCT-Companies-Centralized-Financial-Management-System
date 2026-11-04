import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Build-time security guard that scans all generated client chunks
 * to ensure no backend secrets or sensitive credential patterns are bundled.
 */
function secretLeakGuardPlugin(): Plugin {
  const FORBIDDEN_SECRET_PATTERNS = [
    /xkeysib-[a-zA-Z0-9_-]{20,}/i,
    /re_[a-zA-Z0-9_-]{20,}/i,
    /SUPABASE_SERVICE_ROLE_KEY/i,
    /BREVO_API_KEY/i,
  ]

  return {
    name: 'secret-leak-guard',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && typeof chunk.code === 'string') {
          for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
            if (pattern.test(chunk.code)) {
              this.error(
                `[SECURITY ALERT] Server secret pattern (${pattern}) detected in emitted client asset: ${fileName}!`
              )
            }
          }
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), secretLeakGuardPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'lucide-react',
      'clsx',
      'tailwind-merge',
      'recharts',
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-recharts'
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react'
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons'
            }
          }
        },
      },
    },
  },
})
