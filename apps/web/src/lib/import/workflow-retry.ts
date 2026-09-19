export const createWorkflowRetryAction = ({
	canRetry,
	invoke,
	onWaiting,
	refresh,
	setError,
	failureMessage
}: {
	canRetry: () => boolean
	invoke: () => Promise<unknown>
	onWaiting: (waiting: boolean) => void
	refresh: () => Promise<void>
	setError: (message: string) => void
	failureMessage: string
}) => {
	let pending = false
	return async () => {
		if (pending || !canRetry()) return
		pending = true
		setError('')
		try {
			await invoke()
			onWaiting(true)
			await refresh()
		} catch {
			onWaiting(false)
			setError(failureMessage)
		} finally {
			pending = false
		}
	}
}
