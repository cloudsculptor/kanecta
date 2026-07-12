import types from './1.4.0/built-in-types/built-in-types.json' with { type: 'json' };
import itemSpec from './1.4.0/core-file-specs/item.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

// Built-in type items — static JSON imports so this module stays browser-safe
// (no Node 'module'/createRequire, which Vite externalises). Order matches
// 1.4.0/built-in-types/kanecta.manifest.json.
import builtInTypeManifest from './1.4.0/built-in-types/kanecta.manifest.json' with { type: 'json' };
import tAction from './1.4.0/built-in-types/types/action.json' with { type: 'json' };
import tActivity from './1.4.0/built-in-types/types/activity.json' with { type: 'json' };
import tAgent from './1.4.0/built-in-types/types/agent.json' with { type: 'json' };
import tAlias from './1.4.0/built-in-types/types/alias.json' with { type: 'json' };
import tAnnotation from './1.4.0/built-in-types/types/annotation.json' with { type: 'json' };
import tAspectType from './1.4.0/built-in-types/types/aspect-type.json' with { type: 'json' };
import tCell from './1.4.0/built-in-types/types/cell.json' with { type: 'json' };
import tChannel from './1.4.0/built-in-types/types/channel.json' with { type: 'json' };
import tClaudeApiConfig from './1.4.0/built-in-types/types/claude-api-config.json' with { type: 'json' };
import tClaudeCodeConfig from './1.4.0/built-in-types/types/claude-code-config.json' with { type: 'json' };
import tComponent from './1.4.0/built-in-types/types/component.json' with { type: 'json' };
import tContext from './1.4.0/built-in-types/types/context.json' with { type: 'json' };
import tDocument from './1.4.0/built-in-types/types/document.json' with { type: 'json' };
import tDocumentExpandException from './1.4.0/built-in-types/types/document-expand-exception.json' with { type: 'json' };
import tDocumentRoleByDepth from './1.4.0/built-in-types/types/document-role-by-depth.json' with { type: 'json' };
import tDocumentRoleByType from './1.4.0/built-in-types/types/document-role-by-type.json' with { type: 'json' };
import tEval from './1.4.0/built-in-types/types/eval.json' with { type: 'json' };
import tEvalRun from './1.4.0/built-in-types/types/eval-run.json' with { type: 'json' };
import tFile from './1.4.0/built-in-types/types/file.json' with { type: 'json' };
import tFormula from './1.4.0/built-in-types/types/formula.json' with { type: 'json' };
import tFunction from './1.4.0/built-in-types/types/function.json' with { type: 'json' };
import tFunctionThrow from './1.4.0/built-in-types/types/function-throw.json' with { type: 'json' };
import tGrant from './1.4.0/built-in-types/types/grant.json' with { type: 'json' };
import tGrid from './1.4.0/built-in-types/types/grid.json' with { type: 'json' };
import tGroupChatConfig from './1.4.0/built-in-types/types/group-chat-config.json' with { type: 'json' };
import tHttpConfig from './1.4.0/built-in-types/types/http-config.json' with { type: 'json' };
import tItemHistory from './1.4.0/built-in-types/types/item_history.json' with { type: 'json' };
import tKanectaFunctionConfig from './1.4.0/built-in-types/types/kanecta-function-config.json' with { type: 'json' };
import tLicence from './1.4.0/built-in-types/types/licence.json' with { type: 'json' };
import tObject from './1.4.0/built-in-types/types/object.json' with { type: 'json' };
import tParameter from './1.4.0/built-in-types/types/parameter.json' with { type: 'json' };
import tPipeline from './1.4.0/built-in-types/types/pipeline.json' with { type: 'json' };
import tPipelineRun from './1.4.0/built-in-types/types/pipeline-run.json' with { type: 'json' };
import tProperty from './1.4.0/built-in-types/types/property.json' with { type: 'json' };
import tPythonConfig from './1.4.0/built-in-types/types/python-config.json' with { type: 'json' };
import tQuery from './1.4.0/built-in-types/types/query.json' with { type: 'json' };
import tQueryParam from './1.4.0/built-in-types/types/query-param.json' with { type: 'json' };
import tReference from './1.4.0/built-in-types/types/reference.json' with { type: 'json' };
import tRelationship from './1.4.0/built-in-types/types/relationship.json' with { type: 'json' };
import tRelationshipType from './1.4.0/built-in-types/types/relationship-type.json' with { type: 'json' };
import tRoot from './1.4.0/built-in-types/types/root.json' with { type: 'json' };
import tSubscription from './1.4.0/built-in-types/types/subscription.json' with { type: 'json' };
import tType from './1.4.0/built-in-types/types/type.json' with { type: 'json' };
import tTypeParameter from './1.4.0/built-in-types/types/type-parameter.json' with { type: 'json' };
import tView from './1.4.0/built-in-types/types/view.json' with { type: 'json' };

// The irreducible bootstrap: the seed metaschema for the `type` type. The
// projection engine can't derive obj_<type-type>'s columns from type.json's own
// (nested) payload schema — that's circular — so this flat, hand-authored schema
// breaks the loop. Carried in rootPayload.seedMetaschema; the adapter compiles
// obj_<type-type> from it (spec §rootPayload / §cqrs-projections).
import typeSeed from './1.4.0/built-in-types/type-seed-metaschema.json' with { type: 'json' };

// Built-in system items — mandatory seed INSTANCES the platform depends on (not
// type definitions). Currently the 19 built-in licences (spec §licencePayload),
// seeded as `licence` items projecting to obj_<licence-type>. Static JSON imports
// keep this browser-safe and version-coupled to this package, exactly like
// builtInTypeItems above.
import sysItem1 from './1.4.0/system-items/items/05/5f/055f0bd5-7080-4d04-8137-b6b15421ced7/item.json' with { type: 'json' };
import sysItem2 from './1.4.0/system-items/items/05/8b/058b1c83-6a7f-4b71-ac99-c3a73baad664/item.json' with { type: 'json' };
import sysItem3 from './1.4.0/system-items/items/09/ed/09eda7ea-4130-4e04-91a3-38970024da3c/item.json' with { type: 'json' };
import sysItem4 from './1.4.0/system-items/items/53/5a/535a6b2e-4f84-40d4-ac4b-656ad18256b4/item.json' with { type: 'json' };
import sysItem5 from './1.4.0/system-items/items/56/df/56df650f-f2e9-415f-a7bb-6f87805aa15b/item.json' with { type: 'json' };
import sysItem6 from './1.4.0/system-items/items/69/86/698687e6-d96f-4b95-95e1-eb91ff09b8d5/item.json' with { type: 'json' };
import sysItem7 from './1.4.0/system-items/items/6a/f8/6af82527-a086-4596-a07f-84ca3cad2277/item.json' with { type: 'json' };
import sysItem8 from './1.4.0/system-items/items/6b/db/6bdb1772-6dc7-4b78-8111-63ccc27f36ac/item.json' with { type: 'json' };
import sysItem9 from './1.4.0/system-items/items/74/ba/74baaf34-23ab-45f7-ae14-fce862a37d41/item.json' with { type: 'json' };
import sysItem10 from './1.4.0/system-items/items/8f/d6/8fd63076-6ee1-4c81-90a2-f7a2371728bd/item.json' with { type: 'json' };
import sysItem11 from './1.4.0/system-items/items/9b/a8/9ba88bde-7926-47f2-ab18-df9a5fa95bd4/item.json' with { type: 'json' };
import sysItem12 from './1.4.0/system-items/items/9d/23/9d233a14-4a41-4be4-8f1c-7df236bf5fa7/item.json' with { type: 'json' };
import sysItem13 from './1.4.0/system-items/items/aa/0e/aa0e9c4a-5c1a-4213-b7f1-a32be5929216/item.json' with { type: 'json' };
import sysItem14 from './1.4.0/system-items/items/bb/3b/bb3bf137-d8a9-4264-9fb7-ac373b1d4739/item.json' with { type: 'json' };
import sysItem15 from './1.4.0/system-items/items/c5/54/c55442ee-47c4-4d1f-b7f3-5e994c57d6e9/item.json' with { type: 'json' };
import sysItem16 from './1.4.0/system-items/items/d2/37/d2376760-70f6-4ded-9471-6a0b2b69f43f/item.json' with { type: 'json' };
import sysItem17 from './1.4.0/system-items/items/d4/f4/d4f4b3b2-a652-4dd2-b83e-18aabf50b053/item.json' with { type: 'json' };
import sysItem18 from './1.4.0/system-items/items/e5/82/e58246ce-4c9b-4b60-90b4-b442cccecba5/item.json' with { type: 'json' };
import sysItem19 from './1.4.0/system-items/items/f3/75/f3753e87-6b36-4939-8e31-70d504f1a36c/item.json' with { type: 'json' };

export const version: string = pkg.version;
export const item: object = itemSpec;
export { types };
export const allTypes: readonly string[] = [...types.primitive, ...types.structured, ...types.wellKnown];
export const primitiveTypes: readonly string[] = types.primitive;
export const structuredTypes: readonly string[] = types.structured;
export const wellKnownTypes: readonly string[] = types.wellKnown;

export { builtInTypeManifest };
// The seed metaschema for the `type` type (obj_<type-type> column source).
export const typeSeedMetaschema: object = typeSeed;
export const builtInTypeItems: object[] = [
  tAction, tActivity, tAgent, tAlias, tAnnotation, tAspectType, tCell, tChannel,
  tClaudeApiConfig, tClaudeCodeConfig, tComponent, tContext, tDocument, tDocumentExpandException, tDocumentRoleByDepth, tDocumentRoleByType,
  tEval, tEvalRun, tFile, tFormula, tFunction, tFunctionThrow, tGrant, tGrid,
  tGroupChatConfig, tHttpConfig, tItemHistory, tKanectaFunctionConfig, tLicence, tObject, tParameter, tPipeline,
  tPipelineRun, tProperty, tPythonConfig, tQuery, tQueryParam, tReference, tRelationship, tRelationshipType,
  tRoot, tSubscription, tType, tTypeParameter, tView,
];

// Mandatory seed instances (currently the 19 built-in licences). Order is
// irrelevant — the seeder is idempotent and keyed on item id.
export const builtInSystemItems: object[] = [
  sysItem1, sysItem2, sysItem3, sysItem4, sysItem5, sysItem6, sysItem7,
  sysItem8, sysItem9, sysItem10, sysItem11, sysItem12, sysItem13, sysItem14,
  sysItem15, sysItem16, sysItem17, sysItem18, sysItem19,
];
