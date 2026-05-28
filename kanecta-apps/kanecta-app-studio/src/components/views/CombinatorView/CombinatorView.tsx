import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import { StarredView } from '../StarredView/StarredView';
import { HistoryList } from '../HistoryView/HistoryView';
import './CombinatorView.scss';

export function CombinatorView() {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const { layout, updatePanel } = useUiStore();
  const api = getApi(activeWorkspaceId);

  const handleNavigate = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    window.location.hash = `/tree/${id}`;
    const panelId = layout.panels[0]?.id;
    if (panelId) updatePanel(panelId, { viewType: 'tree' });
  };

  return (
    <div className="CombinatorView">
      <div className="CombinatorView-left">
        <div className="CombinatorView-box CombinatorView-box--inputs">
          <span className="CombinatorView-box-label">Inputs</span>
        </div>
        <div className="CombinatorView-box CombinatorView-box--goal">
          <span className="CombinatorView-box-label">Goal</span>
          <textarea className="CombinatorView-textarea" placeholder="Describe the goal…" />
        </div>
        <div className="CombinatorView-box CombinatorView-box--prompt">
          <span className="CombinatorView-box-label">AI prompt</span>
          <textarea className="CombinatorView-textarea" placeholder="Enter AI prompt…" />
        </div>
      </div>
      <div className="CombinatorView-divider" />
      <div className="CombinatorView-right">
        <div className="CombinatorView-section">
          <StarredView />
        </div>
        <div className="CombinatorView-section-divider" />
        <div className="CombinatorView-section">
          <div className="CombinatorView-section-inner">
            <h2 className="CombinatorView-heading">Clipboard History</h2>
            <HistoryList
              queryKey="breadcrumb-clipboard"
              fetcher={() => api.breadcrumb.getClipboard()}
              emptyMessage="No clipboard history yet."
              onNavigate={handleNavigate}
            />
          </div>
        </div>
        <div className="CombinatorView-section-divider" />
        <div className="CombinatorView-section">
          <div className="CombinatorView-section-inner">
            <h2 className="CombinatorView-heading">Navigation History</h2>
            <HistoryList
              queryKey="breadcrumb-viewed"
              fetcher={() => api.breadcrumb.getViewed()}
              emptyMessage="No navigation history yet."
              onNavigate={handleNavigate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
