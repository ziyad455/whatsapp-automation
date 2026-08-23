# Multi-tenancy

One application, Mastra runtime, database deployment, and shared agent serve many businesses. Isolation is an application and data invariant, not a prompt instruction.

> One business must never be able to access another business's customers, conversations, rules, entities, messages, leads, follow-ups, campaigns, analytics, or other tenant data.

## Tenant root and tenant-owned data

Business is the tenant root. User is a platform identity and may be related to businesses through BusinessUser. Records owned by a business carry or are constrained by businessId, including customers, business configuration, dynamic schemas and entities, conversations, messages, leads, follow-ups, campaigns, and operational data attributable to that tenant.

A relation to a tenant-owned parent must belong to the same business. For example, a message cannot claim Business A while referencing Business B's conversation. This invariant should be enforced as close to persistence as the chosen schema permits and covered by isolation tests.

## TenantContext

TenantContext is the trusted request-scoped authorization boundary. Conceptually it identifies:

- the resolved businessId;
- how the tenant was resolved, such as authenticated dashboard membership or a WhatsApp connection;
- the actor and role when a user is involved;
- request correlation information where needed.

The exact TypeScript shape is an implementation decision. The invariant is that protected tenant services and repositories require a resolved context rather than accepting arbitrary business IDs throughout normal application code.

## Dashboard resolution

1. Authenticate the user.
2. Resolve the intended business through BusinessUser membership.
3. Verify membership and action permissions on the server.
4. Construct TenantContext.
5. Execute all tenant-owned work through that context.

A route parameter, header, token claim, or UI selection can identify the requested business, but none is authorization without membership validation.

## WhatsApp resolution

1. Validate the Meta webhook boundary.
2. Read the receiving Meta phoneNumberId from the normalized event.
3. Resolve a WhatsAppConnection that maps it to exactly one business.
4. Construct TenantContext before reading customer or business data.

The sender's phone number identifies a customer only inside the resolved business; it does not select the tenant.

## AI and tools

> The AI must never be trusted to select businessId.

Tools are constructed or bound with the already-authorized TenantContext. Model-visible tool input contains only business-domain search parameters, never an unrestricted tenant selector. Prompt instructions supplement but never replace repository authorization.

## Required tests

Isolation tests must cover direct IDs, nested relations, lists and filters, dynamic JSONB entities, AI tools, conversations/messages, leads/follow-ups, analytics, and attempts to influence tenant selection through prompts.

## Open Questions

- How does a dashboard user with memberships in several businesses select and persist the active membership?
- Which database constraint strategy will prevent cross-business parent/child relationships while retaining useful direct businessId scoping?
- Production platform-admin access requires a privileged context distinct from normal tenant access; its exact authorization model is not yet defined.
