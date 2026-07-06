import './WorkspaceIndicator.scss';

export interface WorkspaceIndicatorProps {
  colour: string;
  name: string;
  size?: 'sm' | 'md';
}

export function WorkspaceIndicator({ colour, name, size = 'sm' }: WorkspaceIndicatorProps) {
  return (
    <span
      className={`WorkspaceIndicator WorkspaceIndicator--${size}`}
      style={{ background: colour }}
      title={name}
      aria-label={`Workspace: ${name}`}
    />
  );
}
