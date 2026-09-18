import { DBOS } from '@dbos-inc/dbos-sdk'
import {
	ANALYSIS_QUEUE_NAME,
	COMMIT_QUEUE_NAME,
	WORKFLOW_APPLICATION_NAME,
	WORKFLOW_SYSTEM_SCHEMA
} from '@loremaster/core/workflows/contracts'
import { runtime } from './runtime.js'

const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL ?? process.env.DATABASE_URL

if (!systemDatabaseUrl) {
	throw new Error('DBOS_SYSTEM_DATABASE_URL or DATABASE_URL is not set')
}

DBOS.setConfig({
	name: WORKFLOW_APPLICATION_NAME,
	...(process.env.DBOS_APPLICATION_VERSION
		? { applicationVersion: process.env.DBOS_APPLICATION_VERSION }
		: {}),
	systemDatabaseUrl,
	systemDatabaseSchemaName: process.env.DBOS_SYSTEM_DATABASE_SCHEMA ?? WORKFLOW_SYSTEM_SCHEMA,
	runMigrations: process.env.DBOS_RUN_MIGRATIONS !== 'false'
})

let isShuttingDown = false

const shutdown = async (signal: NodeJS.Signals) => {
	if (isShuttingDown) return
	isShuttingDown = true

	DBOS.logger.info(`Received ${signal}; shutting down`)
	await DBOS.shutdown()
	await runtime.dispose()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

const main = async () => {
	await import('./workflows.js')
	await DBOS.launch()
	await Promise.all([
		DBOS.registerQueue(ANALYSIS_QUEUE_NAME, { globalConcurrency: 2 }),
		DBOS.registerQueue(COMMIT_QUEUE_NAME, { globalConcurrency: 2 })
	])
}

main().catch(async (error: unknown) => {
	console.error(error)
	await DBOS.shutdown().catch(() => undefined)
	await runtime.dispose().catch(() => undefined)
	process.exitCode = 1
})
