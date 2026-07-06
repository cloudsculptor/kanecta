// Ambient shim: better-sqlite3 ships no type declarations and no @types package is
// installed in this repo. Declaring it as an untyped module lets `import Database
// from 'better-sqlite3'` typecheck (as `any`) without pulling in external types.
declare module 'better-sqlite3';
