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
- an internal AI playground for development/testing access;
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

## State and error presentation

Operational screens must distinguish loading, empty, stale, failed, attention-required, and unauthorized states. Failures should remain actionable without exposing internal stack traces or secrets.

## Current application shell

React Router owns client-side navigation. `/login` and `/dashboard` are placeholder pages, `/` redirects to `/login`, and unknown paths render a not-found page. Authentication guards and business layouts are intentionally deferred until their owning sprints.

## Open Questions

- The active-business selection and persistence experience for multi-business users is not yet defined.
- Dashboard information architecture, design system, and accessibility conventions beyond standard React practices have not yet been selected.
- Which AI diagnostics are exposed in the internal playground versus platform-admin tooling needs definition.
