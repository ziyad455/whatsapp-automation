# AI architecture

## Shared agent

The platform uses one shared Mastra customer-service agent definition for all businesses. It does not create hard-coded agents or source branches per tenant.

The implemented agent has the stable Mastra ID `customer-service` and is registered once. Its base instructions and model are tenant-neutral. Application code invokes it through `runCustomerServiceAgent`, which builds current stable configuration and bounded history, then creates a fresh validated Mastra `RequestContext` for every run. One generic read tool, `readBusinessFacts`, retrieves current data; persistent memory remains disabled.

    authorized request
      -> TenantContext
      -> runtime BusinessContext
      -> shared agent
      -> tenant-bound tools
      -> current business data
      -> structured result

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

Language matching never weakens validation, authorization, tool scoping, or handoff behavior.

## Provider boundary

The external LLM provider is an implementation dependency, not the owner of domain behavior or data. Provider-specific request/response code should remain behind the AI runtime boundary so evaluations, tools, and application workflows do not depend unnecessarily on one provider.

## Structured result

The application receives a strict Zod-validated `AgentResult`: `reply`, `needsHuman`, `detectedIntent`, `reasonCode`, and `detectedLanguage`. The schema lives in `server/src/ai/agent-result.ts`; there is no confidence estimate or reasoning field.

Mastra 1.61 uses per-run `instructions` and `structuredOutput` with strict validation. Explicit schema prompt injection is the supported single-model compatibility path for tool calling plus structured output; the application consumes `result.object`, never regex-parsed reply prose. Internal `factReferences` are checked against this run's tool receipts and removed before returning AgentResult. Unknown references, confident price/availability answers without fresh entity evidence, and unverified references without uncertainty metadata fail closed. A structurally valid answer can still be semantically wrong; live model evaluations complement these deterministic checks.

Each run has a six-step limit, a 60-second model deadline, a 2,000-output-token budget, and at most eight tool reads. Invalid output, provider failure, or context-budget failure rejects the invocation; callers must not send a partial answer. No WhatsApp transport or handoff action runs here.

Downstream logic should not parse free-form prose to decide intent or handoff. Model-generated confidence or reasoning labels are not authorization and should not be the sole gate for risky actions.

## Failure posture

Unknown or stale facts produce an explicit safe outcome. Provider failure should preserve the inbound message, avoid sending low-quality fallback text as if it were valid, and route the conversation to human attention where appropriate.

## Evaluation

The shared agent must be evaluated across genuinely different tenant schemas and across target languages. Evaluation covers grounded facts, absent facts, multi-turn behavior, handoff, prompt injection, and cross-tenant attempts. See [testing strategy](../engineering/testing-strategy.md).
