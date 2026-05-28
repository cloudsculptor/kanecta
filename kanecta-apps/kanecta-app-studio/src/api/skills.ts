import type { ApiClient } from './client';

export interface SkillFile {
  id: string;
  title: string;
  filename: string;
}

export interface SkillFileWithContent extends SkillFile {
  content: string;
}

export function skillsApi(client: ApiClient) {
  return {
    list: () => client.get<SkillFile[]>('/skills'),
    get: (id: string) => client.get<SkillFileWithContent>(`/skills/${id}`),
    update: (id: string, content: string) =>
      client.put<SkillFile>(`/skills/${id}`, { content }),
  };
}
