import { defineParams } from '@sveltejs/kit/params'
import { isDocumentType } from '#lib/document.js'

export const params = defineParams({
	documentType: (param) => (isDocumentType(param) ? param : undefined)
})
