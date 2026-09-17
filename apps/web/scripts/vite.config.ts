import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
	resolve: {
		alias: {
			'$app/env/private': path.join(root, 'scripts/stubs/env-private.ts'),
			'#lib': path.join(root, 'src/lib'),
			'#lib/*': path.join(root, 'src/lib/*')
		}
	},
	ssr: {
		noExternal: true
	}
})
