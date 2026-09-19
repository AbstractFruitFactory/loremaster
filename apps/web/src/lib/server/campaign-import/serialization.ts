const campaignImportOperationLocks = new Map<string, Promise<void>>()

const campaignImportOperationKey = (campaignId: string, ingestionId: string) =>
	`${campaignId}\0${ingestionId}`

export const withCampaignImportOrchestrationLock = async <Value>(
	campaignId: string,
	ingestionId: string,
	operation: () => Promise<Value>
): Promise<Value> => {
	const key = campaignImportOperationKey(campaignId, ingestionId)
	const previous = campaignImportOperationLocks.get(key) ?? Promise.resolve()
	let release!: () => void
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const current = previous.catch(() => undefined).then(() => gate)
	campaignImportOperationLocks.set(key, current)
	await previous.catch(() => undefined)
	try {
		return await operation()
	} finally {
		release()
		if (campaignImportOperationLocks.get(key) === current) {
			campaignImportOperationLocks.delete(key)
		}
	}
}

export const withCampaignImportOperationLease = async <Lease, Value>(
	{
		acquire,
		release
	}: {
		acquire: () => Promise<Lease>
		release: (lease: Lease) => Promise<void>
	},
	operation: () => Promise<Value>
): Promise<Value> => {
	const lease = await acquire()
	try {
		return await operation()
	} finally {
		await release(lease)
	}
}
