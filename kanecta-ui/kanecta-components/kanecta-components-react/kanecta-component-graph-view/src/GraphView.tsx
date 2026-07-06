import { useCallback, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import { useQuery } from '@tanstack/react-query';
import './GraphView.scss';

// ── Public types ─────────────────────────────────────────────────────────────

export interface GraphFlatItem {
  id: string;
  value: string;
  type: string;
  confidence?: string;
  parentId?: string | null;
  childCount?: number;
}

export interface GraphRelationship {
  fromId: string;
  toId: string;
  type: string;
}

export interface GraphViewProps {
  onFetchItems: () => Promise<GraphFlatItem[]>;
  onFetchRelationships: () => Promise<GraphRelationship[]>;
  focusedItemId?: string | null;
  onFocusItem?: (id: string) => void;
  queryKey?: string;
}

// ── Internal graph node/link shapes ─────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: string;
  confidence?: string;
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

// ── Colour maps ──────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  string: '#90a4ae',
  number: '#78909c',
  text: '#795548',
  heading: '#546e7a',
  file: '#ffc107',
  symlink: '#29b6f6',
  url: '#3f51b5',
  image: '#8bc34a',
  function: '#009688',
  object: '#ab47bc',
  decision: '#5c6bc0',
  annotation: '#26a69a',
  claim: '#ff9800',
  question: '#2196f3',
  task: '#9c27b0',
  note: '#607d8b',
  concept: '#00bcd4',
  entity: '#e91e63',
  event: '#ff5722',
};

const CONFIDENCE_COLOURS: Record<string, string> = {
  low: '#f44336',
  medium: '#ff9800',
  high: '#4caf50',
  verified: '#2196f3',
  locked: '#9e9e9e',
};

// ── Sub-component: controls overlay ─────────────────────────────────────────

interface GraphControlsProps {
  mode: 'local' | 'full';
  onModeChange: (mode: 'local' | 'full') => void;
  colourBy: 'type' | 'confidence';
  onColourByChange: (colourBy: 'type' | 'confidence') => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}

function GraphControls({ mode, onModeChange, colourBy, onColourByChange, onZoomIn, onZoomOut, onFitView }: GraphControlsProps) {
  return (
    <div className="GraphControls">
      <div className="GraphControls-group">
        <button className={`GraphControls-btn${mode === 'local' ? ' GraphControls-btn--active' : ''}`} onClick={() => onModeChange('local')} title="Show local neighbourhood">Local</button>
        <button className={`GraphControls-btn${mode === 'full'  ? ' GraphControls-btn--active' : ''}`} onClick={() => onModeChange('full')}  title="Show full graph">Full</button>
      </div>
      <div className="GraphControls-group">
        <button className={`GraphControls-btn${colourBy === 'type'       ? ' GraphControls-btn--active' : ''}`} onClick={() => onColourByChange('type')}       title="Colour nodes by type">Type</button>
        <button className={`GraphControls-btn${colourBy === 'confidence' ? ' GraphControls-btn--active' : ''}`} onClick={() => onColourByChange('confidence')} title="Colour nodes by confidence">Confidence</button>
      </div>
      <div className="GraphControls-group">
        <button className="GraphControls-btn" onClick={onZoomIn}  title="Zoom in">+</button>
        <button className="GraphControls-btn" onClick={onZoomOut} title="Zoom out">−</button>
        <button className="GraphControls-btn" onClick={onFitView} title="Fit to view">⊡</button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function GraphView({ onFetchItems, onFetchRelationships, focusedItemId, onFocusItem, queryKey = '' }: GraphViewProps) {
  const [mode, setMode] = useState<'local' | 'full'>('full');
  const [colourBy, setColourBy] = useState<'type' | 'confidence'>('type');

  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined);

  const { data: items = [] } = useQuery<GraphFlatItem[]>({
    queryKey: ['graph-items', queryKey],
    queryFn: onFetchItems,
  });

  const { data: relationships = [] } = useQuery<GraphRelationship[]>({
    queryKey: ['graph-relationships', queryKey],
    queryFn: onFetchRelationships,
  });

  const graphData = useCallback((): GraphData => {
    let filtered = items;

    if (mode === 'local' && focusedItemId) {
      const relatedIds = new Set<string>([focusedItemId]);
      for (const rel of relationships) {
        if (rel.fromId === focusedItemId) relatedIds.add(rel.toId);
        if (rel.toId === focusedItemId) relatedIds.add(rel.fromId);
      }
      for (const item of items) {
        if (item.parentId === focusedItemId || item.id === items.find(i => i.id === focusedItemId)?.parentId) {
          relatedIds.add(item.id);
        }
      }
      filtered = items.filter(i => relatedIds.has(i.id));
    }

    const nodeIds = new Set(filtered.map(i => i.id));

    const nodes: GraphNode[] = filtered.map(item => ({
      id: item.id,
      label: item.value.slice(0, 40),
      type: item.type,
      confidence: item.confidence,
      val: item.childCount ? Math.log2(item.childCount + 2) * 4 : 4,
    }));

    const links: GraphLink[] = [];

    for (const item of filtered) {
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
  }, [items, relationships, mode, focusedItemId]);

  const nodeColour = useCallback(
    (node: GraphNode) =>
      colourBy === 'type'
        ? (TYPE_COLOURS[node.type] ?? '#aaaaaa')
        : (node.confidence ? (CONFIDENCE_COLOURS[node.confidence] ?? '#aaaaaa') : '#aaaaaa'),
    [colourBy],
  );

  const handleNodeClick = useCallback(
    (node: GraphNode) => { onFocusItem?.(node.id); },
    [onFocusItem],
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
        d3AlphaDecay={0.06}
        d3VelocityDecay={0.7}
        cooldownTicks={150}
        onNodeClick={handleNodeClick}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as GraphNode & { x?: number; y?: number };
          if (!n.x || !n.y) return;
          const labelThreshold = 120 / n.val;
          const fadeStart = labelThreshold * 0.7;
          if (globalScale < fadeStart) return;
          const opacity = Math.min(1, (globalScale - fadeStart) / (labelThreshold * 0.6));
          const fontSize = Math.max(8, 12 / globalScale);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = `rgba(0,0,0,${0.85 * opacity})`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(n.label, n.x, n.y + 10);
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
