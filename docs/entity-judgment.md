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

Jev integration should implement the identity operation through `AiProvider`. Its current
input is a generative prompt; a structured request should become the operation's input
when adding Jev, with prompt construction moved into the generative provider. This avoids
requiring Jev to parse an LLM prompt or creating a parallel provider interface.

This refactor retains deterministic exact matches, automatic proposals when no identity
candidate exists, same-type filtering, and the ten-candidate limit. Those paths do not
all reach the judge yet. Campaign imports still use their separate conservative resolver;
this session refactor does not alter campaign-import behavior.

## Jev rollout

Before enabling Jev, make the following behavioral changes explicitly and evaluate them:

1. Send exact-name and alias matches through judgment rather than treating names as
   authoritative identity. Include the current automatic-creation paths in evaluation.
2. Broaden identity retrieval to preserve useful semantic candidates and spelling
   variants. A type predicted during extraction should be a retrieval hint, not a hard
   exclusion. Preserve known document types in candidate context.
3. Implement Jev through the existing AI provider operation with structured input. Keep its raw Choice
   distribution, returned model version, and request metadata for evaluation. Put the
   probability/margin policy in application code, not in the HTTP transport. Report
   ambiguous distributions as insufficient evidence.
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

Classification is a proposed next step; no additional classification calls or Jev API
calls are enabled by the current refactor.
