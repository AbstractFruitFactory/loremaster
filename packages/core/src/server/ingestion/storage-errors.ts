export class ImmutableIngestionConflictError extends Error {
	constructor() {
		super('Immutable ingestion data differs')
		this.name = 'ImmutableIngestionConflictError'
	}
}

export const isImmutableIngestionConflict = (
	cause: unknown
): cause is ImmutableIngestionConflictError =>
	cause instanceof ImmutableIngestionConflictError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'ImmutableIngestionConflictError')

export class CommitStartedIngestionDiscardError extends Error {
	constructor() {
		super('An ingestion cannot be discarded after its commit has started')
		this.name = 'CommitStartedIngestionDiscardError'
	}
}

export const isCommitStartedIngestionDiscard = (
	cause: unknown
): cause is CommitStartedIngestionDiscardError =>
	cause instanceof CommitStartedIngestionDiscardError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CommitStartedIngestionDiscardError')

export class CampaignImportSourceIntegrityError extends Error {
	constructor() {
		super('Campaign import source metadata does not match its content')
		this.name = 'CampaignImportSourceIntegrityError'
	}
}

export class CampaignImportReviewRevisionConflictError extends Error {
	constructor(
		readonly expectedRevision: number,
		readonly actualRevision: number
	) {
		super('Campaign import review state revision differs')
		this.name = 'CampaignImportReviewRevisionConflictError'
	}
}

export const isCampaignImportReviewRevisionConflict = (
	cause: unknown
): cause is CampaignImportReviewRevisionConflictError =>
	cause instanceof CampaignImportReviewRevisionConflictError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewRevisionConflictError')

export class CampaignImportReviewCommitConflictError extends Error {
	constructor(readonly reason: 'staleRevision' | 'selectionMismatch') {
		super('Campaign import commit does not match the acknowledged review state')
		this.name = 'CampaignImportReviewCommitConflictError'
	}
}

export const isCampaignImportReviewCommitConflict = (
	cause: unknown
): cause is CampaignImportReviewCommitConflictError =>
	cause instanceof CampaignImportReviewCommitConflictError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewCommitConflictError')

export class CampaignImportReviewLockedError extends Error {
	constructor() {
		super('Campaign import review state cannot change after commit starts')
		this.name = 'CampaignImportReviewLockedError'
	}
}

export const isCampaignImportReviewLocked = (
	cause: unknown
): cause is CampaignImportReviewLockedError =>
	cause instanceof CampaignImportReviewLockedError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewLockedError')

export class CampaignImportReviewLockBusyError extends Error {
	constructor() {
		super('Campaign import review state is being changed by another process')
		this.name = 'CampaignImportReviewLockBusyError'
	}
}

export const isCampaignImportReviewLockBusy = (
	cause: unknown
): cause is CampaignImportReviewLockBusyError =>
	cause instanceof CampaignImportReviewLockBusyError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportReviewLockBusyError')

export class CampaignImportOperationLeaseBusyError extends Error {
	constructor() {
		super('Another campaign import operation is already in progress')
		this.name = 'CampaignImportOperationLeaseBusyError'
	}
}

export const isCampaignImportOperationLeaseBusy = (
	cause: unknown
): cause is CampaignImportOperationLeaseBusyError =>
	cause instanceof CampaignImportOperationLeaseBusyError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportOperationLeaseBusyError')

export class CampaignImportNotFoundError extends Error {
	constructor() {
		super('Campaign import was not found')
		this.name = 'CampaignImportNotFoundError'
	}
}

export const isCampaignImportNotFound = (cause: unknown): cause is CampaignImportNotFoundError =>
	cause instanceof CampaignImportNotFoundError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportNotFoundError')

export class IncompleteCampaignImportCleanupError extends Error {
	constructor() {
		super('A campaign import cannot be cleaned up before it is complete')
		this.name = 'IncompleteCampaignImportCleanupError'
	}
}

export const isIncompleteCampaignImportCleanup = (
	cause: unknown
): cause is IncompleteCampaignImportCleanupError =>
	cause instanceof IncompleteCampaignImportCleanupError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'IncompleteCampaignImportCleanupError')

export class CampaignImportPermanenceError extends Error {
	constructor(readonly details: Record<string, unknown>) {
		super('Campaign import evidence is not permanently retained')
		this.name = 'CampaignImportPermanenceError'
	}
}

export const isCampaignImportPermanenceError = (
	cause: unknown
): cause is CampaignImportPermanenceError =>
	cause instanceof CampaignImportPermanenceError ||
	(typeof cause === 'object' &&
		cause !== null &&
		'name' in cause &&
		cause.name === 'CampaignImportPermanenceError')
