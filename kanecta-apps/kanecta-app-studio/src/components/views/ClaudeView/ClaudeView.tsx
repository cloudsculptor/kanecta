import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { ClaudeView as ClaudeViewPkg } from '@kanecta/component-claude-view';
import { useWorkspaceStore } from '../../../store/workspace';

export const ClaudeViewMeta: ViewMeta = {
  uuid: 'd7c6e5f4-a8b9-4c0d-1e2f-3a4b5c6d7e8f',
  name: 'claude',
  label: 'Claude',
  icon: 'AutoAwesome',
};

export function ClaudeView() {
  useViewLocation(ClaudeViewMeta.uuid);
  const { getApi } = useWorkspaceStore();
  const api = getApi();

  return (
    <ClaudeViewPkg
      createSession={(prompt) => api.claude.createSession(prompt)}
      streamUrl={(id) => api.claude.streamUrl(id)}
      cancelSession={(id) => api.claude.cancel(id)}
    />
  );
}
