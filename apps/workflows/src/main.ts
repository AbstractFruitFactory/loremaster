import { DBOS } from '@dbos-inc/dbos-sdk'

const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL ?? process.env.DATABASE_URL

if (!systemDatabaseUrl) {
	throw new Error('DBOS_SYSTEM_DATABASE_URL or DATABASE_URL is not set')
}

DBOS.setConfig({
	name: 'loremaster-workflows',
	applicationVersion: '0.0.1',
	systemDatabaseUrl,
	systemDatabaseSchemaName: process.env.DBOS_SYSTEM_DATABASE_SCHEMA ?? 'dbos',
	runMigrations: process.env.DBOS_RUN_MIGRATIONS !== 'false'
})

let isShuttingDown = false

const shutdown = async (signal: NodeJS.Signals) => {
	if (isShuttingDown) return
	isShuttingDown = true

	DBOS.logger.info(`Received ${signal}; shutting down`)
	await DBOS.shutdown()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

DBOS.launch().catch((error: unknown) => {
	console.error(error)
	process.exitCode = 1
})
