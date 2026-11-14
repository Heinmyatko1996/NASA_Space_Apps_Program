# TerraTwin Reference Regions

## Purpose

Returns the available Earth reference regions for the
analog discovery workflow.

A reference region supplies the candidate terrain cells
against which target-world cells are compared.

## SQL source

`queries/api/get_reference_regions.sql`

## Execution

Run from the repository root:

```bash
duckdb -c ".read queries/api/get_reference_regions.sql"