// Ambient declarations for the untyped JS workspace/runtime dependencies this
// package consumes. These modules are plain JavaScript (loaded fine at runtime
// under tsx); they carry no type declarations, so we treat them as `any` at the
// boundary rather than fighting their dynamic datastore / DB shapes.
declare module '@kanecta/lib';
declare module '@kanecta/postgres';
declare module 'pg';
