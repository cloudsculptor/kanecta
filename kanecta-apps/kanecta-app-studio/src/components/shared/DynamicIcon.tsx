import * as MuiIcons from '@mui/icons-material';
import type { SvgIconComponent } from '@mui/icons-material';
import type { SvgIconProps } from '@mui/material/SvgIcon';

export function DynamicIcon({ name, ...props }: { name: string } & SvgIconProps) {
  const Icon = (MuiIcons as Record<string, SvgIconComponent>)[name];
  if (!Icon) return null;
  return <Icon {...props} />;
}
