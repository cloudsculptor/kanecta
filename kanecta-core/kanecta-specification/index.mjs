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
import tAspectType from './1.4.0/built-in-types/types/aspect-type.json' with { type: 'json' };
import tCell from './1.4.0/built-in-types/types/cell.json' with { type: 'json' };
import tComponent from './1.4.0/built-in-types/types/component.json' with { type: 'json' };
import tContext from './1.4.0/built-in-types/types/context.json' with { type: 'json' };
import tEval from './1.4.0/built-in-types/types/eval.json' with { type: 'json' };
import tEvalRun from './1.4.0/built-in-types/types/eval-run.json' with { type: 'json' };
import tFile from './1.4.0/built-in-types/types/file.json' with { type: 'json' };
import tFormula from './1.4.0/built-in-types/types/formula.json' with { type: 'json' };
import tFunction from './1.4.0/built-in-types/types/function.json' with { type: 'json' };
import tGrant from './1.4.0/built-in-types/types/grant.json' with { type: 'json' };
import tGrid from './1.4.0/built-in-types/types/grid.json' with { type: 'json' };
import tItemHistory from './1.4.0/built-in-types/types/item_history.json' with { type: 'json' };
import tObject from './1.4.0/built-in-types/types/object.json' with { type: 'json' };
import tPipeline from './1.4.0/built-in-types/types/pipeline.json' with { type: 'json' };
import tPipelineRun from './1.4.0/built-in-types/types/pipeline-run.json' with { type: 'json' };
import tQuery from './1.4.0/built-in-types/types/query.json' with { type: 'json' };
import tReference from './1.4.0/built-in-types/types/reference.json' with { type: 'json' };
import tRelationship from './1.4.0/built-in-types/types/relationship.json' with { type: 'json' };
import tRelationshipType from './1.4.0/built-in-types/types/relationship-type.json' with { type: 'json' };
import tSubscription from './1.4.0/built-in-types/types/subscription.json' with { type: 'json' };
import tType from './1.4.0/built-in-types/types/type.json' with { type: 'json' };
import tView from './1.4.0/built-in-types/types/view.json' with { type: 'json' };

export const version = pkg.version;
export const item = itemSpec;
export { types };
export const allTypes = [...types.primitive, ...types.structured, ...types.wellKnown];
export const primitiveTypes = types.primitive;
export const structuredTypes = types.structured;
export const wellKnownTypes = types.wellKnown;

export { builtInTypeManifest };
export const builtInTypeItems = [
  tAction, tActivity, tAgent, tAlias, tAspectType, tCell, tComponent, tContext,
  tEval, tEvalRun, tFile, tFormula, tFunction, tGrant, tGrid, tItemHistory,
  tObject, tPipeline, tPipelineRun, tQuery, tReference, tRelationship,
  tRelationshipType, tSubscription, tType, tView,
];
