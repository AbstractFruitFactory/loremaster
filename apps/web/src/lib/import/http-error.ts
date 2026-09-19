export const httpStatus = (error: unknown) => {
	if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
	return typeof error.status === 'number' ? error.status : undefined
}

export const isUncertainTransportError = (error: unknown) => {
	const status = httpStatus(error)
	return status === undefined || status >= 500
}
