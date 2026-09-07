# Dashboard architecture

dashboard/ is the React + Vite + TypeScript application for business owners and staff. It presents product and business state, not Mastra internals.

## Responsibilities

- authentication screens and protected navigation;
- authorized business selection when a user has access to more than one business;
- business profile, languages, currency, timezone, and opening-hours management;
- deterministic business-rule management;
- dynamic entity-type inspection and schema-driven forms;
- create, edit, inspect, and archive business entities;
- a human-readable preview of what the system currently knows;
- a persistent customer-service conversation channel backed by the shared runtime;
- conversation inbox, attention queue, detail view, mode controls, and manual replies;
- lead, follow-up, customer-history, campaign, and analytics views;
- later onboarding, staff roles, synchronization health, and platform administration.

Mastra Studio remains a developer tool. Business users should not see agent traces, raw prompts, tool payloads, provider internals, or technical cost details unless a specific product/operator surface calls for them.

## Boundary with the server

The dashboard:

- sends validated application requests;
- renders server-authorized state;
- provides accessible forms and explicit user actions;
- may optimistically improve interaction only when server state remains authoritative.

The dashboard does not:

- authorize membership or tenant access;
- enforce conversation modes by itself;
- query PostgreSQL directly;
- hold Meta or LLM secrets;
- invoke unrestricted AI tools;
- schedule durable automation;
- decide that an external action succeeded before the server/provider confirms it.

## Dynamic forms

BusinessFieldDefinition drives supported inputs, labels, required state, options, and ordering. A configured field should appear without a vertical-specific React form.

Client validation improves usability, but the server revalidates every payload against the current tenant schema.

`DynamicFormRenderer` is the single React control mapping for TEXT, LONG_TEXT, NUMBER, BOOLEAN, DATE, DATETIME, SELECT, and MULTI_SELECT. Create and edit screens load the current entity-type schema before rendering. Disabled fields are omitted from new forms; edit requests omit them while the server preserves historical values. The entity manager and schema editor use generic entity-type keys and never branch on business category.

## State and error presentation

Operational screens must distinguish loading, empty, stale, failed, attention-required, and unauthorized states. Failures should remain actionable without exposing internal stack traces or secrets.

## Current application shell

React Router owns client-side navigation. `/login` uses the Better Auth React client for email/password sign-in, `/dashboard` is session-guarded and supports sign-out, `/` redirects to `/login`, and unknown paths render a not-found page. Session cookies remain HttpOnly and are never copied into React state or browser storage. The route guard improves navigation and loading behavior; the server remains the authorization boundary.

The dashboard uses a compact operational layout with profile, opening-hours, rules, dynamic-data, schema-editor, business-understanding, and agent-chat routes. The agent-chat screen loads the authenticated user's tenant-bound dashboard conversation, sends its server-issued conversation ID on later turns, renders persisted customer and assistant messages, and may show safe `AgentResult` metadata for new replies. The browser does not supply history or authorization: the server authorizes the conversation and loads bounded recent history before invoking the shared runtime. Prompts, tool payloads, and `TenantContext` are never exposed.

Development builds also expose an authenticated AI playground. It uses the active authorized business, a separate persisted dashboard conversation, and the same shared conversation and agent runtime. It may show application-owned intent/handoff metadata, scope/bypass decisions, and safe tool name/outcome/freshness summaries, but never raw tool inputs or outputs, tenant identifiers, prompts, provider payloads, or secrets. Resetting the simulator deletes only that tenant-bound playground thread. The route and navigation are absent from production builds.

A centralized credentialed API client adds `x-business-id` only after the user explicitly selects an accessible business. The selection may be remembered locally for navigation continuity, but every request is independently authorized by the server. Server error details are mapped to accessible form messages without exposing internal errors.

## Open Questions

- Whether active-business selection should be synchronized across devices is not yet defined; the current preference is browser-local.
- The current operational visual system is intentionally small and CSS-based; the threshold for extracting a reusable component library is not yet defined.
- Which AI diagnostics belong in business-facing conversation views versus platform-admin tooling needs definition.
