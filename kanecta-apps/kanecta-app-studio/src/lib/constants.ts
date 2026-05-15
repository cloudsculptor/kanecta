import type { ItemType, Confidence, RelationshipType } from '../types/kanecta';

export const ITEM_TYPES: ItemType[] = [
  'fact', 'claim', 'question', 'task', 'note', 'concept',
  'entity', 'event', 'text', 'code', 'url', 'image', 'file',
];

export const CONFIDENCE_LEVELS: Confidence[] = [
  'low', 'medium', 'high', 'verified', 'locked',
];

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  'related', 'supports', 'contradicts', 'depends_on', 'part_of', 'example_of', 'caused_by',
];
