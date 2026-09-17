import { defineParams } from '@sveltejs/kit/params'
import { isDocumentType } from './lib/document.ts'

export const params = defineParams({
	documentType: (param) => (isDocumentType(param) ? param : undefined)
})
