<script lang="ts">
	import Icon from '@iconify/svelte'
	import { goto } from '$app/navigation'
	import type {
		WorkflowLifecycle,
		WorkflowLifecycleStage
	} from '@loremaster/core/workflows/contracts'
	import type { PageProps } from './$types'
	import { buildSessionRecap } from '#lib/ingestion.js'
	import { documentTypeMetadata } from '#lib/document-metadata.js'
	import type { DocumentType } from '#lib/document.js'
	import type {
		SessionChronologyCoverageProposal,
		SessionChronologyProposal,
		SessionIngestionResult,
		SessionProposal,
		SessionProposalResolution
	} from '#lib/server/ingestion/types.js'
	import {
		commitSessionIngestion,
		getSessionAnalysisStatus,
		getSessionCommitStatus,
		listDocuments,
		listUncommittedSessionIngestions,
		retrySessionAnalysis,
		retrySessionCommit
	} from '../../../data.remote'

	let { params }: PageProps = $props()

	const statusInput = $derived({
		campaignId: params.campaignId,
		ingestionId: params.ingestionId
	})
	const analysisStatus = $derived(getSessionAnalysisStatus(statusInput))
	const commitStatus = $derived(getSessionCommitStatus(statusInput))
	const draft = $derived(
		analysisStatus.current?.lifecycle === 'succeeded' ? analysisStatus.current.result : undefined
	)

	type ReviewDocumentType = Exclude<DocumentType, 'session'>
	type ReviewView = 'summary' | 'attention' | ReviewDocumentType
	type ReviewDecision = 'approved' | 'rejected'
	type ReviewStatus = ReviewDecision | 'pending'

	const reviewTypes: ReviewDocumentType[] = [
		'npc',
		'player',
		'location',
		'item',
		'event',
		'worldbuilding'
	]
	const singularTypeLabel: Record<ReviewDocumentType, string> = {
		player: 'Player',
		npc: 'NPC',
		location: 'Location',
		item: 'Item',
		worldbuilding: 'Worldbuilding entry',
		event: 'Event'
	}
	const stageLabels: Record<WorkflowLifecycleStage, string> = {
		queued: 'Waiting for an analysis worker',
		'loading-transcript-data': 'Loading the session transcript',
		'analyzing-transcript': 'Finding campaign changes',
		'auditing-events': 'Checking session events',
		'resolving-entities': 'Matching campaign entries',
		'inferring-chronology': 'Ordering session events',
		'persisting-draft': 'Preparing your review',
		'planning-commit': 'Preparing campaign updates',
		'applying-mutations': 'Updating campaign documents',
		completed: 'Finishing up'
	}
	const terminalLifecycles = new Set<WorkflowLifecycle>(['succeeded', 'failed', 'cancelled'])
	const initialPollDelay = 1_500
	const maximumPollDelay = 6_000

	let activeView = $state<ReviewView>('summary')
	let decisions = $state<Record<string, ReviewDecision>>({})
	let chronologyDecisions = $state<Record<string, ReviewDecision>>({})
	let resolutions = $state<Record<string, string>>({})
	let analysisRetryPollingEnabled = $state(false)
	let analysisRetryPending = $state(false)
	let analysisRetryError = $state('')
	let commitRequested = $state(false)
	let commitPollingEnabled = $state(false)
	let commitRetryPollingEnabled = $state(false)
	let commitStartPending = $state(false)
	let commitStartError = $state('')
	let commitConflict = $state(false)
	let commitRetryPending = $state(false)
	let commitRetryError = $state('')
	let navigationPending = $state(false)
	let navigationError = $state('')
	let pendingCommitResult = $state.raw<SessionIngestionResult>()
	let commitNavigationStarted = false

	const analysisLifecycle = $derived(analysisStatus.current?.lifecycle)
	const analysisProgress = $derived(analysisStatus.current?.progress)
	const commitLifecycle = $derived(commitStatus.current?.lifecycle)
	const commitProgress = $derived(commitStatus.current?.progress)
	const commitLocked = $derived(commitConflict || commitRequested || Boolean(commitLifecycle))
	const commitTransportError = $derived(
		commitStatus.error?.status === 404 ? undefined : commitStatus.error
	)

	const isTerminal = (lifecycle: WorkflowLifecycle | undefined) =>
		lifecycle ? terminalLifecycles.has(lifecycle) : false

	const nextPollDelay = (delay: number, failed: boolean) =>
		failed ? Math.min(Math.round(delay * 1.5), maximumPollDelay) : initialPollDelay

	const httpStatus = (error: unknown) => {
		if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
		return typeof error.status === 'number' ? error.status : undefined
	}

	const isUncertainTransportError = (error: unknown) => {
		const status = httpStatus(error)
		return status === undefined || status >= 500
	}

	const completeCommit = async (result: SessionIngestionResult) => {
		if (commitNavigationStarted) return
		pendingCommitResult = result
		commitNavigationStarted = true
		navigationPending = true
		navigationError = ''
		try {
			await Promise.all([
				listDocuments(params.campaignId).refresh(),
				listUncommittedSessionIngestions(params.campaignId).refresh()
			])
		} catch {}
		try {
			await goto(`/campaigns/${params.campaignId}/session/${result.sessionDocumentId}`)
		} catch {
			commitNavigationStarted = false
			navigationError =
				'The session was saved, but its page could not be opened. Try opening the saved session again.'
		} finally {
			navigationPending = false
		}
	}

	$effect(() => {
		const query = analysisStatus
		const observedLifecycle = analysisLifecycle
		const retryPollingEnabled = analysisRetryPollingEnabled
		let disposed = false
		let timer: ReturnType<typeof setTimeout> | undefined
		let delay = initialPollDelay

		const schedule = () => {
			timer = setTimeout(poll, delay)
		}

		const poll = async () => {
			let failed = false
			try {
				await query.refresh()
			} catch {
				failed = true
			}
			const lifecycle = query.current?.lifecycle
			const waitingForRetryStart = retryPollingEnabled && lifecycle === 'not-started'
			delay = nextPollDelay(delay, failed || waitingForRetryStart)
			if (disposed || isTerminal(lifecycle)) return
			if (lifecycle === 'not-started' && !retryPollingEnabled) return
			schedule()
		}

		const start = async () => {
			try {
				await query
			} catch {}
			const lifecycle = query.current?.lifecycle ?? observedLifecycle
			if (disposed || isTerminal(lifecycle)) return
			if (lifecycle === 'not-started' && !retryPollingEnabled) return
			schedule()
		}

		void start()

		return () => {
			disposed = true
			if (timer) clearTimeout(timer)
		}
	})

	$effect(() => {
		const query = commitStatus
		const pollingEnabled = commitPollingEnabled
		const retryPollingEnabled = commitRetryPollingEnabled
		const observedLifecycle = commitLifecycle
		const conflicted = commitConflict
		const awaitingStartDisposition = commitRequested && !commitPollingEnabled
		let disposed = false
		let timer: ReturnType<typeof setTimeout> | undefined
		let delay = initialPollDelay

		const finishIfTerminal = async () => {
			const status = query.current
			if (!status || !isTerminal(status.lifecycle)) return false
			if (status.lifecycle === 'succeeded' && status.result) {
				await completeCommit(status.result)
			}
			return true
		}

		const schedule = () => {
			timer = setTimeout(poll, delay)
		}

		const poll = async () => {
			let failed = false
			try {
				await query.refresh()
			} catch {
				failed = true
			}
			const lifecycle = query.current?.lifecycle
			const waitingForRetryStart = retryPollingEnabled && lifecycle === 'not-started'
			delay = nextPollDelay(delay, failed || waitingForRetryStart)
			if (disposed || (await finishIfTerminal())) return
			if (lifecycle === 'not-started' && !retryPollingEnabled) return
			schedule()
		}

		const start = async () => {
			try {
				await query
			} catch {}
			if (disposed || conflicted || awaitingStartDisposition || (await finishIfTerminal())) return
			const lifecycle = query.current?.lifecycle ?? observedLifecycle
			if (lifecycle === 'not-started' && !retryPollingEnabled) return
			if (
				!pollingEnabled &&
				!retryPollingEnabled &&
				lifecycle !== 'queued' &&
				lifecycle !== 'running'
			)
				return
			schedule()
		}

		void start()

		return () => {
			disposed = true
			if (timer) clearTimeout(timer)
		}
	})

	const retryAnalysis = async () => {
		if (analysisRetryPending || !analysisStatus.current?.retryable) return
		analysisRetryPending = true
		analysisRetryError = ''
		try {
			await retrySessionAnalysis(statusInput)
		} catch {
			analysisRetryError = 'The analysis could not be restarted. Try again.'
			analysisRetryPending = false
			return
		}
		try {
			await analysisStatus.refresh()
		} catch {}
		analysisRetryPollingEnabled = true
		analysisRetryPending = false
	}

	const retryCommit = async () => {
		if (commitRetryPending || !commitStatus.current?.retryable) return
		commitRetryPending = true
		commitRetryError = ''
		try {
			await retrySessionCommit(statusInput)
		} catch {
			commitRetryError = 'The save could not be restarted. Try again.'
			commitRetryPending = false
			return
		}
		try {
			await commitStatus.refresh()
		} catch {}
		commitRetryPollingEnabled = true
		commitStartError = ''
		commitRetryPending = false
	}

	const retryNavigation = () => {
		if (!pendingCommitResult || navigationPending) return
		void completeCommit(pendingCommitResult)
	}

	const normalizeComparable = (value: string) =>
		value
			.trim()
			.toLocaleLowerCase()
			.replace(/^#+\s*/u, '')
			.replace(/[.!?:;]+$/u, '')
			.replace(/\s+/gu, ' ')

	const hasDeferredIdentityDecision = (
		proposal: SessionProposal
	): proposal is SessionProposal & {
		operation: 'create-entity' | 'create-event'
		match: Extract<SessionProposal['match'], { kind: 'unresolved' }>
	} =>
		(proposal.operation === 'create-entity' || proposal.operation === 'create-event') &&
		proposal.match.kind === 'unresolved' &&
		proposal.match.candidates.length > 0

	const isOtherDetail = (proposal: SessionProposal) =>
		proposal.operation === 'mention-only' || proposal.operation === 'record-only'

	const needsAttention = (proposal: SessionProposal) =>
		proposal.documentType !== 'session' &&
		!isOtherDetail(proposal) &&
		(hasDeferredIdentityDecision(proposal) ||
			proposal.certainty === 'inferred' ||
			proposal.resolutionMethod === 'model')

	const reviewStatus = (proposal: SessionProposal): ReviewStatus => {
		const decision = decisions[proposal.proposalId]
		if (decision) return decision
		if (proposal.documentType === 'session') return 'approved'
		if (proposal.operation === 'mention-only') return 'rejected'
		if (needsAttention(proposal)) return 'pending'
		return proposal.selected ? 'approved' : 'rejected'
	}

	const selected = (proposal: SessionProposal) => {
		if (proposal.documentType === 'session') return true
		if (proposal.operation === 'mention-only') return false
		if (hasDeferredIdentityDecision(proposal) && !resolutions[proposal.proposalId]) return false
		return reviewStatus(proposal) === 'approved'
	}

	const canApprove = (proposal: SessionProposal) =>
		!hasDeferredIdentityDecision(proposal) || Boolean(resolutions[proposal.proposalId])

	const approveProposal = (proposal: SessionProposal) => {
		if (commitLocked || !canApprove(proposal)) return
		decisions[proposal.proposalId] = 'approved'
	}

	const rejectProposal = (proposal: SessionProposal) => {
		if (commitLocked) return
		decisions[proposal.proposalId] = 'rejected'
	}

	const chooseResolution = (proposal: SessionProposal, value: string) => {
		if (commitLocked) return
		resolutions[proposal.proposalId] = value
		delete decisions[proposal.proposalId]
	}

	const resolutionFor = (proposal: SessionProposal): SessionProposalResolution | undefined => {
		const value = resolutions[proposal.proposalId]
		if (!value) return undefined
		return value === 'create'
			? { proposalId: proposal.proposalId, kind: 'create' }
			: { proposalId: proposal.proposalId, kind: 'existing', documentId: value }
	}

	const canonProposals = () =>
		draft?.proposals.filter(
			(proposal) => proposal.documentType !== 'session' && !isOtherDetail(proposal)
		) ?? []

	const attentionProposals = () => canonProposals().filter(needsAttention)
	const eventProposalById = () =>
		new Map(
			(draft?.proposals ?? [])
				.filter(({ operation }) => operation === 'create-event')
				.map((proposal) => [proposal.proposalId, proposal])
		)

	const chronologyStatus = (relation: SessionChronologyProposal): ReviewStatus => {
		const decision = chronologyDecisions[relation.chronologyId]
		if (decision) return decision
		if (relation.certainty === 'inferred') return 'pending'
		return relation.selected ? 'approved' : 'rejected'
	}

	const attentionChronology = () =>
		(draft?.chronology ?? []).filter(
			(relation) => relation.certainty === 'inferred' || chronologyStatus(relation) === 'pending'
		)

	const approveChronology = (relation: SessionChronologyProposal) => {
		if (commitLocked) return
		chronologyDecisions[relation.chronologyId] = 'approved'
	}

	const rejectChronology = (relation: SessionChronologyProposal) => {
		if (commitLocked) return
		chronologyDecisions[relation.chronologyId] = 'rejected'
	}

	const chronologyEndpointSelected = (endpoint: SessionChronologyProposal['source']) => {
		if (endpoint.source === 'existing') return true
		const proposal = eventProposalById().get(endpoint.eventId)
		return proposal ? selected(proposal) : false
	}

	const selectedChronology = () =>
		(draft?.chronology ?? []).filter(
			(relation) =>
				chronologyStatus(relation) === 'approved' &&
				chronologyEndpointSelected(relation.source) &&
				chronologyEndpointSelected(relation.target)
		)
	const unplacedChronology = () =>
		(draft?.chronologyCoverage ?? []).filter(({ event, status }) => {
			if (status === 'connected') return false
			const proposal = eventProposalById().get(event.eventId)
			return proposal ? selected(proposal) : false
		})
	const typeProposals = (type: ReviewDocumentType) =>
		canonProposals().filter((proposal) => proposal.documentType === type)
	const otherDetails = () => draft?.proposals.filter(isOtherDetail) ?? []

	const statusCount = (proposals: SessionProposal[], status: ReviewStatus) =>
		proposals.filter((proposal) => reviewStatus(proposal) === status).length

	const approvedCanonCount = () => statusCount(canonProposals(), 'approved')
	const rejectedCanonCount = () => statusCount(canonProposals(), 'rejected')
	const pendingAttentionCount = () =>
		statusCount(attentionProposals(), 'pending') +
		attentionChronology().filter((relation) => chronologyStatus(relation) === 'pending').length

	const setGroupDecision = (proposals: SessionProposal[], decision: ReviewDecision) => {
		if (commitLocked) return
		for (const proposal of proposals) {
			if (decision === 'approved' && !canApprove(proposal)) continue
			decisions[proposal.proposalId] = decision
		}
	}

	const recapContent = () => {
		if (!draft) return ''
		return buildSessionRecap(draft.title, draft.proposals.filter(selected))
			.replace(/^#\s+[^\r\n]*(?:\r?\n+|$)/u, '')
			.trim()
	}

	const recapParagraphs = () =>
		recapContent()
			.split(/\r?\n\s*\r?\n/u)
			.map((paragraph) => paragraph.trim())
			.filter(Boolean)

	const contentParts = (proposal: SessionProposal) =>
		proposal.content
			.split(/\r?\n\s*\r?\n/u)
			.map((part) => part.trim())
			.filter(
				(part) => Boolean(part) && normalizeComparable(part) !== normalizeComparable(proposal.title)
			)

	const actionLabel = (proposal: SessionProposal) => {
		if (proposal.operation === 'create-event') return 'New event'
		if (proposal.operation === 'create-entity')
			return `New ${singularTypeLabel[proposal.documentType as ReviewDocumentType].toLocaleLowerCase()}`
		if (proposal.operation === 'update-canon')
			return `Update ${singularTypeLabel[proposal.documentType as ReviewDocumentType].toLocaleLowerCase()}`
		if (proposal.operation === 'record-only') return 'Session detail'
		return 'Mention only'
	}

	const activeTitle = () => {
		if (activeView === 'summary') return 'Session summary'
		if (activeView === 'attention') return 'Needs your attention'
		return documentTypeMetadata[activeView].label
	}

	const activeProposals = () => {
		if (activeView === 'attention') return attentionProposals()
		if (activeView === 'summary') return []
		return typeProposals(activeView)
	}

	const previewTitles = (type: ReviewDocumentType) => typeProposals(type).slice(0, 2)

	const approve = async () => {
		if (!draft || commitLocked) return
		commitRequested = true
		commitPollingEnabled = false
		commitRetryPollingEnabled = false
		commitStartPending = true
		commitStartError = ''
		commitConflict = false
		navigationError = ''
		try {
			const selectedProposals = draft.proposals.filter(selected)
			await commitSessionIngestion({
				campaignId: params.campaignId,
				ingestionId: params.ingestionId,
				selectedProposalIds: selectedProposals.map(({ proposalId }) => proposalId),
				selectedChronologyIds: selectedChronology().map(({ chronologyId }) => chronologyId),
				resolutions: selectedProposals
					.map(resolutionFor)
					.filter((resolution): resolution is SessionProposalResolution => Boolean(resolution))
			})
			commitPollingEnabled = true
		} catch (error) {
			const status = httpStatus(error)
			if (status === 409) {
				commitRequested = false
				commitConflict = true
				commitStartError = ''
			} else if (isUncertainTransportError(error)) {
				commitPollingEnabled = true
				commitStartError =
					'The save request could not be confirmed. Loremaster will keep checking its status.'
			} else {
				commitRequested = false
				commitStartError = 'The save request was not accepted. Review your choices and try again.'
			}
		} finally {
			commitStartPending = false
		}
	}
</script>

<svelte:head><title>Review session | Loremaster</title></svelte:head>

{#snippet sourceDetails(proposal: SessionProposal)}
	{#if proposal.evidence.length}
		<details class="sources">
			<summary>
				<Icon icon="lucide:quote" aria-hidden="true" />
				{proposal.evidence.length === 1 ? 'View source' : `${proposal.evidence.length} sources`}
			</summary>
			<div class="source-list">
				{#each proposal.evidence as evidence (`${evidence.chunkId}:${evidence.startStringIndex}:${evidence.endStringIndex}`)}
					<blockquote>
						{evidence.excerpt}
						<footer>Transcript lines {evidence.startLine}–{evidence.endLine}</footer>
					</blockquote>
				{/each}
			</div>
		</details>
	{/if}
{/snippet}

{#snippet chronologyCoverageCard(coverage: SessionChronologyCoverageProposal)}
	<article class="chronology-card pending">
		<div class="chronology-relation chronology-unplaced">
			<span>{coverage.event.title}</span>
			<span class="relation-kind">unplaced</span>
		</div>
		<p>{coverage.reason}</p>
		<div class="proposal-footer">
			<span class="badge attention">
				{coverage.status === 'missing' ? 'Needs chronology review' : 'Unknown placement'}
			</span>
		</div>
	</article>
{/snippet}

{#snippet decisionButtons(proposal: SessionProposal)}
	{@const status = reviewStatus(proposal)}
	<div class="decision-actions">
		<button
			type="button"
			class="reject-action"
			class:active={status === 'rejected'}
			aria-pressed={status === 'rejected'}
			disabled={commitLocked}
			onclick={() => rejectProposal(proposal)}
		>
			<Icon icon="lucide:x" aria-hidden="true" />
			{status === 'rejected' ? 'Rejected' : 'Reject'}
		</button>
		<button
			type="button"
			class="approve-action"
			class:active={status === 'approved'}
			aria-pressed={status === 'approved'}
			disabled={commitLocked || !canApprove(proposal)}
			title={!canApprove(proposal)
				? 'Choose which campaign entry this refers to first.'
				: undefined}
			onclick={() => approveProposal(proposal)}
		>
			<Icon icon="lucide:check" aria-hidden="true" />
			{status === 'approved' ? 'Approved' : 'Approve'}
		</button>
	</div>
{/snippet}

{#snippet chronologyCard(relation: SessionChronologyProposal)}
	{@const status = chronologyStatus(relation)}
	<article
		class="chronology-card"
		class:approved={status === 'approved'}
		class:rejected={status === 'rejected'}
		class:pending={status === 'pending'}
	>
		<div class="chronology-relation">
			<span>{relation.source.title}</span>
			{#if relation.relation === 'before'}
				<Icon icon="lucide:arrow-right" aria-label="happened before" />
			{:else}
				<span class="relation-kind">during</span>
			{/if}
			<span>{relation.target.title}</span>
		</div>
		<p>{relation.reason}</p>
		<div class="proposal-footer">
			{#if relation.certainty === 'inferred'}
				<span class="badge attention">Inferred chronology</span>
			{/if}
			<div class="decision-actions">
				<button
					type="button"
					class="reject-action"
					class:active={status === 'rejected'}
					aria-pressed={status === 'rejected'}
					disabled={commitLocked}
					onclick={() => rejectChronology(relation)}
				>
					<Icon icon="lucide:x" aria-hidden="true" />
					{status === 'rejected' ? 'Rejected' : 'Reject'}
				</button>
				<button
					type="button"
					class="approve-action"
					class:active={status === 'approved'}
					aria-pressed={status === 'approved'}
					disabled={commitLocked}
					onclick={() => approveChronology(relation)}
				>
					<Icon icon="lucide:check" aria-hidden="true" />
					{status === 'approved' ? 'Approved' : 'Approve'}
				</button>
			</div>
		</div>
	</article>
{/snippet}

{#snippet proposalCard(proposal: SessionProposal)}
	{@const parts = contentParts(proposal)}
	{@const status = reviewStatus(proposal)}
	<article
		class="proposal-card"
		class:approved={status === 'approved'}
		class:rejected={status === 'rejected'}
		class:pending={status === 'pending'}
	>
		<div class="proposal-heading">
			<div class="proposal-identity">
				<span class="type-icon" aria-hidden="true">
					<Icon icon={documentTypeMetadata[proposal.documentType].icon} />
				</span>
				<span class="proposal-title">
					<span class="action-label">{actionLabel(proposal)}</span>
					<strong>{proposal.title}</strong>
				</span>
			</div>

			<div class="badges">
				{#if status === 'pending'}<span class="badge pending-badge">Review</span>{/if}
				{#if proposal.certainty === 'inferred'}<span class="badge attention">Inferred</span>{/if}
				{#if proposal.match.kind === 'exact' && proposal.resolutionMethod === 'model'}
					<span class="badge attention">Suggested match</span>
				{/if}
			</div>
		</div>

		{#if parts.length === 1}
			<p class="proposal-copy">{parts[0]}</p>
		{:else if parts.length > 1}
			<div class="additions">
				<span class="mini-label">Proposed additions</span>
				<ul>
					{#each parts as part}<li>{part}</li>{/each}
				</ul>
			</div>
		{/if}

		{#if proposal.match.kind === 'exact' && proposal.resolutionMethod === 'model'}
			<p class="match-note">
				<Icon icon="lucide:git-merge" aria-hidden="true" />
				Suggested match: <strong>{proposal.match.title}</strong>. Approve only if this is the same
				entry.
			</p>
		{:else if hasDeferredIdentityDecision(proposal)}
			<div class="resolution-panel">
				<div>
					<strong>Is this the same as an existing entry?</strong>
					<p>Choose an existing entry only if both names refer to the same thing.</p>
				</div>
				<label class="resolution">
					<span>Identity match</span>
					<select
						value={resolutions[proposal.proposalId] ?? ''}
						disabled={commitLocked}
						onchange={(event) => chooseResolution(proposal, event.currentTarget.value)}
					>
						<option value="">Choose whether these are the same…</option>
						{#each proposal.match.candidates as candidate (candidate.documentId)}
							<option value={candidate.documentId}>Same as “{candidate.title}”</option>
						{/each}
						{#if proposal.canCreate}
							<option value="create">Create new “{proposal.title}”</option>
						{/if}
					</select>
				</label>
			</div>
		{/if}

		{#if proposal.certainty === 'inferred'}
			<p class="guidance">
				<Icon icon="lucide:sparkles" aria-hidden="true" />
				This is inferred rather than stated directly in the session, so Loremaster is asking you to decide.
			</p>
		{/if}

		<div class="proposal-footer">
			{@render sourceDetails(proposal)}
			{@render decisionButtons(proposal)}
		</div>
	</article>
{/snippet}

{#snippet otherDetail(proposal: SessionProposal)}
	{@const parts = contentParts(proposal)}
	{@const status = reviewStatus(proposal)}
	<article class="detail-card" class:rejected={status === 'rejected'}>
		<div class="detail-heading">
			<span class="detail-kind">{actionLabel(proposal)}</span>
			<strong>{proposal.title}</strong>
		</div>
		{#if parts.length}
			<p>{parts.join(' ')}</p>
		{/if}
		<p class="detail-help">
			{proposal.operation === 'record-only'
				? 'This can be included in the saved session without creating or updating a campaign entry.'
				: 'Kept as source context only. It will not change canon or the session recap.'}
		</p>
		<div class="proposal-footer">
			{@render sourceDetails(proposal)}
			{#if proposal.operation === 'record-only'}
				{@render decisionButtons(proposal)}
			{/if}
		</div>
	</article>
{/snippet}

<section class="review-page" aria-labelledby="review-heading">
	<a class="back-link" href={`/campaigns/${params.campaignId}/session`}>← Back to sessions</a>
	<header class="page-heading">
		<p class="eyebrow">Session review</p>
		<h2 id="review-heading">{draft?.title ?? 'Review session'}</h2>
		<p>
			Review what Loremaster learned before saving the session and updating your campaign canon.
		</p>
	</header>

	{#if analysisLifecycle === 'not-started'}
		<div class="state workflow-retry" role="alert">
			<strong>Analysis needs to be restarted</strong>
			<p>
				The transcript request is safe, but its analysis worker did not start. Retry the existing
				request to continue.
			</p>
			{#if analysisStatus.current?.retryable}
				<button
					class="retry-action"
					type="button"
					disabled={analysisRetryPending || analysisRetryPollingEnabled}
					onclick={retryAnalysis}
				>
					<Icon icon="lucide:rotate-cw" aria-hidden="true" />
					{analysisRetryPending
						? 'Restarting analysis…'
						: analysisRetryPollingEnabled
							? 'Waiting for analysis…'
							: 'Retry analysis'}
				</button>
			{/if}
			{#if analysisStatus.error}
				<p class="error" role="alert">Unable to confirm the analysis status right now.</p>
			{/if}
			{#if analysisRetryError}<p class="error" role="alert">{analysisRetryError}</p>{/if}
		</div>
	{:else if analysisLifecycle === 'failed' || analysisLifecycle === 'cancelled'}
		<div class="state workflow-failure" role="alert">
			<strong>
				{analysisLifecycle === 'cancelled' ? 'Analysis was cancelled' : 'Analysis could not finish'}
			</strong>
			<p>No campaign changes were made. You can start a new analysis or return to your sessions.</p>
			<div class="state-actions">
				<a href={`/campaigns/${params.campaignId}/session/ingest`}>Try another transcript</a>
				<a href={`/campaigns/${params.campaignId}/session`}>Back to sessions</a>
			</div>
		</div>
	{:else if analysisLifecycle === 'succeeded' && !draft}
		<div class="state workflow-failure" role="alert">
			<strong>Analysis finished without a review</strong>
			<p>Please start the analysis again. No campaign changes were made.</p>
			<div class="state-actions">
				<a href={`/campaigns/${params.campaignId}/session/ingest`}>Try another transcript</a>
				<a href={`/campaigns/${params.campaignId}/session`}>Back to sessions</a>
			</div>
		</div>
	{:else if analysisLifecycle !== 'succeeded'}
		<div class="state workflow-state" role="status" aria-live="polite" aria-atomic="true">
			<Icon
				icon={analysisLifecycle === 'queued' ? 'lucide:clock-3' : 'lucide:scan-search'}
				aria-hidden="true"
			/>
			<div>
				<strong>
					{analysisLifecycle === 'queued'
						? 'Analysis queued'
						: analysisLifecycle === 'running'
							? 'Analyzing session'
							: 'Connecting to analysis'}
				</strong>
				<p>
					{analysisProgress
						? stageLabels[analysisProgress.stage]
						: analysisLifecycle === 'queued'
							? stageLabels.queued
							: 'This review will appear here when it is ready.'}
				</p>
				{#if analysisProgress && analysisProgress.total > 0}
					<div class="workflow-progress">
						<progress value={analysisProgress.completed} max={analysisProgress.total}>
							{analysisProgress.completed} of {analysisProgress.total}
						</progress>
						<span>{analysisProgress.completed} of {analysisProgress.total}</span>
					</div>
				{/if}
			</div>
		</div>
		{#if analysisStatus.error}
			<p class="state transport-error" role="alert">
				The analysis status connection was interrupted. Loremaster will keep trying.
			</p>
		{/if}
	{:else if draft}
		<div class="review-shell">
			<main class="review-content">
				<header class="content-heading">
					<div>
						<p class="eyebrow">{activeView === 'summary' ? 'Session' : 'Review'}</p>
						<h3>{activeTitle()}</h3>
					</div>

					{#if activeView !== 'summary'}
						{@const proposals = activeProposals()}
						<div class="content-stats">
							<span class="approved-text">{statusCount(proposals, 'approved')} approved</span>
							{#if statusCount(proposals, 'pending')}
								<span class="pending-text">{statusCount(proposals, 'pending')} pending</span>
							{/if}
							{#if statusCount(proposals, 'rejected')}
								<span class="rejected-text">{statusCount(proposals, 'rejected')} rejected</span>
							{/if}
						</div>
					{/if}
				</header>

				{#if activeView === 'summary'}
					<section class="recap" aria-labelledby="recap-heading">
						<div class="section-kicker">
							<Icon icon="lucide:notebook-text" aria-hidden="true" />
							<span>Session recap</span>
						</div>
						<h4 id="recap-heading">What happened</h4>
						<div class="recap-copy">
							{#if recapParagraphs().length}
								{#each recapParagraphs() as paragraph}<p>{paragraph}</p>{/each}
							{:else}
								<p class="empty-copy">No approved session details yet.</p>
							{/if}
						</div>
						<p class="recap-help">The recap updates as you approve or reject details.</p>
					</section>

					{#if otherDetails().length}
						<details class="other-details">
							<summary>
								<span>
									<Icon icon="lucide:list-collapse" aria-hidden="true" />
									Other detected details
								</span>
								<small>{otherDetails().length}</small>
							</summary>
							<p class="other-details-intro">
								These preserve useful session context without becoming normal campaign entries.
							</p>
							<div class="detail-list">
								{#each otherDetails() as proposal (proposal.proposalId)}
									{@render otherDetail(proposal)}
								{/each}
							</div>
						</details>
					{/if}

					{#if draft.warnings.length}
						<details class="analysis-notes">
							<summary>
								{draft.warnings.length} analysis {draft.warnings.length === 1 ? 'note' : 'notes'}
							</summary>
							<p>
								Some source details could not be confidently included. These notes are mainly useful
								for troubleshooting.
							</p>
							<ul>
								{#each draft.warnings as warning}<li>{warning}</li>{/each}
							</ul>
						</details>
					{/if}
				{:else if activeView === 'attention'}
					{#if attentionProposals().length || attentionChronology().length}
						<div class="attention-intro">
							<Icon icon="lucide:circle-help" aria-hidden="true" />
							<div>
								<strong>Loremaster deferred these decisions to you.</strong>
								<p>They contain an inference, an ambiguous identity, or a model-suggested match.</p>
							</div>
						</div>
						<div class="proposal-list">
							{#each attentionProposals() as proposal (proposal.proposalId)}
								{@render proposalCard(proposal)}
							{/each}
							{#each attentionChronology() as relation (relation.chronologyId)}
								{@render chronologyCard(relation)}
							{/each}
						</div>
					{:else}
						<div class="empty-view">
							<Icon icon="lucide:circle-check-big" aria-hidden="true" />
							<h4>Nothing needs your attention</h4>
							<p>All proposed canon changes are routine, explicit updates.</p>
						</div>
					{/if}
				{:else}
					{@const proposals = typeProposals(activeView)}
					<div class="group-toolbar">
						<p>
							{proposals.length}
							{proposals.length === 1 ? 'change' : 'changes'} found in this session.
						</p>
						<div>
							<button
								type="button"
								disabled={commitLocked}
								onclick={() => setGroupDecision(proposals, 'approved')}
							>
								Approve all ready
							</button>
							<button
								type="button"
								disabled={commitLocked}
								onclick={() => setGroupDecision(proposals, 'rejected')}
							>
								Reject all
							</button>
						</div>
					</div>
					{#if activeView === 'event' && (draft.chronology.length || unplacedChronology().length)}
						<section class="chronology-review" aria-labelledby="chronology-heading">
							<div class="section-kicker">
								<Icon icon="lucide:git-commit-horizontal" aria-hidden="true" />
								<span>Proposed order</span>
							</div>
							<h4 id="chronology-heading">How these events connect</h4>
							<p class="chronology-help">
								Approve only relationships established by the session. Missing relationships remain
								unknown.
							</p>
							<div class="chronology-list">
								{#each draft.chronology as relation (relation.chronologyId)}
									{@render chronologyCard(relation)}
								{/each}
								{#each unplacedChronology() as coverage (coverage.event.eventId)}
									{@render chronologyCoverageCard(coverage)}
								{/each}
							</div>
						</section>
					{/if}
					<div class="proposal-list">
						{#each proposals as proposal (proposal.proposalId)}
							{@render proposalCard(proposal)}
						{/each}
					</div>
				{/if}
			</main>

			<aside class="review-sidebar" aria-label="Session review sections">
				{#if attentionProposals().length || attentionChronology().length}
					<button
						type="button"
						class="nav-card attention-nav"
						class:active={activeView === 'attention'}
						onclick={() => (activeView = 'attention')}
					>
						<span class="nav-card-heading">
							<span class="nav-icon"><Icon icon="lucide:circle-help" aria-hidden="true" /></span>
							<strong>Needs attention</strong>
							<span class="nav-count">{pendingAttentionCount()}</span>
						</span>
						<span class="nav-subline">
							{pendingAttentionCount()
								? `${pendingAttentionCount()} ${pendingAttentionCount() === 1 ? 'decision' : 'decisions'} left`
								: 'Everything reviewed'}
						</span>
					</button>
				{/if}

				<button
					type="button"
					class="nav-card summary-nav"
					class:active={activeView === 'summary'}
					onclick={() => (activeView = 'summary')}
				>
					<span class="nav-card-heading">
						<span class="nav-icon"><Icon icon="lucide:notebook-text" aria-hidden="true" /></span>
						<strong>Summary</strong>
					</span>
					<span class="nav-subline">Session recap</span>
				</button>

				{#each reviewTypes as type (type)}
					{@const proposals = typeProposals(type)}
					{#if proposals.length}
						<button
							type="button"
							class="nav-card"
							class:active={activeView === type}
							onclick={() => (activeView = type)}
						>
							<span class="nav-card-heading">
								<span class="nav-icon">
									<Icon icon={documentTypeMetadata[type].icon} aria-hidden="true" />
								</span>
								<strong>{documentTypeMetadata[type].label}</strong>
								<span class="nav-count">{proposals.length}</span>
							</span>
							<span class="nav-statuses">
								<span class="approved-text">{statusCount(proposals, 'approved')} approved</span>
								{#if statusCount(proposals, 'pending')}
									<span class="pending-text">· {statusCount(proposals, 'pending')} review</span>
								{/if}
								{#if statusCount(proposals, 'rejected')}
									<span class="rejected-text">· {statusCount(proposals, 'rejected')} rejected</span>
								{/if}
							</span>
							{#if previewTitles(type).length}
								<span class="preview-row">
									{#each previewTitles(type) as proposal (proposal.proposalId)}
										<span>{proposal.title}</span>
									{/each}
									{#if proposals.length > 2}<span>+{proposals.length - 2}</span>{/if}
								</span>
							{/if}
						</button>
					{/if}
				{/each}
			</aside>
		</div>

		<footer class="approval">
			<div>
				<strong>
					{approvedCanonCount()} approved · {rejectedCanonCount()} rejected
					{#if pendingAttentionCount()}
						· {pendingAttentionCount()} need attention{/if}
				</strong>
				<p>
					{pendingAttentionCount()
						? `${pendingAttentionCount()} undecided ${pendingAttentionCount() === 1 ? 'change' : 'changes'} will not be added unless you approve them.`
						: 'Your review is ready to save.'}
				</p>
				{#if commitConflict}
					<div class="commit-failure" role="alert">
						<strong>Another proposal selection is already being saved.</strong>
						<span>
							Your current choices were not accepted. Reload to follow the selection that was
							accepted first.
						</span>
						<button class="retry-action" type="button" onclick={() => location.reload()}>
							<Icon icon="lucide:refresh-cw" aria-hidden="true" />
							Reload accepted selection
						</button>
					</div>
				{:else if commitLifecycle === 'not-started'}
					<div class="commit-retry" role="alert">
						<strong>The saved selection needs to be restarted.</strong>
						<span>Your accepted choices remain locked while Loremaster retries the save.</span>
						{#if commitStatus.current?.retryable}
							<button
								class="retry-action"
								type="button"
								disabled={commitRetryPending || commitRetryPollingEnabled}
								onclick={retryCommit}
							>
								<Icon icon="lucide:rotate-cw" aria-hidden="true" />
								{commitRetryPending
									? 'Restarting save…'
									: commitRetryPollingEnabled
										? 'Waiting for save…'
										: 'Retry save'}
							</button>
						{/if}
						{#if commitRetryError}<span class="error">{commitRetryError}</span>{/if}
					</div>
				{:else if commitLifecycle === 'failed' || commitLifecycle === 'cancelled'}
					<div class="commit-failure" role="alert">
						<strong>
							{commitLifecycle === 'cancelled'
								? 'The save was cancelled.'
								: 'The session could not be saved.'}
						</strong>
						<span>Your review is still shown above. Return to sessions when you are ready.</span>
					</div>
				{:else if commitLifecycle === 'queued' || commitLifecycle === 'running'}
					<p class="commit-status" role="status" aria-live="polite" aria-atomic="true">
						{commitProgress ? stageLabels[commitProgress.stage] : 'Waiting for the save workflow'}
						{#if commitProgress && commitProgress.total > 0}
							· {commitProgress.completed} of {commitProgress.total}
						{/if}
					</p>
				{/if}
				{#if !commitConflict && commitTransportError}
					<p class="error" role="alert">
						Unable to check the save status right now. Loremaster will keep trying after a save
						request.
					</p>
				{/if}
				{#if commitStartError}<p class="error" role="alert">{commitStartError}</p>{/if}
				{#if navigationError}
					<div class="navigation-failure" role="alert">
						<span>{navigationError}</span>
						<button
							class="retry-action"
							type="button"
							disabled={navigationPending}
							onclick={retryNavigation}
						>
							<Icon icon="lucide:external-link" aria-hidden="true" />
							{navigationPending ? 'Opening session…' : 'Open saved session'}
						</button>
					</div>
				{/if}
			</div>
			<button type="button" disabled={commitLocked} onclick={approve}>
				<Icon icon="lucide:save" aria-hidden="true" />
				{commitStartPending
					? 'Starting save…'
					: navigationPending
						? 'Opening session…'
						: commitConflict
							? 'Reload required'
							: commitLifecycle === 'queued'
								? 'Save queued…'
								: commitLifecycle === 'running'
									? 'Saving…'
									: commitLifecycle === 'succeeded'
										? 'Session saved'
										: commitLifecycle === 'not-started'
											? 'Save needs restart'
											: commitLifecycle === 'failed' || commitLifecycle === 'cancelled'
												? 'Save not completed'
												: commitRequested
													? 'Waiting for save status…'
													: 'Save session & update canon'}
			</button>
		</footer>
	{/if}
</section>

<style>
	.review-page {
		--ink: #282016;
		--ink-soft: #6f604e;
		--gold: #9a7843;
		--paper: rgb(255 251 241 / 82%);
		--green: #35744b;
		--green-soft: rgb(53 116 75 / 10%);
		--red: #9a4439;
		--red-soft: rgb(154 68 57 / 9%);
		--amber: #9b642f;
		box-sizing: border-box;
		width: min(82rem, 100%);
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 5vw, 4rem) 7rem;
		color: var(--ink);
	}

	.back-link,
	.eyebrow {
		color: var(--gold);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.page-heading {
		margin: 1.25rem 0 1.5rem;
	}

	h2,
	h3,
	h4 {
		font-family: var(--font-display);
	}

	h2 {
		margin: 0.2rem 0 0.5rem;
		font-size: clamp(2rem, 5vw, 3rem);
	}

	h3 {
		margin: 0;
		font-size: 1.6rem;
	}

	h4 {
		margin: 0;
		font-size: 1.35rem;
	}

	.page-heading > p:last-child,
	.recap-help,
	.match-note,
	.guidance,
	.other-details-intro,
	.analysis-notes > p,
	.approval p,
	.empty-copy {
		color: var(--ink-soft);
	}

	.state {
		padding: 1rem;
		border: 1px solid rgb(154 120 67 / 40%);
		background: rgb(250 241 222 / 55%);
	}

	.workflow-state {
		display: flex;
		gap: 0.85rem;
		align-items: start;
	}

	.workflow-state > :global(svg) {
		flex: 0 0 auto;
		width: 1.35rem;
		height: 1.35rem;
		color: var(--gold);
	}

	.workflow-state p,
	.workflow-failure p {
		margin: 0.3rem 0 0;
		color: var(--ink-soft);
	}

	.workflow-progress {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		margin-top: 0.75rem;
		color: var(--ink-soft);
		font-size: 0.75rem;
	}

	.workflow-progress progress {
		width: min(20rem, 65vw);
		accent-color: var(--gold);
	}

	.workflow-failure {
		border-color: rgb(154 68 57 / 35%);
		background: rgb(154 68 57 / 8%);
	}

	.workflow-retry {
		border-color: rgb(155 100 47 / 42%);
		background: rgb(255 248 232 / 72%);
	}

	.state-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 0.9rem;
	}

	.state-actions a {
		color: var(--gold);
		font-weight: 750;
	}

	.retry-action {
		display: inline-flex;
		width: fit-content;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.75rem;
		padding: 0.45rem 0.65rem;
		border: 1px solid rgb(154 120 67 / 48%);
		border-radius: 0.35rem;
		background: #fffaf0;
		color: var(--ink);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 750;
		cursor: pointer;
	}

	.retry-action :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.retry-action:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.transport-error {
		margin-top: 0.75rem;
		border-color: rgb(154 68 57 / 28%);
		color: var(--red);
	}

	.review-shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 18rem;
		gap: 1.25rem;
		align-items: stretch;
	}

	.review-content {
		height: 0;
		min-height: max(39rem, 100%);
		overflow-y: auto;
		padding: clamp(1.2rem, 2.5vw, 2rem);
		border: 1px solid rgb(154 120 67 / 40%);
		border-radius: var(--border-radius-md);
		background: var(--paper);
		box-shadow: 0 10px 32px rgb(70 49 28 / 6%);
	}

	.content-heading {
		display: flex;
		gap: 1rem;
		align-items: end;
		justify-content: space-between;
		margin-bottom: 1.25rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgb(154 120 67 / 24%);
	}

	.content-heading .eyebrow {
		margin: 0 0 0.25rem;
	}

	.content-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		justify-content: flex-end;
		font-size: 0.72rem;
		font-weight: 750;
	}

	.review-sidebar {
		display: grid;
		align-content: start;
		gap: 0.7rem;
	}

	.nav-card {
		display: grid;
		width: 100%;
		gap: 0.48rem;
		padding: 0.9rem;
		border: 1px solid rgb(154 120 67 / 32%);
		border-radius: var(--border-radius-md);
		background: rgb(255 251 241 / 66%);
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			background-color 120ms ease,
			box-shadow 120ms ease;
	}

	.nav-card:hover {
		transform: translateY(-1px);
		border-color: rgb(154 120 67 / 58%);
		background: rgb(255 251 241 / 88%);
	}

	.nav-card.active {
		border-color: rgb(154 120 67 / 72%);
		background: rgb(255 248 232 / 94%);
		box-shadow: 0 6px 20px rgb(70 49 28 / 8%);
	}

	.attention-nav {
		border-color: rgb(166 112 53 / 48%);
		background: rgb(249 235 207 / 58%);
	}

	.attention-nav.active {
		border-color: rgb(155 100 47 / 78%);
		background: rgb(249 235 207 / 88%);
	}

	.nav-card-heading {
		display: flex;
		gap: 0.55rem;
		align-items: center;
	}

	.nav-icon {
		display: grid;
		width: 1.7rem;
		height: 1.7rem;
		place-items: center;
		border: 1px solid rgb(154 120 67 / 28%);
		border-radius: 50%;
		color: var(--gold);
	}

	.nav-icon :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.nav-card-heading strong {
		flex: 1;
		font-family: var(--font-display);
		font-size: 1.02rem;
	}

	.nav-count {
		display: grid;
		min-width: 1.55rem;
		height: 1.55rem;
		place-items: center;
		border-radius: 999px;
		background: rgb(154 120 67 / 10%);
		color: var(--ink-soft);
		font-size: 0.7rem;
		font-weight: 800;
	}

	.nav-subline,
	.nav-statuses {
		color: var(--ink-soft);
		font-size: 0.7rem;
		font-weight: 650;
	}

	.preview-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.1rem;
	}

	.preview-row span {
		max-width: 100%;
		padding: 0.22rem 0.38rem;
		overflow: hidden;
		border-radius: 0.3rem;
		background: rgb(154 120 67 / 8%);
		color: var(--ink-soft);
		font-size: 0.64rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.approved-text {
		color: var(--green);
	}

	.pending-text {
		color: var(--amber);
	}

	.rejected-text {
		color: var(--red);
	}

	.recap {
		padding: 0.25rem 0 0;
	}

	.section-kicker {
		display: flex;
		gap: 0.45rem;
		align-items: center;
		margin-bottom: 0.35rem;
		color: var(--gold);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.section-kicker :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.recap-copy {
		margin-top: 1rem;
		font-size: 0.98rem;
		line-height: 1.7;
	}

	.recap-copy p {
		margin: 0.75rem 0;
	}

	.recap-help {
		margin: 1rem 0 0;
		font-size: 0.78rem;
	}

	.attention-intro {
		display: flex;
		gap: 0.75rem;
		align-items: start;
		margin-bottom: 1rem;
		padding: 0.85rem 0.95rem;
		border: 1px solid rgb(166 112 53 / 34%);
		border-radius: calc(var(--border-radius-md) * 0.85);
		background: rgb(249 235 207 / 44%);
	}

	.attention-intro :global(svg) {
		flex: 0 0 auto;
		width: 1.2rem;
		height: 1.2rem;
		margin-top: 0.1rem;
		color: var(--amber);
	}

	.attention-intro p {
		margin: 0.2rem 0 0;
		color: var(--ink-soft);
		font-size: 0.78rem;
	}

	.group-toolbar {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.9rem;
	}

	.group-toolbar p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.78rem;
	}

	.group-toolbar > div {
		display: flex;
		gap: 0.35rem;
	}

	.group-toolbar button {
		padding: 0.35rem 0.5rem;
		border: 0;
		background: transparent;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.72rem;
		font-weight: 750;
		cursor: pointer;
	}

	.group-toolbar button:not(:disabled):hover {
		color: var(--ink);
		text-decoration: underline;
	}

	.group-toolbar button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.proposal-list {
		display: grid;
		gap: 0.7rem;
	}

	.chronology-review {
		margin-bottom: 1.25rem;
		padding: 1rem;
		border: 1px solid rgb(154 120 67 / 24%);
		border-radius: var(--border-radius-md);
		background: rgb(154 120 67 / 5%);
	}

	.chronology-help,
	.chronology-card > p {
		color: var(--ink-soft);
		font-size: 0.78rem;
	}

	.chronology-help {
		margin: 0.35rem 0 0.9rem;
	}

	.chronology-list {
		display: grid;
		gap: 0.6rem;
	}

	.chronology-card {
		padding: 0.85rem 0.95rem;
		border: 1px solid rgb(154 120 67 / 30%);
		border-radius: calc(var(--border-radius-md) * 0.85);
		background: rgb(255 251 241 / 68%);
	}

	.chronology-card.approved {
		border-color: rgb(53 116 75 / 26%);
		background: linear-gradient(90deg, var(--green-soft), rgb(255 251 241 / 70%) 22%);
	}

	.chronology-card.rejected {
		border-color: rgb(154 68 57 / 24%);
		background: linear-gradient(90deg, var(--red-soft), rgb(246 242 233 / 54%) 22%);
	}

	.chronology-card.pending {
		border-color: rgb(155 100 47 / 42%);
		background: rgb(255 248 232 / 72%);
	}

	.chronology-relation {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		gap: 0.7rem;
		align-items: center;
		font-family: var(--font-display);
		font-weight: 700;
	}

	.chronology-unplaced {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.chronology-relation :global(svg) {
		color: var(--gold);
	}

	.relation-kind {
		color: var(--gold);
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.chronology-card > p {
		margin: 0.45rem 0 0;
	}

	.chronology-card .proposal-footer {
		margin-left: 0;
	}

	.proposal-card {
		container-type: inline-size;
		padding: 1rem 1.05rem;
		border: 1px solid rgb(154 120 67 / 30%);
		border-radius: var(--border-radius-md);
		background: rgb(255 251 241 / 68%);
		transition:
			background-color 140ms ease,
			border-color 140ms ease,
			box-shadow 140ms ease;
	}

	.proposal-card.approved {
		border-color: rgb(53 116 75 / 26%);
		background: linear-gradient(90deg, var(--green-soft), rgb(255 251 241 / 70%) 22%);
	}

	.proposal-card.rejected {
		border-color: rgb(154 68 57 / 24%);
		background: linear-gradient(90deg, var(--red-soft), rgb(246 242 233 / 54%) 22%);
	}

	.proposal-card.pending {
		border-color: rgb(155 100 47 / 42%);
		background: rgb(255 248 232 / 72%);
	}

	.proposal-heading {
		display: flex;
		gap: 0.9rem;
		align-items: start;
		justify-content: space-between;
	}

	.proposal-identity {
		display: flex;
		min-width: 0;
		gap: 0.7rem;
		align-items: center;
	}

	.type-icon {
		display: grid;
		flex: 0 0 auto;
		width: 2.1rem;
		height: 2.1rem;
		place-items: center;
		border: 1px solid rgb(154 120 67 / 30%);
		border-radius: 50%;
		background: rgb(154 120 67 / 8%);
		color: var(--gold);
	}

	.type-icon :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.proposal-title {
		display: grid;
		min-width: 0;
		gap: 0.08rem;
	}

	.proposal-title strong {
		font-family: var(--font-display);
		font-size: 1.18rem;
		line-height: 1.2;
	}

	.action-label,
	.mini-label,
	.detail-kind {
		color: var(--gold);
		font-size: 0.67rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.badges {
		display: flex;
		flex: 0 0 auto;
		flex-wrap: wrap;
		gap: 0.3rem;
		justify-content: flex-end;
	}

	.badge {
		padding: 0.18rem 0.4rem;
		border: 1px solid rgb(154 120 67 / 30%);
		border-radius: 999px;
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.badge.attention,
	.pending-badge {
		border-color: rgb(166 112 53 / 40%);
		background: rgb(206 150 78 / 10%);
		color: #8d5a26;
	}

	.proposal-copy,
	.additions,
	.match-note,
	.guidance,
	.resolution-panel {
		margin-left: 2.8rem;
	}

	.proposal-copy {
		margin-top: 0.75rem;
		margin-bottom: 0;
		line-height: 1.55;
	}

	.additions {
		margin-top: 0.8rem;
	}

	.additions ul {
		display: grid;
		gap: 0.35rem;
		margin: 0.35rem 0 0;
		padding-left: 1.15rem;
	}

	.match-note,
	.guidance {
		display: flex;
		gap: 0.45rem;
		align-items: start;
		margin-top: 0.75rem;
		margin-bottom: 0;
		color: var(--ink-soft);
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.match-note :global(svg),
	.guidance :global(svg) {
		flex: 0 0 auto;
		width: 0.95rem;
		height: 0.95rem;
		margin-top: 0.08rem;
	}

	.resolution-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(13rem, 22rem);
		gap: 1rem;
		align-items: end;
		margin-top: 0.85rem;
		padding: 0.8rem;
		border: 1px solid rgb(166 112 53 / 35%);
		border-radius: calc(var(--border-radius-md) * 0.8);
		background: rgb(255 248 232 / 70%);
	}

	.resolution-panel p {
		margin: 0.2rem 0 0;
		color: var(--ink-soft);
		font-size: 0.76rem;
	}

	.resolution {
		display: grid;
		gap: 0.3rem;
		color: var(--ink-soft);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.resolution select {
		width: 100%;
		padding: 0.5rem 0.6rem;
		border: 1px solid rgb(154 120 67 / 48%);
		border-radius: 0.35rem;
		background: #fffaf0;
		color: var(--ink);
		font: inherit;
	}

	.resolution select:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.proposal-footer {
		display: flex;
		gap: 0.75rem;
		align-items: end;
		justify-content: space-between;
		margin-top: 0.9rem;
		margin-left: 2.8rem;
	}

	.sources {
		min-width: 0;
	}

	.sources summary {
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		color: var(--ink-soft);
		font-size: 0.74rem;
		font-weight: 700;
		cursor: pointer;
		list-style: none;
	}

	.sources summary::-webkit-details-marker {
		display: none;
	}

	.sources summary :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.source-list {
		margin-top: 0.65rem;
	}

	blockquote {
		margin: 0.55rem 0;
		padding: 0.65rem 0.85rem;
		border-left: 3px solid rgb(154 120 67 / 58%);
		background: rgb(255 251 241 / 68%);
		font-size: 0.82rem;
		line-height: 1.5;
	}

	blockquote footer {
		margin-top: 0.35rem;
		color: var(--ink-soft);
		font-size: 0.68rem;
	}

	.decision-actions {
		display: flex;
		flex: 0 0 auto;
		gap: 0.45rem;
	}

	.decision-actions button {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		padding: 0.48rem 0.7rem;
		border-radius: 0.4rem;
		background: transparent;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 800;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			border-color 120ms ease;
	}

	.decision-actions button :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.reject-action {
		border: 1px solid rgb(154 68 57 / 55%);
		color: var(--red);
	}

	.reject-action:not(:disabled):hover,
	.reject-action.active {
		border-color: var(--red);
		background: var(--red);
		color: #fff;
	}

	.approve-action {
		border: 1px solid rgb(53 116 75 / 58%);
		color: var(--green);
	}

	.approve-action:not(:disabled):hover,
	.approve-action.active {
		border-color: var(--green);
		background: var(--green);
		color: #fff;
	}

	.decision-actions button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.approve-action:disabled:not(.active):hover {
		background: transparent;
		color: var(--green);
	}

	.other-details,
	.analysis-notes {
		margin-top: 2rem;
		border-top: 1px solid rgb(154 120 67 / 28%);
	}

	.other-details > summary,
	.analysis-notes > summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 0;
		color: var(--ink-soft);
		font-weight: 700;
		cursor: pointer;
	}

	.other-details > summary span {
		display: flex;
		gap: 0.45rem;
		align-items: center;
	}

	.other-details > summary :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.other-details-intro {
		margin: 0 0 0.8rem;
		font-size: 0.8rem;
	}

	.detail-list {
		display: grid;
		gap: 0.5rem;
	}

	.detail-card {
		padding: 0.85rem 0.9rem;
		border: 1px solid rgb(154 120 67 / 24%);
		border-radius: calc(var(--border-radius-md) * 0.8);
		background: rgb(255 251 241 / 44%);
	}

	.detail-card.rejected {
		opacity: 0.68;
	}

	.detail-heading {
		display: grid;
		gap: 0.12rem;
	}

	.detail-heading strong {
		font-family: var(--font-display);
	}

	.detail-card > p {
		margin: 0.5rem 0 0;
		font-size: 0.82rem;
	}

	.detail-help {
		color: var(--ink-soft);
		font-style: italic;
	}

	.detail-card .proposal-footer {
		margin-left: 0;
	}

	.analysis-notes {
		font-size: 0.78rem;
	}

	.analysis-notes ul {
		margin-top: 0.5rem;
	}

	.empty-view {
		display: grid;
		place-items: center;
		min-height: 22rem;
		color: var(--ink-soft);
		text-align: center;
	}

	.empty-view :global(svg) {
		width: 2.2rem;
		height: 2.2rem;
		color: var(--green);
	}

	.empty-view h4 {
		margin-top: 0.7rem;
		color: var(--ink);
	}

	.empty-view p {
		margin-top: 0.25rem;
	}

	.error {
		color: #8b2f27;
	}

	.commit-status,
	.commit-failure,
	.commit-retry,
	.navigation-failure {
		margin-top: 0.55rem;
	}

	.commit-status {
		color: var(--gold);
		font-weight: 700;
	}

	.commit-failure,
	.commit-retry,
	.navigation-failure {
		display: grid;
		gap: 0.2rem;
	}

	.commit-failure,
	.navigation-failure {
		color: var(--red);
	}

	.commit-retry {
		color: var(--amber);
	}

	.commit-failure span,
	.commit-retry span,
	.navigation-failure span {
		color: var(--ink-soft);
		font-size: 0.76rem;
	}

	.approval {
		position: sticky;
		z-index: 10;
		bottom: 1rem;
		display: flex;
		gap: 1.5rem;
		align-items: center;
		justify-content: space-between;
		margin-top: 1.25rem;
		padding: 0.95rem 1rem;
		border: 1px solid rgb(154 120 67 / 48%);
		border-radius: var(--border-radius-md);
		background: rgb(255 251 241 / 95%);
		box-shadow: 0 10px 30px rgb(50 35 20 / 12%);
		backdrop-filter: blur(10px);
	}

	.approval p {
		margin: 0.2rem 0 0;
		font-size: 0.76rem;
	}

	.approval > button {
		display: inline-flex;
		flex: 0 0 auto;
		gap: 0.45rem;
		align-items: center;
		padding: 0.72rem 1rem;
		border: 1px solid var(--gold);
		border-radius: 0.4rem;
		background: var(--ink);
		color: #fffaf0;
		font: inherit;
		font-weight: 750;
		cursor: pointer;
	}

	.approval > button :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.approval > button:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	@container (max-width: 32rem) {
		.resolution-panel {
			grid-template-columns: minmax(0, 1fr);
			margin-left: 0;
		}
	}

	@media (max-width: 900px) {
		.review-shell {
			grid-template-columns: 1fr;
		}

		.review-sidebar {
			position: static;
			grid-row: 1;
			grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		}

		.nav-card {
			min-height: 6.3rem;
		}

		.review-content {
			height: auto;
			min-height: 30rem;
			overflow-y: visible;
		}
	}

	@media (max-width: 640px) {
		.content-heading,
		.group-toolbar,
		.proposal-footer,
		.approval {
			align-items: stretch;
			flex-direction: column;
		}

		.content-stats {
			justify-content: flex-start;
		}

		.proposal-copy,
		.additions,
		.match-note,
		.guidance,
		.resolution-panel,
		.proposal-footer {
			margin-left: 0;
		}

		.resolution-panel {
			grid-template-columns: 1fr;
		}

		.decision-actions {
			width: 100%;
		}

		.decision-actions button {
			flex: 1;
			justify-content: center;
		}

		.approval {
			bottom: 0.5rem;
		}

		.approval > button {
			justify-content: center;
			width: 100%;
		}
	}
</style>
