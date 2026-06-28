import type { KanectaApiClient } from '@kanecta/api-client';
import type {
  KanectaItem,
  Annotation,
  Relationship,
  HistoryEntry,
  CreateItemPayload,
  UpdateItemPayload,
  CreateAnnotationPayload,
} from '../types/kanecta';

export function itemsApi(client: KanectaApiClient) {
  return {
    list: () => client.items.list() as unknown as Promise<KanectaItem[]>,

    root: () => client.items.root() as unknown as Promise<KanectaItem>,

    stats: () => client.items.stats(),

    get: (id: string) => client.items.get(id) as unknown as Promise<KanectaItem>,

    create: (payload: CreateItemPayload) =>
      client.items.create(payload as never) as unknown as Promise<KanectaItem>,

    update: (id: string, payload: UpdateItemPayload) =>
      client.items.update(id, payload as never) as unknown as Promise<KanectaItem>,

    delete: (id: string, force = false) =>
      client.items.delete(id, force) as unknown as Promise<{ deleted: string }>,

    children: (id: string) => client.items.children(id) as unknown as Promise<KanectaItem[]>,

    tree: (id: string, depth?: number) =>
      client.items.tree(id, depth) as Promise<Array<{ item: KanectaItem; depth: number }>>,

    annotations: (id: string) => client.items.annotations(id) as unknown as Promise<Annotation[]>,

    annotate: (id: string, payload: CreateAnnotationPayload) =>
      client.items.annotate(id, payload as never) as unknown as Promise<Annotation>,

    relationships: (id: string) =>
      client.items.relationships(id) as unknown as Promise<Relationship[]>,

    backlinks: (id: string) => client.items.backlinks(id) as unknown as Promise<KanectaItem[]>,

    history: (id: string) => client.items.history(id) as unknown as Promise<HistoryEntry[]>,

    getObject: (id: string) => client.items.getObject(id),

    saveObject: (id: string, data: Record<string, unknown>) => client.items.saveObject(id, data),

    getFunctionData: (id: string) => client.items.getFunction(id) as Promise<Record<string, unknown>>,

    saveFunctionData: (id: string, data: Record<string, unknown>) =>
      client.items.saveFunction(id, data as never),

    getFunctionPackageJson: (id: string) => client.items.getFunctionPackageJson(id),

    checkFunctionScaffold: (id: string) => client.items.getFunctionScaffold(id),

    compileFunctionScaffold: (id: string) => client.items.compileFunction(id),

    runFunctionScaffold: (id: string, args: Record<string, string>) =>
      client.items.runFunction(id, args) as unknown as Promise<{
        success: boolean;
        output: string | null;
        logs: string;
      }>,

    complete: (id: string) => client.items.complete(id) as unknown as Promise<KanectaItem>,

    uncomplete: (id: string) => client.items.uncomplete(id) as unknown as Promise<KanectaItem>,
  };
}
