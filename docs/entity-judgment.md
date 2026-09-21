# Entity judgment pipeline

Identity retrieval, semantic judgment, and proposal policy have separate responsibilities.
The refactor separates candidate retrieval and judgment in session ingestion while
using the existing `AiProvider` abstraction and retaining the matching policy.

## Current integration

`ingestion/context.ts` retrieves campaign context using exact names, lexical search,
semantic search, graph relationships, and chronology. Within that retrieved context,
`entity-candidates.ts` constructs the identity shortlist before the provider is called.
It includes name matches and, where applicable, relational and session candidates.

`entity-judgment.ts` receives structured mentions, evidence, and candidate IDs with
context and retrieval provenance. This pipeline step calls the existing
`AiProvider.resolveSessionEntities` operation and translates its answers into:

- `existing`: a supplied candidate ID matches the mention.
- `none-of-these`: none of the supplied candidates matches; this is not proof that the
  entity is absent from the entire vault.
- `insufficient-evidence`: the evidence does not establish identity. An empty candidate
  shortlist means the provider cannot narrow the retrieved identity candidates further.

`entity-resolution.ts` validates candidate membership and applies proposal policy.
The provider cannot directly modify documents. Service failures propagate instead of
being interpreted as no-match results.

`AiProvider` remains the only AI abstraction. Provider implementations own the operations;
model selection follows the existing AI configuration. Ingestion consumes
`resolveSessionEntities` alongside its other AI dependencies. Runtime configuration and
service options do not expose an identity-judge callback. Tests substitute the provider
operation directly.

`resolveSessionEntities` accepts `{ model, references }`. Each reference carries its ID,
label, suggested type, evidence, and candidate IDs with context and provenance. The OpenAI
provider constructs its own prompt from that data; the mock reads the same typed input.
Jev implements this operation directly without parsing a generative prompt or adding
a parallel provider interface. The existing result contract and proposal policy remain
unchanged.

This refactor retains deterministic exact matches, automatic proposals when no identity
candidate exists, same-type filtering, and the ten-candidate limit. Those paths do not
all reach the judge yet. Campaign imports still use their separate conservative resolver;
this session refactor does not alter campaign-import behavior.

## Provider configuration

`createAiProvider` composes the existing AI operations. Identity resolution defaults to
`jev-latest`; all other operations retain their OpenAI models. `AiModels.entityResolution`
is independent of `sessionAnalysis`. The identity model is configured in code in
`packages/core/src/server/ai/index.ts`. Change it to an OpenAI model name to switch back,
or to a pinned Jev version for repeatable experiments. Code can also pass model overrides
to `createAiProvider`; environment variables only provide credentials.

Providers read `OPENAI_API_KEY` and `TYPESAFE_API_KEY` from `process.env` when an operation
executes. Missing credentials fail that operation through the existing `Failure` channel;
constructing the runtime does not require keys. `CoreRuntimeConfig` has no API-key fields.
Mock mode does not require either key. The web Vite configurations load these server-only
values from the root `.env`; the workflow worker already uses Node's `--env-file`.
Production uses the deployment environment. Restart development processes after editing
`.env`.

Jev sends one Choice question per reference, in batches of up to 16. Candidate options
are accompanied by `none_of_these` and `insufficient_evidence`. The provider validates
option membership, answer coverage, probability ranges, sums, and the winning choice.
It retains the returned model, full distribution, and confidence on each operation result.
Those diagnostics are not yet persisted in ingestion drafts.

The ingestion judgment step applies an initial conservative policy: the winning option
must have probability at least 0.95 and lead the next option by at least 0.20. Otherwise
it preserves uncertainty for review. These values need calibration on campaign data;
provider confidence alone does not authorize linking. No-match results use the existing
creation eligibility policy. Explicit uncertainty is not converted to an automatic link.

Requests have a 30-second batch deadline and retry transient HTTP errors up to twice
with exponential backoff. Authentication and malformed-response failures propagate;
there is no silent provider fallback. The integration uses the documented
[TypeSafe HTTP API](https://docs.typesafe.ai/api) and
[Choice primitive](https://docs.typesafe.ai/primitives/choice).

## Remaining rollout work

1. Send exact-name and alias matches through judgment rather than treating names as
   authoritative identity. Include the current automatic-creation paths in evaluation.
2. Broaden identity retrieval to preserve useful semantic candidates and spelling
   variants. A type predicted during extraction should be a retrieval hint, not a hard
   exclusion. Preserve known document types in candidate context.
3. Persist judgments for evaluation against labeled identity decisions and calibrate
   probability thresholds before expanding automatic behavior.
4. Evaluate no-match results against retrieval coverage before allowing creation.
   Missing candidates, missing evidence, provider failures, and genuinely new entities
   are different situations.
5. Use the judgment boundary in campaign imports while preserving import fingerprints,
   stable proposal IDs, and the existing user-review requirements.

The judgment step maps its legacy `create` answer to `none-of-these` for
compatibility. The current proposal policy still permits creation for eligible named
references; broader retrieval and no-match handling are rollout work, not behavior
silently changed by this refactor.

## Document-type classification

Use an operation on `AiProvider` so identity and classification can independently
choose Jev or an LLM. The existing `inferDocumentType` operation already classifies whole
documents; adapt or extend that abstraction for evidence-backed entity classification. For extracted entities, the choices should be `player`, `npc`,
`location`, `item`, `worldbuilding`, `event`, and `insufficient-evidence`. A `session`
document describes an import/session container, not an extracted campaign entity.
Classifying whole uploaded documents is a different operation and may include `session`.

Provide original evidence, entity descriptions, and relevant campaign context. In
particular, player versus NPC requires information about player control; being a
protagonist does not establish that a character is player-controlled. Define
worldbuilding as a persistent setting concept, not the default for uncertainty.

Retrieve candidates broadly, then judge identity and proposed type. Jev can answer these
as separate questions over the same state, but the questions cannot depend on one
another's outputs. If an existing entity is selected, preserve its canonical document
type. Otherwise, use classification to propose the new document's type; uncertain
classification should stay explicit for review. Event form (period versus occurrence)
is a separate dimension from document type.

Classification remains a proposed next step. Jev currently handles only the existing
session identity-resolution operation.
