import NumbersIcon from '@mui/icons-material/Numbers';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import StickyNote2Icon from '@mui/icons-material/StickyNote2';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import PersonIcon from '@mui/icons-material/Person';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import CodeIcon from '@mui/icons-material/Code';
import LinkIcon from '@mui/icons-material/Link';
import AddBoxRoundedIcon from '@mui/icons-material/AddBoxRounded';
import ImageIcon from '@mui/icons-material/Image';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import DataObjectIcon from '@mui/icons-material/DataObject';
import AbcIcon from '@mui/icons-material/Abc';
import ShortcutIcon from '@mui/icons-material/Shortcut';
import BalanceIcon from '@mui/icons-material/Balance';
import CommentIcon from '@mui/icons-material/Comment';
import type { SvgIconComponent } from '@mui/icons-material';
import type { ItemType } from '../types/kanecta';

export const TYPE_ICONS: Record<ItemType, SvgIconComponent> = {
  string:     AbcIcon,
  number:     NumbersIcon,
  text:       StopRoundedIcon,
  heading:    AddBoxRoundedIcon,
  file:       InsertDriveFileIcon,
  symlink:    ShortcutIcon,
  url:        LinkIcon,
  image:      ImageIcon,
  function:   CodeIcon,
  object:     DataObjectIcon,
  decision:   BalanceIcon,
  annotation: CommentIcon,
  claim:      RecordVoiceOverIcon,
  question:   HelpOutlineIcon,
  task:       TaskAltIcon,
  note:       StickyNote2Icon,
  concept:    LightbulbIcon,
  entity:     PersonIcon,
  event:      CalendarTodayIcon,
};

export { HelpOutlineIcon as FallbackIcon };
