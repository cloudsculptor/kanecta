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
import type { SvgIconComponent } from '@mui/icons-material';
import type { ItemType } from '../types/kanecta';

export const TYPE_ICONS: Record<ItemType, SvgIconComponent> = {
  number: NumbersIcon,
  claim: RecordVoiceOverIcon,
  question: HelpOutlineIcon,
  task: TaskAltIcon,
  note: StickyNote2Icon,
  concept: LightbulbIcon,
  entity: PersonIcon,
  event: CalendarTodayIcon,
  text: StopRoundedIcon,
  code: CodeIcon,
  url: LinkIcon,
  heading: AddBoxRoundedIcon,
  image: ImageIcon,
  file: InsertDriveFileIcon,
  object: DataObjectIcon,
};

export { HelpOutlineIcon as FallbackIcon };
