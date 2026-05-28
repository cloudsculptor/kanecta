import { useState, useEffect, memo } from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';

type SvgIconComponent = React.ComponentType<SvgIconProps>;

const cache = new Map<string, SvgIconComponent>();

export const DynamicIcon = memo(({ name, ...props }: { name: string } & SvgIconProps) => {
  const [Icon, setIcon] = useState<SvgIconComponent | null>(() => cache.get(name) ?? null);

  useEffect(() => {
    if (cache.has(name)) {
      setIcon(() => cache.get(name)!);
      return;
    }
    import(`@mui/icons-material/${name}`)
      .then((mod: { default: SvgIconComponent }) => {
        cache.set(name, mod.default);
        setIcon(() => mod.default);
      })
      .catch((e) => console.warn(`DynamicIcon: failed to load "${name}"`, e));
  }, [name]);

  if (!Icon) return null;
  return <Icon {...props} />;
});
