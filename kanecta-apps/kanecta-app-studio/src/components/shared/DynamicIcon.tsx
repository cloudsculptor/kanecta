import type { SvgIconProps } from '@mui/material/SvgIcon';
import { TYPE_ICON_REGISTRY } from '../../lib/typeIconRegistry';

export function DynamicIcon({ name, ...props }: { name: string } & SvgIconProps) {
  const Icon = TYPE_ICON_REGISTRY[name];
  if (!Icon) return null;
  return <Icon {...props} />;
}
