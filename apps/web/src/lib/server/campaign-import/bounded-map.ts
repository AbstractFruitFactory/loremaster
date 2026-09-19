export const mapWithConcurrency = async <Input, Output>(
	values: readonly Input[],
	concurrency: number,
	mapper: (value: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError('Concurrency must be a positive integer')
	}

	const results = new Array<Output>(values.length)
	let nextIndex = 0
	const workerCount = Math.min(concurrency, values.length)
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < values.length) {
				const index = nextIndex
				nextIndex += 1
				results[index] = await mapper(values[index], index)
			}
		})
	)
	return results
}
