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

The initial field types are TEXT, LONG_TEXT, NUMBER, BOOLEAN, DATE, DATETIME, SELECT, and MULTI_SELECT.

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

Both records use the same platform models and validation engine, but their schemas remain business-specific.

## Validation and querying

- Validate required fields, supported types, dates, numeric values, and select options before persistence.
- Reject unknown or malformed values according to the schema policy.
- Queries may filter by entity type, name/text, active state, and safe simple field predicates.
- Add only indexes justified by expected query patterns; optimize further using measured production paths.
- Tool results should expose a small, relevant projection rather than raw JSONB or internal metadata.

## Schema evolution

Supported changes include adding fields, renaming labels, changing display order, updating allowed options safely, and disabling fields. Removed catalog records should normally be archived.

Destructive field-type changes must not reinterpret or silently corrupt existing JSONB. Schema versioning records the definition version, but migration and compatibility behavior must be chosen explicitly before destructive changes are supported.

## Templates and customization

CAR_RENTAL, SALON, and GYM templates provide starter entity types and fields. A template is copied into tenant-owned configuration and remains customizable; it is not a permanent vertical branch in source code.

## Open Questions

- Does each BusinessEntity record retain the schema version against which its JSONB was last validated?
- When select options are removed or field types change, are old values grandfathered, migrated, hidden, or rejected until repaired?
- Which JSONB filter operators and index patterns are supported initially must follow actual query requirements rather than being assumed here.
