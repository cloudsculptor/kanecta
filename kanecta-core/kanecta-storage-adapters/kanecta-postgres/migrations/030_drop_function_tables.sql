-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections): retire the four
-- bespoke function tables. A function is now projected to obj_<function-type>
-- like every other type (the four-table law): its scalar contract lives on
-- obj_<function-type>, and its parameters / generic type parameters / declared
-- throws / bundleHash are `parameter` / `type-parameter` / `function-throw` /
-- `property` child items (each with its own obj_ projection). readFunctionJson /
-- writeFunctionJson reassemble the nested payload from the projection plus those
-- ordered children — nothing reads or writes these tables any more.
--
-- Backfill note: on Postgres a function's implementation lives inline (the `body`
-- column) rather than in an on-disk bundle, and PG-hosted functions are rare, so
-- no data backfill ships here. Any deployment that DID store function rows must
-- backfill obj_<function-type> + child items from these tables BEFORE applying
-- this migration (verify empty + back up first — see
-- runbooks/postgres-schema-migration.md).

DROP TABLE IF EXISTS function_parameters;
DROP TABLE IF EXISTS function_throws;
DROP TABLE IF EXISTS function_type_parameters;
DROP TABLE IF EXISTS functions;
