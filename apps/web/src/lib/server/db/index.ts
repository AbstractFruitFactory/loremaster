import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { DATABASE_URL, VERCEL } from '$app/env/private'

const client = postgres(DATABASE_URL, { max: VERCEL === '1' ? 1 : 10 })

export const db = drizzle(client, { schema })

export const closeDb = () => client.end()
