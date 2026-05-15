import type { KanectaItem, KanectaItemWithChildren, CreateItemPayload } from '../types/kanecta';
import type { KanectaApi } from '../api';

const STORAGE_KEY = 'kanecta-templates';

export interface Template {
  id: string;
  name: string;
  createdAt: string;
  tree: TemplateNode;
}

export interface TemplateNode {
  value: string;
  type: KanectaItem['type'];
  confidence: KanectaItem['confidence'];
  tags: string[];
  children: TemplateNode[];
}

function itemToTemplateNode(item: KanectaItemWithChildren): TemplateNode {
  return {
    value: item.value,
    type: item.type,
    confidence: item.confidence,
    tags: item.tags,
    children: (item.children ?? []).map(itemToTemplateNode),
  };
}

export function saveTemplate(name: string, root: KanectaItemWithChildren): Template {
  const template: Template = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    tree: itemToTemplateNode(root),
  };
  const existing = listTemplates();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, template]));
  return template;
}

export function listTemplates(): Template[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Template[];
  } catch {
    return [];
  }
}

export function deleteTemplate(id: string): void {
  const templates = listTemplates().filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

async function instantiateNode(
  api: KanectaApi,
  node: TemplateNode,
  parentId: string | undefined,
): Promise<void> {
  const payload: CreateItemPayload = {
    value: node.value,
    type: node.type,
    confidence: node.confidence,
    tags: node.tags,
    parentId,
  };
  const created = await api.items.create(payload);
  for (const child of node.children) {
    await instantiateNode(api, child, created.id);
  }
}

export async function instantiateTemplate(
  api: KanectaApi,
  template: Template,
  parentId?: string,
): Promise<void> {
  await instantiateNode(api, template.tree, parentId);
}
