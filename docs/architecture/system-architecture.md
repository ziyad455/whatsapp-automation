# System architecture

## Components

    Customer
      -> WhatsApp
      -> Meta WhatsApp Cloud API
      -> Mastra server
           -> Meta verification or Better Auth cookie authentication
           -> tenant resolution and domain services
           -> shared agent and tenant-bound tools
           -> workflows and external transports
           -> repositories -> Prisma Client -> PostgreSQL
      -> Meta WhatsApp Cloud API
      -> Customer

    Owner or staff
      -> React + Vite dashboard
      -> Mastra server
      -> repositories -> Prisma Client -> PostgreSQL and external services

The browser never accesses PostgreSQL or Meta credentials directly. The shared agent never bypasses application services to obtain tenant data.

## Dashboard boundary

dashboard/ presents authenticated business configuration and operations: dynamic data, conversations, handoff, leads, follow-ups, and analytics. It sends application requests and renders domain state. It does not own authorization, workflow scheduling, WhatsApp transport, or AI safety.

## Server boundary

server/ is the application backend and Mastra runtime. Better Auth and its Mastra bridge own user authentication and cookie sessions; application membership checks own tenant authorization. The server also owns request validation, tenant resolution, domain behavior, persistence, the shared agent, tools, workflows, webhook handling, external providers, and operational safeguards.

Application services and repositories use the centralized Prisma Client as their typed query layer. They do not expose Prisma directly to the dashboard or treat ORM queries as authorization.

## PostgreSQL boundary

PostgreSQL is the initial system of record for business configuration, typed domain records, dynamic entity schemas and values, conversation history, automation state, audit information, idempotency keys, and delivery outcomes. Future external systems may become authoritative for specific facts through a provider abstraction.

## Why no separate Express application

Mastra already provides the runtime in which custom application routes, agents, tools, and workflows can operate. Adding Express now would create another HTTP boundary, lifecycle, and configuration surface without a demonstrated requirement. Introduce it only if a concrete capability cannot be served cleanly by the chosen Mastra server architecture.

## Scaling posture

The current architecture is a modular application, not a set of microservices. Module boundaries and provider interfaces should be clear, but deployment complexity should follow measured pilot and production needs.
