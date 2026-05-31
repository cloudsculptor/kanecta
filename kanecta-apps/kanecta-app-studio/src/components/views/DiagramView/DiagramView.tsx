import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './DiagramView.scss';

const nodeDefaults = {
  style: {
    background: '#ffffff',
    border: '1px solid #d0d0d0',
    borderRadius: '8px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 500,
    minWidth: '160px',
    textAlign: 'center' as const,
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
  },
};

const X = 220;
const Y = 160;

const nodes = [
  { id: '1', position: { x: 0,      y: 0    }, data: { label: 'Jira Ticket' },                      ...nodeDefaults },
  { id: '2', position: { x: X,      y: 0    }, data: { label: '(Unspecified)' },                    ...nodeDefaults },
  { id: '3', position: { x: X * 2,  y: 0    }, data: { label: 'Desired Outcome' },                  ...nodeDefaults },
  { id: '4', position: { x: X * 3,  y: 0    }, data: { label: 'Prompt' },                           ...nodeDefaults },
  { id: '5', position: { x: X * 4,  y: 0    }, data: { label: 'Claude' },                           ...nodeDefaults },
  { id: '6', position: { x: X * 4,  y: Y    }, data: { label: 'Output' },                           ...nodeDefaults },
  { id: '7', position: { x: X * 3,  y: Y    }, data: { label: 'Comparison with\nDesired Outcome' }, ...nodeDefaults },
  { id: '8', position: { x: X * 2,  y: Y    }, data: { label: 'What to change\nin Prompt' },        ...nodeDefaults },
  { id: '9', position: { x: X,      y: Y    }, data: { label: 'Make Changes' },                     ...nodeDefaults },
];

const edgeDefaults = {
  type: 'smoothstep' as const,
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: '#888', strokeWidth: 1.5 },
};

const edges = [
  { id: 'e1-2', source: '1', target: '2', ...edgeDefaults },
  { id: 'e2-3', source: '2', target: '3', ...edgeDefaults },
  { id: 'e3-4', source: '3', target: '4', ...edgeDefaults },
  { id: 'e4-5', source: '4', target: '5', ...edgeDefaults },
  { id: 'e5-6', source: '5', target: '6', ...edgeDefaults },
  { id: 'e6-7', source: '6', target: '7', ...edgeDefaults },
  { id: 'e7-8', source: '7', target: '8', ...edgeDefaults },
  { id: 'e8-9', source: '8', target: '9', ...edgeDefaults },
  {
    id: 'e9-1',
    source: '9',
    target: '1',
    label: 'Run again',
    labelStyle: { fontSize: 12, fontWeight: 600, fill: '#666' },
    ...edgeDefaults,
    type: 'smoothstep',
    style: { stroke: '#888', strokeWidth: 1.5, strokeDasharray: '5 4' },
  },
];

export function DiagramView() {
  return (
    <div className="DiagramView">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="#e0e0e0" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
