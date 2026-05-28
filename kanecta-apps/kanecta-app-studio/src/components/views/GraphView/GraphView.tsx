import { useCallback, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import type { Confidence, KanectaItem, KanectaItemWithChildren, Relationship } from '../../../types/kanecta';
import { flattenTree } from '../../../lib/items';
import { GraphControls } from './GraphControls';
import './GraphView.scss';

interface GraphNode {
  id: string;
  label: string;
  type: KanectaItem['type'];
  confidence: KanectaItem['confidence'];
  val: number;
}

interface GraphLink {
  source: string;
  target: string;
  kind: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const TYPE_COLOURS: Record<KanectaItem['type'], string> = {
  number: '#78909c',
  claim: '#ff9800',
  question: '#2196f3',
  task: '#9c27b0',
  note: '#607d8b',
  concept: '#00bcd4',
  entity: '#e91e63',
  event: '#ff5722',
  text: '#795548',
  code: '#009688',
  url: '#3f51b5',
  image: '#8bc34a',
  file: '#ffc107',
};

const CONFIDENCE_COLOURS: Record<Confidence, string> = {
  low: '#f44336',
  medium: '#ff9800',
  high: '#4caf50',
  verified: '#2196f3',
  locked: '#9e9e9e',
};

export function GraphView() {
  const { getApi, getActiveWorkspace } = useWorkspaceStore();
  const { focusedItemId, setFocusedItem } = useUiStore();
  const wsId = getActiveWorkspace()?.id ?? '';

  const [mode, setMode] = useState<'local' | 'full'>('full');
  const [colourBy, setColourBy] = useState<'type' | 'confidence'>('type');

  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined);

  const { data: tree = [] } = useQuery<KanectaItemWithChildren[]>({
    queryKey: ['all-items', wsId],
    queryFn: () => getApi().tree.full() as Promise<KanectaItemWithChildren[]>,
  });

  const { data: relationships = [] } = useQuery<Relationship[]>({
    queryKey: ['all-relationships', wsId],
    queryFn: () => getApi().relationships.list(),
  });

  const graphData = useCallback((): GraphData => {
    const allItems = flattenTree(tree);
    let items = allItems;

    if (mode === 'local' && focusedItemId) {
      const relatedIds = new Set<string>([focusedItemId]);
      for (const rel of relationships) {
        if (rel.fromId === focusedItemId) relatedIds.add(rel.toId);
        if (rel.toId === focusedItemId) relatedIds.add(rel.fromId);
      }
      for (const item of allItems) {
        if (item.parentId === focusedItemId || item.id === allItems.find((i) => i.id === focusedItemId)?.parentId) {
          relatedIds.add(item.id);
        }
      }
      items = allItems.filter((i) => relatedIds.has(i.id));
    }

    const nodeIds = new Set(items.map((i) => i.id));

    const nodes: GraphNode[] = items.map((item) => ({
      id: item.id,
      label: item.value.slice(0, 40),
      type: item.type,
      confidence: item.confidence,
      val: item.childCount ? Math.log2(item.childCount + 2) * 4 : 4,
    }));

    const links: GraphLink[] = [];

    for (const item of items) {
      if (item.parentId && nodeIds.has(item.parentId)) {
        links.push({ source: item.parentId, target: item.id, kind: 'child' });
      }
    }

    for (const rel of relationships) {
      if (nodeIds.has(rel.fromId) && nodeIds.has(rel.toId)) {
        links.push({ source: rel.fromId, target: rel.toId, kind: rel.type });
      }
    }

    return { nodes, links };
  }, [tree, relationships, mode, focusedItemId]);

  const nodeColour = useCallback(
    (node: GraphNode) =>
      colourBy === 'type' ? TYPE_COLOURS[node.type] : (node.confidence ? CONFIDENCE_COLOURS[node.confidence] : '#aaaaaa'),
    [colourBy],
  );

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      setFocusedItem(node.id);
    },
    [setFocusedItem],
  );

  const data = graphData();

  return (
    <div className="GraphView">
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        nodeId="id"
        nodeLabel="label"
        nodeColor={nodeColour}
        nodeRelSize={5}
        linkColor={() => 'rgba(150,150,150,0.4)'}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as GraphNode & { x?: number; y?: number };
          if (!n.x || !n.y) return;
          // bigger nodes (higher val) get labels sooner; smallest nodes need ~8× zoom
          const labelThreshold = 32 / n.val;
          const fadeStart = labelThreshold * 0.7;
          if (globalScale < fadeStart) return;
          const opacity = Math.min(1, (globalScale - fadeStart) / (labelThreshold * 0.6));
          const label = n.label;
          const fontSize = Math.max(8, 12 / globalScale);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = `rgba(0,0,0,${0.85 * opacity})`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, n.x, n.y + 10);
        }}
        backgroundColor="transparent"
      />
      <GraphControls
        mode={mode}
        onModeChange={setMode}
        colourBy={colourBy}
        onColourByChange={setColourBy}
        onZoomIn={() => graphRef.current?.zoom(1.5, 400)}
        onZoomOut={() => graphRef.current?.zoom(0.67, 400)}
        onFitView={() => graphRef.current?.zoomToFit(400)}
      />
    </div>
  );
}
