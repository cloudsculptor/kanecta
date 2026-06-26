import primitiveSpec from '@kanecta/specification/1.4.0/types/built-in-types.json';
import type { ItemType, Confidence, RelationshipType } from '../types/kanecta';

export const ITEM_TYPES: ItemType[] = [
  ...primitiveSpec.primitive,
  ...primitiveSpec.structured,
] as ItemType[];

export const CONFIDENCE_LEVELS: Confidence[] = [
  'low', 'medium', 'high', 'verified', 'locked',
];

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  'related', 'supports', 'contradicts', 'depends_on', 'part_of', 'example_of', 'caused_by',
];
