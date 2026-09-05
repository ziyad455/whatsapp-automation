# AI architecture

## Shared agent

The platform uses one shared Mastra customer-service agent definition for all businesses. It does not create hard-coded agents or source branches per tenant.

The implemented agent has the stable Mastra ID `customer-service` and is registered once. Its base instructions and model are tenant-neutral; it has no persistent memory and no agent-bound tools at this stage. Application code invokes it through `runCustomerServiceAgent`, which creates a fresh validated Mastra `RequestContext` from the already-authorized `TenantContext` for every run.

    authorized request
      -> TenantContext
      -> runtime BusinessContext
      -> shared agent
      -> tenant-bound tools
      -> current business data
      -> structured result

The agent definition may be long-lived, but tenant context, tool bindings, and conversation input are request-scoped. Mutable business state must never be stored globally on the shared agent.

Tenant identifiers are runtime authorization data, not model instructions. The shared base prompt never interpolates `businessId`, `membershipId`, or `userId`. S7 tools will receive the trusted runtime context through server-side binding rather than model-visible tenant arguments.

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

The application should receive structured information such as:

- reply;
- needsHuman;
- detectedIntent;
- optional labels useful for evaluation or triage.

Downstream logic should not parse free-form prose to decide intent or handoff. Model-generated confidence or reasoning labels are not authorization and should not be the sole gate for risky actions.

## Failure posture

Unknown or stale facts produce an explicit safe outcome. Provider failure should preserve the inbound message, avoid sending low-quality fallback text as if it were valid, and route the conversation to human attention where appropriate.

## Evaluation

The shared agent must be evaluated across genuinely different tenant schemas and across target languages. Evaluation covers grounded facts, absent facts, multi-turn behavior, handoff, prompt injection, and cross-tenant attempts. See [testing strategy](../engineering/testing-strategy.md).
