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
import tEval from './1.4.0/built-in-types/types/eval.json' with { type: 'json' };
import tEvalRun from './1.4.0/built-in-types/types/eval-run.json' with { type: 'json' };
import tFile from './1.4.0/built-in-types/types/file.json' with { type: 'json' };
import tFormula from './1.4.0/built-in-types/types/formula.json' with { type: 'json' };
import tFunction from './1.4.0/built-in-types/types/function.json' with { type: 'json' };
import tGrant from './1.4.0/built-in-types/types/grant.json' with { type: 'json' };
import tGrid from './1.4.0/built-in-types/types/grid.json' with { type: 'json' };
import tGroupChatConfig from './1.4.0/built-in-types/types/group-chat-config.json' with { type: 'json' };
import tHttpConfig from './1.4.0/built-in-types/types/http-config.json' with { type: 'json' };
import tItemHistory from './1.4.0/built-in-types/types/item_history.json' with { type: 'json' };
import tKanectaFunctionConfig from './1.4.0/built-in-types/types/kanecta-function-config.json' with { type: 'json' };
import tLicence from './1.4.0/built-in-types/types/licence.json' with { type: 'json' };
import tObject from './1.4.0/built-in-types/types/object.json' with { type: 'json' };
import tPipeline from './1.4.0/built-in-types/types/pipeline.json' with { type: 'json' };
import tPipelineRun from './1.4.0/built-in-types/types/pipeline-run.json' with { type: 'json' };
import tProperty from './1.4.0/built-in-types/types/property.json' with { type: 'json' };
import tPythonConfig from './1.4.0/built-in-types/types/python-config.json' with { type: 'json' };
import tQuery from './1.4.0/built-in-types/types/query.json' with { type: 'json' };
import tQueryParam from './1.4.0/built-in-types/types/query-param.json' with { type: 'json' };
import tReference from './1.4.0/built-in-types/types/reference.json' with { type: 'json' };
import tRelationship from './1.4.0/built-in-types/types/relationship.json' with { type: 'json' };
import tRelationshipType from './1.4.0/built-in-types/types/relationship-type.json' with { type: 'json' };
import tSubscription from './1.4.0/built-in-types/types/subscription.json' with { type: 'json' };
import tType from './1.4.0/built-in-types/types/type.json' with { type: 'json' };
import tView from './1.4.0/built-in-types/types/view.json' with { type: 'json' };

export const version: string = pkg.version;
export const item: object = itemSpec;
export { types };
export const allTypes: readonly string[] = [...types.primitive, ...types.structured, ...types.wellKnown];
export const primitiveTypes: readonly string[] = types.primitive;
export const structuredTypes: readonly string[] = types.structured;
export const wellKnownTypes: readonly string[] = types.wellKnown;

export { builtInTypeManifest };
export const builtInTypeItems: object[] = [
  tAction, tActivity, tAgent, tAlias, tAnnotation, tAspectType, tCell, tChannel,
  tClaudeApiConfig, tClaudeCodeConfig, tComponent, tContext, tDocument, tEval, tEvalRun, tFile,
  tFormula, tFunction, tGrant, tGrid, tGroupChatConfig, tHttpConfig, tItemHistory, tKanectaFunctionConfig,
  tLicence, tObject, tPipeline, tPipelineRun, tProperty, tPythonConfig, tQuery, tQueryParam,
  tReference, tRelationship, tRelationshipType, tSubscription, tType, tView,
];
