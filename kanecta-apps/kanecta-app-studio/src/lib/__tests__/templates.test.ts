import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveTemplate, listTemplates, deleteTemplate, instantiateTemplate } from '../templates';
import type { KanectaItemWithChildren } from '../../types/kanecta';
import type { KanectaApi } from '../../api';

const makeTree = (overrides: Partial<KanectaItemWithChildren> = {}): KanectaItemWithChildren => ({
  id: 'root',
  value: 'Root item',
  type: 'note',
  confidence: 'medium',
  sortOrder: 0,
  tags: ['research'],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
  children: [],
  ...overrides,
});

describe('listTemplates / saveTemplate / deleteTemplate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty list initially', () => {
    expect(listTemplates()).toHaveLength(0);
  });

  it('saves and retrieves a template', () => {
    const root = makeTree();
    saveTemplate('My Template', root);
    const list = listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('My Template');
  });

  it('saved template has correct tree shape', () => {
    const root = makeTree({
      value: 'Parent',
      children: [makeTree({ id: 'child-1', value: 'Child', children: [] })],
    });
    saveTemplate('Tree Template', root);
    const [tpl] = listTemplates();
    expect(tpl.tree.value).toBe('Parent');
    expect(tpl.tree.children).toHaveLength(1);
    expect(tpl.tree.children[0].value).toBe('Child');
  });

  it('generates a unique id for each template', () => {
    saveTemplate('A', makeTree());
    saveTemplate('B', makeTree());
    const [a, b] = listTemplates();
    expect(a.id).not.toBe(b.id);
  });

  it('accumulates multiple templates', () => {
    saveTemplate('First', makeTree());
    saveTemplate('Second', makeTree());
    expect(listTemplates()).toHaveLength(2);
  });

  it('deletes a template by id', () => {
    const tpl = saveTemplate('To Delete', makeTree());
    saveTemplate('Keep', makeTree());
    deleteTemplate(tpl.id);
    const list = listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Keep');
  });

  it('does nothing when deleting a non-existent id', () => {
    saveTemplate('Only', makeTree());
    deleteTemplate('does-not-exist');
    expect(listTemplates()).toHaveLength(1);
  });
});

describe('instantiateTemplate', () => {
  it('calls api.items.create for a single-node template', async () => {
    const createdItem = { id: 'new-1', value: 'Root item', type: 'note', confidence: 'medium', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' };
    const mockCreate = vi.fn().mockResolvedValue(createdItem);
    const api = { items: { create: mockCreate } } as unknown as KanectaApi;

    const root = makeTree();
    const tpl = saveTemplate('Single', root);
    await instantiateTemplate(api, tpl);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      value: 'Root item',
      type: 'note',
      confidence: 'medium',
      tags: ['research'],
      parentId: undefined,
    });
  });

  it('instantiates children with correct parentId', async () => {
    const parentItem = { id: 'p', value: 'Parent', type: 'note', confidence: 'medium', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' };
    const childItem = { id: 'c', value: 'Child', type: 'fact', confidence: 'high', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(parentItem)
      .mockResolvedValueOnce(childItem);

    const api = { items: { create: mockCreate } } as unknown as KanectaApi;

    const root = makeTree({
      value: 'Parent',
      children: [makeTree({ id: 'child', value: 'Child', type: 'fact', confidence: 'high', tags: [], children: [] })],
    });
    const tpl = saveTemplate('Nested', root);
    await instantiateTemplate(api, tpl);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0].parentId).toBe('p');
  });

  it('passes parentId to the root node when provided', async () => {
    const createdItem = { id: 'x', value: 'Root', type: 'note', confidence: 'medium', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' };
    const mockCreate = vi.fn().mockResolvedValue(createdItem);
    const api = { items: { create: mockCreate } } as unknown as KanectaApi;

    const tpl = saveTemplate('WithParent', makeTree());
    await instantiateTemplate(api, tpl, 'existing-parent-id');

    expect(mockCreate.mock.calls[0][0].parentId).toBe('existing-parent-id');
  });
});
