import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'
import { DATABASE_URL } from '$app/env/private'

const client = neon(DATABASE_URL)

export const db = drizzle(client, { schema })
