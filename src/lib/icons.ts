/**
 * Jedno miejsce, z którego portal bierze ikony.
 *
 * Do 28.08 komponenty importowały wprost z `lucide-react`, każdy po swojemu, w
 * 39 plikach. Zmiana biblioteki znaczyła wtedy 39 osobnych decyzji, więc
 * zestaw ikon był de facto nie do wymiany. Teraz wymiana to jeden plik.
 *
 * Wybrany zestaw: **Heroicons 20 solid** (@heroicons/react/20/solid). Wypełnione
 * glify rysowane pod 20 px czytają się na karcie kanbana wyraźnie lepiej niż
 * kontur o grubości 1.5-2 px, który przy 12-14 px robi się szary i mielony.
 * Wariant `24 outline` odpadł właśnie na czytelności, `16 solid` na tym, że
 * rysunek jest zbyt zbity.
 *
 * Nazwy eksportów zostają TE, KTÓRE JUŻ SĄ W KODZIE (`X`, `Loader2`,
 * `Trash2`...), bo dzięki temu podmiana biblioteki nie dotknęła ani jednej
 * linii JSX: w komponentach zmienił się wyłącznie adres importu. Nazwy niosą
 * ślad lucide i to jest świadomy koszt, zapłacony raz, za brak ryzyka w 39
 * plikach naraz.
 *
 * Heroicons ma ~300 ikon (lucide ~1600), więc trzy rzeczy nie miały
 * odpowiednika 1:1 i dostały zamiennik, nie kalkę:
 *   - `Timer` (Track Time) → `PlayIcon`. Stopera w Heroicons nie ma; play
 *     czyta się w 14 px najlepiej z tego, co jest (decyzja Łukasza 28.08).
 *   - `Stethoscope` (test połączenia SitePing) → `SignalIcon`, bo o łączność
 *     tam chodzi, nie o diagnozę pacjenta.
 *   - `ToggleRight`/`ToggleLeft` (konto aktywne / wyłączone) → `CheckCircle` /
 *     `MinusCircle`. Przełącznika-suwaka Heroicons nie rysuje wcale.
 */
export {
  // Stany i komunikaty
  ArrowPathIcon as Loader2,
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as CheckCircle2,
  CheckCircleIcon as CheckSquare,
  CheckIcon as Check,
  CheckIcon as CheckIcon,
  XCircleIcon as XCircle,
  XMarkIcon as X,
  XMarkIcon as XIcon,
  ExclamationTriangleIcon as AlertTriangle,
  MinusIcon as Minus,
  NoSymbolIcon as Ban,
  BellIcon as Bell,
  LightBulbIcon as Lightbulb,

  // Nawigacja i kierunki
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  ChevronRightIcon as ChevronRightIcon,
  ChevronLeftIcon as ChevronLeft,
  ArrowRightIcon as ArrowRight,
  ArrowsRightLeftIcon as ArrowRightLeft,
  ArrowTurnDownRightIcon as CornerDownRight,
  ArrowTopRightOnSquareIcon as ExternalLink,
  ArrowRightEndOnRectangleIcon as LogIn,
  ArrowLeftStartOnRectangleIcon as LogOut,

  // Czas i daty
  CalendarIcon as Calendar,
  ClockIcon as Clock,
  ClockIcon as History,
  PlayIcon as Timer,

  // Treść, pliki, akcje
  PaperAirplaneIcon as Send,
  PaperClipIcon as Paperclip,
  ChatBubbleLeftIcon as MessageSquare,
  DocumentTextIcon as FileText,
  DocumentPlusIcon as FilePlus2,
  DocumentDuplicateIcon as Copy,
  FolderPlusIcon as FolderPlus,
  QueueListIcon as ListTree,
  PlusIcon as Plus,
  TrashIcon as Trash2,
  PencilIcon as Pencil,
  PencilIcon as PenLine,
  ArrowUpTrayIcon as Upload,
  MagnifyingGlassIcon as Search,
  ChartBarIcon as BarChart3,

  // Ludzie, dostęp, urządzenia
  UserIcon as User,
  UserIcon as UserRound,
  UserPlusIcon as UserPlus,
  KeyIcon as KeyRound,
  ShieldCheckIcon as ShieldCheck,
  ShieldExclamationIcon as ShieldAlert,
  EnvelopeIcon as Mail,
  PhoneIcon as Phone,
  ComputerDesktopIcon as Monitor,
  SunIcon as Sun,
  MoonIcon as Moon,
  SparklesIcon as Bot,

  // Zamienniki bez odpowiednika 1:1 (patrz komentarz na górze pliku)
  SignalIcon as Stethoscope,
  CheckCircleIcon as ToggleRight,
  MinusCircleIcon as ToggleLeft,
  /** Kropka zaznaczenia w menu radio (shadcn). Heroicons nie ma zwyklego kola. */
  StopCircleIcon as CircleIcon,
} from '@heroicons/react/20/solid'
