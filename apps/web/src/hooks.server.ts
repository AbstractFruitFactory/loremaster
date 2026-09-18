import { disposeCoreRuntime } from '#lib/server/app.js'
import { disposeDbosClient } from '#lib/server/dbos/client.js'

let registered = false

export const init = () => {
	if (registered) return
	registered = true
	process.once('sveltekit:shutdown', async () => {
		await disposeDbosClient()
		await disposeCoreRuntime()
	})
}
