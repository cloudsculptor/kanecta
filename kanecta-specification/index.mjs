import types from './1.3.0/types/primitive.json' with { type: 'json' };
import typeSpec from './1.3.0/file-specs/type.json' with { type: 'json' };
import itemsSpec from './1.3.0/file-specs/items.json' with { type: 'json' };
import metadataSpec from './1.3.0/file-specs/metadata.json' with { type: 'json' };
import functionSpec from './1.3.0/file-specs/function.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

export const version = pkg.version;
export const type = typeSpec;
export const items = itemsSpec;
export const metadata = metadataSpec;
export { functionSpec };
export { types };
export const allTypes = [...types.primitive, ...types.structured, ...types.wellKnown];
export const primitiveTypes = types.primitive;
export const structuredTypes = types.structured;
export const wellKnownTypes = types.wellKnown;
