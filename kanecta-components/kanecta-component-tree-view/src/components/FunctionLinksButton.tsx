import { useEffect, useRef, useState } from 'react';
import {
  ButtonGroup, Button, Paper, Popper, ClickAwayListener,
  MenuList, MenuItem, ListSubheader, Grow, Box,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useTreeViewContext } from '../context';
import { RunFunctionDialog } from './RunFunctionDialog';
import type { KanectaItem } from '../types';

interface FunctionLink {
  id: string;
  name: string;
  fnItem: KanectaItem;
  group: 'consumedBy' | 'producedBy';
}

interface Props {
  item: KanectaItem;
}

export function FunctionLinksButton({ item }: Props) {
  const { api } = useTreeViewContext();
  const [links, setLinks] = useState<FunctionLink[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [runItem, setRunItem] = useState<KanectaItem | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!item.typeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLinks([]);
    setSelectedIndex(0);

    api.types.schema(item.typeId)
      .then(async (schema) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = (schema as any)?.meta;
        const consumedByIds: string[] = meta?.functions?.consumedBy ?? [];
        const producedByIds: string[] = meta?.functions?.producedBy ?? [];
        if (!consumedByIds.length && !producedByIds.length) return;

        const entries = [
          ...consumedByIds.map((id) => ({ id, group: 'consumedBy' as const })),
          ...producedByIds.map((id) => ({ id, group: 'producedBy' as const })),
        ];

        const resolved = await Promise.all(
          entries.map(async ({ id, group }) => {
            const fnItem = await api.items.get(id).catch(() => null);
            if (!fnItem) return null;
            return { id, name: fnItem.value, fnItem, group } satisfies FunctionLink;
          }),
        );

        setLinks(resolved.filter((x): x is FunctionLink => x !== null));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.typeId]);

  if (!links.length) return null;

  const selected = links[selectedIndex] ?? links[0];
  const consumedBy = links.filter((l) => l.group === 'consumedBy');
  const producedBy = links.filter((l) => l.group === 'producedBy');

  const handleMainClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRunItem(selected.fnItem);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((o) => !o);
  };

  const handleSelect = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSelectedIndex(index);
    setMenuOpen(false);
    setRunItem(links[index].fnItem);
  };

  return (
    <Box sx={{ display: 'contents' }}>
      <ButtonGroup
        ref={(el) => { anchorRef.current = el; setAnchorEl(el); }}
        variant="contained"
        size="small"
        sx={{
          mr: 3,
          boxShadow: 2,
          flexShrink: 0,
          bgcolor: 'success.main',
          borderRadius: '12px',
          overflow: 'hidden',
          '& .MuiButtonGroup-grouped': { borderColor: 'success.dark' },
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          onClick={handleMainClick}
          sx={{
            bgcolor: 'success.main', color: 'success.contrastText',
            fontSize: '0.75rem', py: 0.25, px: '12px', textTransform: 'none',
            gap: 0.5,
            '&:hover': { bgcolor: 'success.dark' },
          }}
        >
          <PlayArrowIcon sx={{ fontSize: '14px' }} />
          {selected.name}
        </Button>
        <Button
          onClick={handleToggle}
          sx={{
            bgcolor: 'success.main', color: 'success.contrastText',
            px: 0.25, minWidth: '24px !important',
            '&:hover': { bgcolor: 'success.dark' },
          }}
        >
          <ArrowDropDownIcon sx={{ fontSize: '18px' }} />
        </Button>
      </ButtonGroup>

      <Popper
        open={menuOpen}
        anchorEl={anchorEl}
        placement="bottom-start"
        transition
        style={{ zIndex: 1300 }}
      >
        {({ TransitionProps, placement }) => (
          <Grow
            {...TransitionProps}
            style={{ transformOrigin: placement === 'bottom-start' ? 'left top' : 'left bottom' }}
          >
            <Paper elevation={4}>
              <ClickAwayListener onClickAway={() => setMenuOpen(false)}>
                <MenuList dense disablePadding>
                  {consumedBy.length > 0 && (
                    <ListSubheader sx={{ lineHeight: '28px', fontSize: '0.7rem', bgcolor: 'transparent' }}>
                      Consumed by
                    </ListSubheader>
                  )}
                  {consumedBy.map((link) => {
                    const idx = links.indexOf(link);
                    return (
                      <MenuItem
                        key={link.id}
                        selected={idx === selectedIndex}
                        onClick={(e) => handleSelect(e, idx)}
                        sx={{ fontSize: '0.8125rem', pl: 2 }}
                      >
                        {link.name}
                      </MenuItem>
                    );
                  })}
                  {producedBy.length > 0 && (
                    <ListSubheader sx={{ lineHeight: '28px', fontSize: '0.7rem', bgcolor: 'transparent' }}>
                      Produced by
                    </ListSubheader>
                  )}
                  {producedBy.map((link) => {
                    const idx = links.indexOf(link);
                    return (
                      <MenuItem
                        key={link.id}
                        selected={idx === selectedIndex}
                        onClick={(e) => handleSelect(e, idx)}
                        sx={{ fontSize: '0.8125rem', pl: 2 }}
                      >
                        {link.name}
                      </MenuItem>
                    );
                  })}
                </MenuList>
              </ClickAwayListener>
            </Paper>
          </Grow>
        )}
      </Popper>

      {runItem && (
        <RunFunctionDialog
          open
          item={runItem}
          onClose={() => setRunItem(null)}
        />
      )}
    </Box>
  );
}
