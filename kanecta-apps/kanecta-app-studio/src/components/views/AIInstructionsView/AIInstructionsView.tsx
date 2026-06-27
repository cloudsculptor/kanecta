import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { AIInstructionsView as AIInstructionsViewPkg } from '@kanecta/component-ai-instructions-view';
import { useWorkspaceStore } from '../../../store/workspace';

export const AIInstructionsViewMeta: ViewMeta = {
  uuid: 'c6b5d4e3-f7a8-4b9c-0d1e-2f3a4b5c6d7e',
  name: 'ai-instructions',
  label: 'AI Instructions',
  icon: 'Psychology',
};

export function AIInstructionsView() {
  useViewLocation(AIInstructionsViewMeta.uuid);
  const { getApi } = useWorkspaceStore();
  const api = getApi();

  return (
    <AIInstructionsViewPkg
      listSkills={() => api.skills.list()}
      getSkill={(id) => api.skills.get(id)}
      updateSkill={(id, content) => api.skills.update(id, content)}
    />
  );
}
