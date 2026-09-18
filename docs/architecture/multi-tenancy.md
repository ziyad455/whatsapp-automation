# Multi-tenancy

One application, Mastra runtime, database deployment, and shared agent serve many businesses. Isolation is an application and data invariant, not a prompt instruction.

> One business must never be able to access another business's customers, conversations, rules, entities, messages, leads, follow-ups, campaigns, analytics, or other tenant data.

## Tenant root and tenant-owned data

Business is the tenant root. User is a platform identity and may be related to businesses through BusinessUser. Records owned by a business carry or are constrained by businessId, including customers, business configuration, dynamic schemas and entities, conversations, messages, leads, follow-ups, campaigns, and operational data attributable to that tenant.

A relation to a tenant-owned parent must belong to the same business. For example, a message cannot claim Business A while referencing Business B's conversation. This invariant should be enforced as close to persistence as the chosen schema permits and covered by isolation tests.

## TenantContext

TenantContext is the trusted request-scoped authorization boundary. For authenticated dashboard requests its current TypeScript shape is:

    {
      userId: string;
      businessId: string;
      membershipId: string;
      role: BusinessUserRole;
    }

Mastra stores this object under the typed `tenant` key in its request-scoped `RequestContext`. The request ID remains a separate correlation value. The WhatsApp boundary constructs a machine-to-machine `WhatsAppTenantContext` containing only the trusted business and connection IDs after signature validation and `WhatsAppConnection` lookup. It does not reuse the dashboard membership resolver or accept a sender-selected tenant. That trusted context resolves the tenant-owned Customer and persistent Conversation before the shared runtime or manual transport path can execute.

The invariant is that protected tenant services and repositories require a resolved context rather than accepting arbitrary business IDs throughout normal application code.

## Tenant-scoped data access

Normal tenant-owned persistence APIs accept `TenantContext`, bind `tenant.businessId` once, and derive ownership filters and create data internally. Create DTOs exclude ownership fields; reads, updates, and deletes combine the record identifier with the bound business ID in the Prisma query. A direct ID from a route, model, or tool therefore cannot change the tenant scope.

The centralized Prisma Client remains an infrastructure primitive for migrations, maintenance, trusted provisioning, and explicit system repositories. It is not the normal application API for tenant-owned records. `Business` is the tenant root and may be accessed by explicit system/bootstrap operations. `BusinessUser` also has a necessary pre-context exception: dashboard tenant resolution must query `(authenticated userId, selected businessId)` before a `TenantContext` can exist. Post-resolution membership access uses the tenant-bound repository instead.

Dynamic business data follows this boundary through TenantContext-bound repositories and services. Validation loads definitions only through an owned entity type; queries resolve type keys inside the bound tenant; schema changes scope the field through its parent; and templates derive ownership and category from the tenant business. BusinessEntity adds database defense in depth: its `(business_id, entity_type_id)` foreign key can reference only an entity type with the same `business_id`, so a raw or buggy write cannot create a cross-business parent relationship.

## Dashboard resolution

1. Authenticate the user through the Better Auth server-side session.
2. Resolve the intended business through BusinessUser membership.
3. Verify membership and action permissions on the server.
4. Construct TenantContext.
5. Execute all tenant-owned work through that context.

A dashboard request selects its business with the `x-business-id` header. The header is only a selector: the server takes `userId` from the verified Better Auth session, queries the unique `(userId, businessId)` `BusinessUser` membership, and takes `membershipId` and `role` from that database row. Client-supplied user, membership, role, or request-context values are discarded. Missing selection fails with a clear 400 response; malformed, unknown, and non-member selections share the same 403 response so the endpoint does not reveal whether another business exists.

The authenticated Better Auth user ID is the platform identity used to query `BusinessUser`. A valid session never implies access to every business, and the browser's protected-route guard is navigation UX rather than an authorization boundary. There is no implicit single-membership fallback: every tenant-scoped dashboard request selects a business explicitly.

The authenticated `/businesses` route lists memberships before TenantContext resolution so the user can make that explicit selection. It returns only businesses joined through the verified user's memberships. Remembering a prior browser selection is a client preference, not authorization; the server repeats the membership lookup on every tenant-owned request.

## WhatsApp resolution

1. Validate the Meta webhook boundary.
2. Read the receiving Meta phoneNumberId from the normalized event.
3. Resolve a WhatsAppConnection that maps it to exactly one business.
4. Construct the trusted WhatsAppTenantContext before reading customer or business data.
5. Resolve or create the sender as a Customer inside that business.

The sender's provider-normalized numeric phone value is preserved unchanged and identifies a customer only inside the resolved business; it does not select the tenant. PostgreSQL enforces uniqueness on `(businessId, whatsappPhone)`, not on the phone globally.

## AI and tools

> The AI must never be trusted to select businessId.

Tools are constructed or bound with the already-authorized TenantContext. Model-visible tool input contains only business-domain search parameters, never an unrestricted tenant selector. Prompt instructions supplement but never replace repository authorization.

The shared agent is a stateless definition. Each invocation receives a new Mastra RequestContext whose required `tenant` value is validated against the canonical TenantContext shape. The agent is never mutated with a current business, tenant identifiers are not interpolated into its system prompt, and missing trusted context fails closed before an LLM request.

BusinessContext is a public configuration projection built after TenantContext resolution; it cannot select the tenant. A server-created run capability supplies the tool's provider and checks all tenant identity fields on access. Client JSON cannot forge that capability. Canonical thread persistence uses direct business ownership and same-business composite relations; every history read includes the trusted business and conversation ID. Only a bounded recent subset is accepted by the agent. See [agent context](../ai/agent-context.md).

## Required tests

Isolation tests must cover direct IDs, nested relations, lists and filters, dynamic JSONB entities, AI tools, conversations/messages, leads/follow-ups, analytics, and attempts to influence tenant selection through prompts.

Every new tenant-owned model must add regression coverage for own-tenant reads, exact-ID cross-tenant reads, tenant-only lists, cross-tenant updates and deletes with no side effects, and create/update ownership spoofing. Models scheduled for later sprints add these cases when their persistence path is introduced; placeholder models or fake coverage are not acceptable.

## Open Questions

- Whether active-business preference should later be stored server-side for cross-device continuity remains open; the current browser-local preference never bypasses request authorization.
- Should `INACTIVE` or `SUSPENDED` businesses be rejected during tenant resolution, or should lifecycle checks remain action-specific? Current resolution authorizes membership only until those semantics are defined.
- Which later tenant-owned parent/child relationships should adopt composite foreign keys like the implemented BusinessEntity-to-BusinessEntityType constraint, and which should use another database invariant?
- Production platform-admin access requires a privileged context distinct from normal tenant access; its exact authorization model is not yet defined.
