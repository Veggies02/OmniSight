import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env variables from root (non-VITE_ variables are available only server-side here in Vite config)
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.BACKEND_PROXY_TARGET || env.BACKEND_URL || 'http://127.0.0.1:8000'
  const operatorToken = env.OPERATOR_TOKEN || env.OMNISIGHT_OPERATOR_TOKEN || ''

  return {
    plugins: [react()],
    server: {
      watch: {
        ignored: ['**/artifacts/**', '**/test-results/**', '**/public/evidence/**'],
      },
      proxy: {
        '/jobs': {
          target: backendTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (operatorToken && !proxyReq.getHeader('x-operator-token')) {
                proxyReq.setHeader('x-operator-token', operatorToken)
              }
            })
          },
        },
        '/health': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  }
})

