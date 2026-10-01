# Business authorization

Dashboard identity comes from a verified Better Auth session. The selected business header is an untrusted selector; the membership lookup supplies the business, membership, user and role in `TenantContext`. Caller-provided roles and ownership fields never authorize an action.

`server/src/tenancy/business-permissions.ts` defines the typed permission matrix and `requireBusinessPermission`. A denied action throws `ApplicationError` with `FORBIDDEN` and HTTP 403. Sensitive service methods check permissions before database reads, validation or provider requests, so direct service calls have the same restrictions as HTTP handlers.

| Action | OWNER | STAFF | Enforcement |
| --- | --- | --- | --- |
| Read profile, rules, hours, catalog and customer history | Yes | Yes | Resolved membership plus tenant-scoped queries |
| Change profile, rules or hours | Yes | No | Configuration service permission guards |
| Create entity types, change fields or apply business templates | Yes | No | Catalog, schema and template service guards |
| Maintain entity records, archive/restore and verify facts | Yes | Yes | Membership plus tenant-bound entity service |
| View campaigns and preview eligibility | Yes | Yes | Membership plus tenant-scoped campaign reads |
| Create, prepare, launch or cancel campaigns | Yes | No | Campaign service and route permission guards |
| Read follow-ups and update customer follow-up consent | Yes | Yes | Tenant-scoped lead/customer queries and consent guard |
| Change follow-up scheduling configuration | Yes | No | Follow-up service and route permission guards |
| Read conversations, send replies, take over, pause or return to AI | Yes | Yes | Membership, tenant-scoped conversation and version checks |
| Manage leads, including WON/LOST | Yes | Yes | Membership, tenant-scoped lead and concurrent-update checks |
| Record customer outcomes and marketing preferences/opt-outs | Yes | Yes | Lifecycle/preference service permission guards and owned relations |
| View operational analytics | Yes | Yes | Tenant-scoped reporting queries |
| Change integrations or administer business membership | Yes | No | Reserved permissions; no dashboard mutation route exists |

Catalog records are operational data. Catalog schemas and business instructions affect the shared agent's behavior and are owner configuration. No extra roles are introduced. Permission checks supplement tenant scoping; an owner cannot access a different business through an exact record ID.

Integration setup and membership creation are currently explicit operator/bootstrap operations. The WhatsApp connection repository has a raw-business-ID creation API used by setup scripts and test fixtures, not a dashboard endpoint. Any future dashboard integration or membership write must resolve membership and enforce `INTEGRATION_WRITE` or `MEMBER_ADMINISTRATION` before calling those infrastructure APIs. Verified phone-number lookup is deliberately pre-tenant infrastructure; outbound connection lookup checks both connection and business.

## Audited tenant boundaries

Customer resolution uses `(businessId, whatsappPhone)`. Conversation and lead reads/mutations combine trusted business scope with requested IDs. Follow-ups scope both business and lead; preference writes validate the owned customer before cancelling pending work. Campaigns, recipients, lifecycle histories, segment selection and analytics use business scope, including nested history filters. Lifecycle lead/conversation references must also belong to the specified customer. Existing conversation/lead HTTP tests, tenant-data tests, follow-up tests and analytics tests cover hostile selectors; reactivation regression cases also assert foreign customer and campaign mutations leave records unchanged.

System workers and verified inbound adapters receive a transport-derived `TenantScope`; they do not impersonate a dashboard role. Their lifecycle and send-policy checks remain separate from owner authorization. Raw bootstrap/system queries are not browser authorization entry points.

## Outcome retries

Lifecycle creation accepts an optional UUID `requestKey`. The database uniquely scopes it to a business. Reusing it with the same customer and normalized payload returns the original event; changed payloads return 409. Event creation and conversion attribution commit in one transaction. Requests without a key remain separate factual events. The customer form retains its key after failed submissions and read-back failures; changing the submitted payload or completing the operation starts a new request.

Campaign attribution selects the latest eligible sent recipient even when already attributed. Its conditional update therefore does not fall through to an older campaign on a repeated callback. Conversion attribution also validates the lifecycle event's business, customer and timestamp before mutation.

Campaign preparation claims the DRAFT-to-READY transition conditionally inside the recipient-snapshot transaction. Concurrent preparation, launch or cancellation cannot unconditionally overwrite another operation's campaign state.
