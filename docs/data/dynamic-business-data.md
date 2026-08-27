# Dynamic business data

## Problem

A car rental, salon, gym, and tour operator have different catalogs and fields:

- a vehicle may have make, model, daily price, seats, fuel type, and availability;
- a salon service may have duration, price, category, and active state;
- a membership may have duration, access rules, and price.

Creating a Vehicle, Haircut, GymMembership, Tour, and supporting backend module for every vertical would make onboarding a new business category a code and migration project.

## Chosen model

Dynamic business catalogs use three tenant-owned concepts:

- **BusinessEntityType** — a collection definition such as vehicle, service, membership, tour, or room. It has a tenant-scoped key, name, description, schema version, and lifecycle timestamps.
- **BusinessFieldDefinition** — a field definition with a key, label, type, required flag, options where relevant, and display order.
- **BusinessEntity** — one actual record with tenant, entity type, display name, status, timestamps, and validated JSONB values.

The persisted field types are TEXT, LONG_TEXT, NUMBER, BOOLEAN, DATE, DATETIME, SELECT, and MULTI_SELECT. PostgreSQL enforces this vocabulary with an enum. `options` is SQL `NULL` when no options apply and JSONB when a SELECT or MULTI_SELECT field needs tenant-defined choices.

Prisma `Json` fields map field options and entity values to PostgreSQL JSONB. Normal entity creation resolves the tenant-owned entity type and its field definitions, validates the complete input, and only then persists it. The low-level entity write is not exposed by the public tenant repository. The ORM type alone does not make arbitrary JSON authoritative or safe.

    strong, versioned schema definitions
      + validation before persistence
      + JSONB values for each entity
      = flexible catalogs without unstructured platform data

## Example: car-rental vehicle

An entity type named Vehicle could define:

    make          TEXT          required
    model         TEXT          required
    dailyPrice    NUMBER        required
    transmission  SELECT        manual | automatic
    available     BOOLEAN       required

One BusinessEntity value could be:

    {
      "make": "Dacia",
      "model": "Sandero",
      "dailyPrice": 350,
      "transmission": "manual",
      "available": true
    }

## Example: salon service

An entity type named Service could define:

    category       SELECT       hair | nails | skincare
    durationMin    NUMBER       required
    price          NUMBER       required
    availableDays  MULTI_SELECT

One BusinessEntity value could be:

    {
      "category": "hair",
      "durationMin": 45,
      "price": 120,
      "availableDays": ["monday", "wednesday", "saturday"]
    }

Both records use the same platform models and will pass through the same validation engine, while their schemas remain business-specific.

## Example: gym membership

An entity type named Membership could define `price` as NUMBER, `durationMonths` as NUMBER, and `includesCoach` as BOOLEAN. A Monthly Premium entity can store:

    {
      "price": 300,
      "durationMonths": 1,
      "includesCoach": false
    }

Vehicle, service, and membership records all use the same BusinessEntity table; no vertical-specific persistence model is required.

## Persistence and ownership guarantees

Entity-type keys are trimmed, normalized to lowercase, and unique within a business. Field keys are unique within an entity type. BusinessEntity stores a relational tenant, entity type, display name, ACTIVE or ARCHIVED status, timestamps, and its variable attributes in one JSONB `data` column.

Normal access uses services and a repository bound to TenantContext. Create inputs cannot select `businessId`, and reads and lists always include the bound business. BusinessFieldDefinition inherits ownership from its entity type rather than duplicating `businessId`. BusinessEntity retains direct `businessId` for efficient scoping, while a composite foreign key requires `(businessId, entityTypeId)` to reference an entity type owned by that same business.

Normal catalog retirement uses BusinessEntity's ARCHIVED state; the repository intentionally exposes no delete operation. Physical deletion of a Business or BusinessEntityType is an administrative teardown operation and cascades to its dependent dynamic records so it cannot leave orphaned schemas or entities.

The dashboard consumes this model through one generic entity-type manager, list/detail flow, schema editor, and `DynamicFormRenderer`. Record updates are revalidated against the current enabled schema, then merge back only values belonging to fields that are now disabled. This preserves historical values without letting the browser resubmit or silently rewrite them.

## Validation and querying

- Validation is strict and does not coerce values. TEXT and LONG_TEXT require strings, NUMBER requires a finite number, BOOLEAN requires a boolean, DATE uses `YYYY-MM-DD`, and DATETIME requires an offset-aware ISO-8601 value.
- SELECT requires one configured option. MULTI_SELECT requires an array containing only configured values and rejects duplicates.
- Missing or empty required text fields, unknown fields, malformed values, and disabled fields in new input produce structured field/code/message errors. Optional enabled fields may be omitted. Historical JSON is not rewritten when a field is disabled.
- Generic queries resolve a normalized entity-type key inside the tenant, search names case-insensitively, default to ACTIVE records, and validate every JSONB filter against enabled field definitions.
- Equality filters support TEXT, NUMBER, BOOLEAN, DATE, DATETIME, and SELECT. MULTI_SELECT supports one contains-value filter. LONG_TEXT filtering and arbitrary JSON paths or expression trees are intentionally unsupported.
- Results default to 25 records, allow at most 100, and use a validated offset capped at 10,000. Query values become one parameterized JSONB containment object; field names or values are never interpolated into SQL.
- The query-shaped relational index covers `(business_id, entity_type_id, status)`. A generic `jsonb_path_ops` GIN index supports the implemented `data @>` containment predicate; no per-vertical or per-field indexes exist.
- Future tool results should expose a small, relevant projection rather than raw JSONB or internal metadata.

## Schema evolution

Field keys are immutable machine identities; labels and display order are editable presentation metadata. BusinessFieldDefinition has an `enabled` flag so a field can stop accepting new values while historical JSON remains intact. Adding an optional field, changing a label or order, disabling a field, and adding select options are safe operations.

The schema service rejects adding or enabling a required field when existing entities would be invalid. It also rejects removing an option that existing values use and changing a field type while stored entities contain that key. There is no universal key rename, value rewrite, or type-conversion engine in the MVP.

Every successful field addition or field-definition update increments BusinessEntityType `schemaVersion` once. The field change and version increment share one PostgreSQL transaction, while rejected changes leave both schema and version untouched. Initial template schemas start at version 1.

## Templates and customization

CAR_RENTAL, SALON, and GYM templates are declarative TypeScript data that create starter entity types and field definitions owned by the target tenant. Application reads the tenant business category; callers do not choose ownership. If the matching entity-type key already exists, reapplication skips it without modifying or duplicating the tenant's schema. After creation, all fields are ordinary customizable business data and no runtime vertical branch enforces the template.

## Open Questions

- Does each BusinessEntity record retain the schema version against which its JSONB was last validated?
- A future cursor-based pagination strategy may replace bounded offsets if catalog size or measured query cost requires it.
