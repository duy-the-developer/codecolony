import {
  BotIcon,
  BotMessageSquareIcon,
  BotOffIcon,
  GitPullRequestArrowIcon,
  HourglassIcon,
  type LucideIcon,
  OctagonAlertIcon,
} from 'lucide-react'
import { COLONIST_GLYPHS, type ColonistGlyph } from '../../../modules/theme/colonist-glyphs.ts'
import { COLONIST_COLORS } from '../../../modules/theme/palette.ts'
import type { ColonistStatus } from '../../../modules/wire/api-types.ts'
import { cn } from '../ui/class-names.ts'

const ICONS: Record<ColonistGlyph, LucideIcon> = {
  bot: BotIcon,
  hourglass: HourglassIcon,
  'bot-message-square': BotMessageSquareIcon,
  'octagon-alert': OctagonAlertIcon,
  'bot-off': BotOffIcon,
  'git-pull-request-arrow': GitPullRequestArrowIcon,
}

export interface ColonistIconProps {
  status: ColonistStatus
  className?: string
  // A working robot bobs; off where motion would distract.
  canMove?: boolean
}

// A colonist's robot in its status colour, as on the map.
export function ColonistIcon({ status, className, canMove = false }: ColonistIconProps) {
  const Icon = ICONS[COLONIST_GLYPHS[status]]
  return (
    <Icon
      aria-hidden
      strokeWidth={2.25}
      className={cn(
        'size-4 shrink-0',
        status === 'idle' && 'opacity-55',
        canMove && status === 'working' && 'animate-colonist-bob',
        className,
      )}
      style={{ color: COLONIST_COLORS[status] }}
    />
  )
}
