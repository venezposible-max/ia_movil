import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Cargar variables de entorno (por si estamos en local)
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react()],
        define: {
            'import.meta.env.VITE_GROQ_API_KEY': JSON.stringify(process.env.VITE_GROQ_API_KEY || env.VITE_GROQ_API_KEY),
            'import.meta.env.VITE_SERPER_API_KEY': JSON.stringify(process.env.VITE_SERPER_API_KEY || env.VITE_SERPER_API_KEY),
        }
    }
})
