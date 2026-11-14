# TerraTwin Catalog

## Purpose

Provides the catalog metadata required by the TerraTwin frontend.

The catalog supports three website interactions:

1. Selecting a target world.
2. Selecting a target region within that world.
3. Selecting terrain features for analog discovery.

It also exposes the available Earth reference regions.

## SQL source

`queries/api/get_catalog.sql`

## Execution

Run from the repository root:

```bash
duckdb -c ".read queries/api/get_catalog.sql"