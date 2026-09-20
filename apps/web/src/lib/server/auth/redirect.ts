export const safeRedirectPath = (value: string | null) =>
	value?.startsWith('/') && !value.startsWith('//') ? value : '/'
