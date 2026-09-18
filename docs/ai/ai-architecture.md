# AI architecture

## Shared agent

The platform uses one shared Mastra customer-service agent definition for all businesses. It does not create hard-coded agents or source branches per tenant.

The implemented agent has the stable Mastra ID `customer-service` and is registered once. Its base instructions and model are tenant-neutral. Channel adapters invoke `runCustomerServiceConversation` with trusted tenant and conversation identity; it persists messages, loads bounded authorized history, and delegates to `runCustomerServiceAgent`. The agent invocation builds minimal identity/routing configuration and creates a fresh validated Mastra `RequestContext` for every run. Six narrow read tools retrieve current profile, hours, active rules, dynamic types, entity search results, and exact entities; global or model-owned persistent memory remains disabled.

    authorized request
      -> TenantContext
      -> authorized Conversation
      -> bounded persisted history
      -> runtime BusinessContext
      -> shared agent
      -> tenant-bound tools
      -> current business data
      -> model text reply
      -> application-owned AgentResult

Channel adapters own authentication, tenant resolution, and channel conversation identity before this flow. The dashboard simulation adapter uses a verified Better Auth session, authorized membership selection, and authenticated user participant. The WhatsApp adapter uses a verified Meta event, receiving `phoneNumberId`, and tenant-owned customer identity. Neither channel duplicates agent logic or supplies tenant identity through model-visible input. The staff inbox reads and controls that same persistent WhatsApp conversation rather than creating another dashboard transcript.

The agent definition may be long-lived, but tenant context, tool bindings, and conversation input are request-scoped. Mutable business state must never be stored globally on the shared agent.

Tenant identifiers are runtime authorization data, not model instructions. Neither base nor generated instructions interpolate `businessId`, `membershipId`, or `userId`. The tool requires a server-created run capability containing the tenant-bound provider. Serialized client context cannot construct this capability. It is closed after execution and carries no state into the next run.

## Dynamic business behavior

Behavior is assembled from:

- authorized business identity and stable configuration;
- active deterministic business rules;
- language preferences;
- relevant bounded conversation context;
- current facts retrieved through tools;
- application-level handoff and safety rules.

Changing business configuration should change the next relevant behavior without deploying a new agent.

## Multilingual behavior

The target conversation styles are Moroccan Darija, Arabic, French, English, and mixed-language messages. The agent should normally respond naturally in the customer's language or style while preserving business policy and fact-grounding rules.

The customer-facing voice is a concise business staff member, not a system operator. Fresh facts are stated directly without narrating tools, databases, records, provider metadata, or verification mechanics. Simple questions receive short paragraphs; lists are reserved for several options, repeated field labels are avoided, and generic support closers are not appended automatically. Missing or stale facts still receive brief natural uncertainty and staff-confirmation language. This is a presentation rule only: trusted tool receipts and application-owned routing metadata continue to determine safety.

Language matching never weakens validation, authorization, tool scoping, or handoff behavior.

## Provider boundary

The external LLM provider is an implementation dependency, not the owner of domain behavior or data. Provider-specific request/response code should remain behind the AI runtime boundary so evaluations, tools, and application workflows do not depend unnecessarily on one provider.

## Structured result

The application receives a strict Zod-validated `AgentResult`: `reply`, `needsHuman`, `detectedIntent`, `reasonCode`, and `detectedLanguage`. The schema lives in `server/src/ai/agent-result.ts`; there is no confidence estimate or reasoning field. The model produces only the customer-facing text reply. It does not own this application contract.

`runCustomerServiceAgent` consumes Mastra's plain `result.text`, normalizes its length, and constructs metadata from the current customer input plus application-observed tool outcomes. Explicit human requests are detected from customer input; missing, unavailable, stale, and fresh-fact states come from the run-local tool capability. Conservative `UNKNOWN` and `other` values are used when intent or language cannot be determined safely. Assistant prose is never parsed to decide routing or handoff, and a model cannot set `needsHuman` by printing a label. When current information lacks fresh evidence, application code replaces the untrusted reply with a deterministic localized confirmation message. The final object is validated at the application boundary.

Each run has a six-step limit, a 60-second model deadline, a 2,000-output-token budget, and at most eight tool reads. An absent text reply, provider failure, or context-budget failure rejects the invocation; model-native structured-output variability does not. No WhatsApp transport or handoff action runs here.

Downstream logic consumes only the validated metadata and must not parse free-form reply prose to decide intent or handoff. Model-generated confidence or reasoning labels are not authorization and cannot gate risky actions.

## Customer-service scope boundary

Application code classifies the validated current message before provider generation. Clearly unrelated requests receive `detectedIntent: OUT_OF_SCOPE`, `reasonCode: OUT_OF_SCOPE`, no human handoff, and a short localized business-scope reply assembled from the authorized business identity. The model and business-information tools are bypassed for that turn. This prevents general-purpose answers and makes the routing result independent of prompt compliance or model-native structured output.

The scope gate uses positive customer-service intent and business-relation signals rather than a large blacklist. It also recognizes bounded referential follow-ups only when authorized recent business conversation exists. For partially related requests, unsupported clauses are removed before generation and the supported business portion continues through the normal shared agent and tenant-bound tools. The original customer message remains persisted conversation evidence; only the model-visible current message is narrowed. Prompt instructions repeat the boundary as defense in depth and prevent old unrelated turns from being revived.

Installed Mastra input/output processors remain available for moderation, injection detection, redaction, and retry use cases. The current prompt-injection detector is LLM-based and its blocking path aborts generation, so it is not the primary customer-scope router: adding another probabilistic call would not produce the required deterministic natural `AgentResult`. Safe playground diagnostics expose only scope, whether generation was bypassed, partial-input handling, and bounded tool summaries.

## Failure posture

Unknown or stale facts produce an explicit safe outcome. Provider failure should preserve the inbound message, avoid sending low-quality fallback text as if it were valid, and route the conversation to human attention where appropriate.

## Evaluation

The shared agent must be evaluated across genuinely different tenant schemas and across target languages. Evaluation covers grounded facts, absent facts, multi-turn behavior, handoff, prompt injection, and cross-tenant attempts. See [testing strategy](../engineering/testing-strategy.md).

The stable Sprint 8 corpus lives outside production source under `server/evaluations/`. Deterministic regression exercises application-owned classification, bounded history, hallucination refusal, tenant isolation, and safe tool diagnostics. A separate explicit live-provider runner applies the same corpus to model behavior; provider quota or availability failures remain visible and are not converted into passing results.
