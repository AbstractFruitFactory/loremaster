export const createCampaignImportLifecyclePoller = ({
	refresh,
	shouldContinue,
	afterRefresh,
	initialDelay = 1_500,
	maximumDelay = 6_000
}: {
	refresh: () => Promise<unknown>
	shouldContinue: () => boolean
	afterRefresh?: () => Promise<void> | void
	initialDelay?: number
	maximumDelay?: number
}) => {
	let timer: ReturnType<typeof setTimeout> | undefined
	let delay = initialDelay
	let disposed = false
	let activeRefresh: Promise<void> | undefined

	const schedule = () => {
		if (disposed || timer || !shouldContinue()) return
		timer = setTimeout(() => {
			timer = undefined
			void refreshNow()
		}, delay)
	}

	const refreshOnce = async () => {
		let failed = false
		try {
			await refresh()
			await afterRefresh?.()
		} catch {
			failed = true
		}
		delay = failed ? Math.min(Math.round(delay * 1.5), maximumDelay) : initialDelay
		schedule()
	}

	const refreshNow = async () => {
		if (disposed) return
		if (!activeRefresh) {
			activeRefresh = refreshOnce().finally(() => {
				activeRefresh = undefined
			})
		}
		await activeRefresh
	}

	return {
		start: () => {
			delay = initialDelay
			schedule()
		},
		refreshNow,
		dispose: () => {
			disposed = true
			if (timer) clearTimeout(timer)
			timer = undefined
		}
	}
}
