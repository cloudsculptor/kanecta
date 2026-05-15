import './GraphControls.scss';

interface GraphControlsProps {
  mode: 'local' | 'full';
  onModeChange: (mode: 'local' | 'full') => void;
  colourBy: 'type' | 'confidence';
  onColourByChange: (colourBy: 'type' | 'confidence') => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}

export function GraphControls({
  mode,
  onModeChange,
  colourBy,
  onColourByChange,
  onZoomIn,
  onZoomOut,
  onFitView,
}: GraphControlsProps) {
  return (
    <div className="GraphControls">
      <div className="GraphControls-group">
        <button
          className={`GraphControls-btn${mode === 'local' ? ' GraphControls-btn--active' : ''}`}
          onClick={() => onModeChange('local')}
          title="Show local neighbourhood"
        >
          Local
        </button>
        <button
          className={`GraphControls-btn${mode === 'full' ? ' GraphControls-btn--active' : ''}`}
          onClick={() => onModeChange('full')}
          title="Show full graph"
        >
          Full
        </button>
      </div>

      <div className="GraphControls-group">
        <button
          className={`GraphControls-btn${colourBy === 'type' ? ' GraphControls-btn--active' : ''}`}
          onClick={() => onColourByChange('type')}
          title="Colour nodes by type"
        >
          Type
        </button>
        <button
          className={`GraphControls-btn${colourBy === 'confidence' ? ' GraphControls-btn--active' : ''}`}
          onClick={() => onColourByChange('confidence')}
          title="Colour nodes by confidence"
        >
          Confidence
        </button>
      </div>

      <div className="GraphControls-group">
        <button className="GraphControls-btn" onClick={onZoomIn} title="Zoom in">+</button>
        <button className="GraphControls-btn" onClick={onZoomOut} title="Zoom out">−</button>
        <button className="GraphControls-btn" onClick={onFitView} title="Fit to view">⊡</button>
      </div>
    </div>
  );
}
