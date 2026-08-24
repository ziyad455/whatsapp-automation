# Architectural decisions

## One shared Mastra server

A single application serves all businesses. This keeps deployment and operations simple while tenant authorization and data access provide isolation. Separate per-business servers would multiply cost and configuration without solving isolation by themselves.

## One shared customer-service agent

Business behavior comes from request-scoped context, rules, and tools rather than hard-coded agents per company. The agent definition is shared; tenant state is not.

## React + Vite + TypeScript dashboard

The dashboard is a client application for business configuration and operations. Server rendering and Next.js-specific capabilities are not current requirements.

## Better Auth cookie sessions

Better Auth owns platform identity, credential hashing, and server-side sessions in PostgreSQL. Mastra exposes Better Auth through `/auth/api/*`, authenticates protected requests, and places the verified user in request context. The React dashboard uses the Better Auth client with HttpOnly cookies; it does not store or authorize with browser-managed bearer tokens. Public sign-up is disabled while pilot users are provisioned through controlled server-side operations.

Authentication proves identity only. `BusinessUser` membership and role checks authorize access to a `Business`; Better Auth's organization plugin is not part of the application tenancy model.

## Explicit dashboard tenant selection

Tenant-scoped dashboard requests send `x-business-id` as an untrusted selector. After Better Auth establishes identity, the server resolves exactly one `BusinessUser` row through its `(userId, businessId)` unique key and constructs a request-scoped `TenantContext` from database-owned membership data. There is no single-membership fallback, and invalid or unauthorized selections fail closed without business enumeration. Business lifecycle status is intentionally not enforced by the resolver until its action semantics are defined.

## Mastra custom routes without Express

Mastra is the backend runtime for HTTP routes, agents, tools, and workflows. A second Express application is postponed until a concrete limitation justifies it.

## PostgreSQL as the initial system of record

PostgreSQL provides relational integrity for tenant/domain data, durable workflow and message state, migrations, transactions, auditability, and JSONB support. External systems may become authoritative for selected facts through providers later.

## Prisma for application persistence

Prisma Client is the application/domain query layer over PostgreSQL, and Prisma Migrate owns application schema history. Routes, tools, and workflows use application services or repositories rather than scattering Prisma queries across transport and AI code.

Prisma does not provide tenant authorization by itself. TenantContext and repository query scoping remain required for future tenant-owned models. Mastra runtime storage is a separate concern even if it later shares the PostgreSQL deployment.

## Typed platform data plus schema-defined JSONB

Stable cross-business concepts use typed relational models. Business-specific catalog attributes use JSONB only after validation against BusinessFieldDefinition. This avoids a table/module per vertical without turning the entire domain into unstructured documents.

## Request-time current-data retrieval

The agent retrieves volatile facts through tenant-bound tools when needed. Long-lived prompt snapshots, chat history, and model memory are not trusted for prices, availability, or other changing facts.

## Human handoff as server-side application state

Conversation control is explicit state (AI, HUMAN, or PAUSED), persisted and enforced by the server. It is not inferred independently on every turn or controlled only by UI visibility.

## Database-backed scheduled automation

Follow-ups and later campaigns use durable database records and recurring workflows rather than in-memory timers. This permits restart recovery, cancellation, inspection, and safe retry handling.

## Evidence-led expansion

The system begins as a modular application with manual/database-backed business data. Microservices, infrastructure complexity, external connectors, advanced RAG, billing automation, and new vertical features are added only after pilot or customer evidence demonstrates the need.
