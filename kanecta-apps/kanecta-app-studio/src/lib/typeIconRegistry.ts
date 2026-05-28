import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BookmarkBorderOutlinedIcon from '@mui/icons-material/BookmarkBorderOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DescriptionIcon from '@mui/icons-material/Description';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import GitHubIcon from '@mui/icons-material/GitHub';
import PsychologyIcon from '@mui/icons-material/Psychology';
import TableChartIcon from '@mui/icons-material/TableChart';
import type { SvgIconComponent } from '@mui/icons-material';

export const TYPE_ICON_REGISTRY: Record<string, SvgIconComponent> = {
  AutoAwesome: AutoAwesomeIcon,
  BookmarkBorderOutlined: BookmarkBorderOutlinedIcon,
  CheckCircle: CheckCircleIcon,
  Checklist: ChecklistIcon,
  Description: DescriptionIcon,
  ElectricBolt: ElectricBoltIcon,
  GitHub: GitHubIcon,
  Psychology: PsychologyIcon,
  TableChart: TableChartIcon,
};
