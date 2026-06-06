import type { KanectaApiClient } from '@kanecta/api-client';

export interface SkillFile {
  id: string;
  title: string;
  filename: string;
}

export interface SkillFileWithContent extends SkillFile {
  content: string;
}

export function skillsApi(client: KanectaApiClient) {
  return {
    list: () => client.skills.list() as unknown as Promise<SkillFile[]>,
    get: (id: string) => client.skills.get(id) as unknown as Promise<SkillFileWithContent>,
    update: (id: string, content: string) =>
      client.skills.update(id, content) as unknown as Promise<SkillFile>,
  };
}
