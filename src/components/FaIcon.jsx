import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRotateLeft,
  faBookOpen,
  faBoxArchive,
  faBug,
  faBuilding,
  faCalendarDays,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faChild,
  faCircleCheck,
  faCircleMinus,
  faCloudArrowDown,
  faCopy,
  faDesktop,
  faDownload,
  faEye,
  faEyeSlash,
  faFile,
  faFileSignature,
  faFileLines,
  faFloppyDisk,
  faFolder,
  faFolderMinus,
  faFolderOpen,
  faGear,
  faGift,
  faGripVertical,
  faHouse,
  faLanguage,
  faLayerGroup,
  faLink,
  faMagnifyingGlass,
  faPowerOff,
  faRocket,
  faSquareCheck,
  faSquare,
  faStopCircle,
  faStar,
  faTag,
  faTowerBroadcast,
  faTrash,
  faUser,
  faWandMagicSparkles,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

const ICONS = {
  folder: faFolder,
  folderOpen: faFolderOpen,
  folderMinus: faFolderMinus,
  file: faFile,
  fileSignature: faFileSignature,
  minusCircle: faCircleMinus,
  trash: faTrash,
  checkSquare: faSquareCheck,
  square: faSquare,
  stopCircle: faStopCircle,
  powerOff: faPowerOff,
  bug: faBug,
  circleCheck: faCircleCheck,
  gear: faGear,
  gift: faGift,
  gripVertical: faGripVertical,
  'grip-vertical': faGripVertical,
  search: faMagnifyingGlass,
  rocket: faRocket,
  floppy: faFloppyDisk,
  wand: faWandMagicSparkles,
  archive: faBoxArchive,
  eye: faEye,
  eyeSlash: faEyeSlash,
  bookOpen: faBookOpen,
  desktop: faDesktop,
  fileLines: faFileLines,
  download: faDownload,
  arrowRotateLeft: faArrowRotateLeft,
  cloudArrowDown: faCloudArrowDown,
  copy: faCopy,
  house: faHouse,
  star: faStar,
  chevronLeft: faChevronLeft,
  chevronRight: faChevronRight,
  xmark: faXmark,
  check: faCheck,
  user: faUser,
  building: faBuilding,
  tag: faTag,
  towerBroadcast: faTowerBroadcast,
  language: faLanguage,
  layers: faLayerGroup,
  'layer-group': faLayerGroup,
  child: faChild,
  calendar: faCalendarDays,
  link: faLink,
};

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

function FaIcon({ name, className = '', title, size = 14 }) {
  const icon = ICONS[name];
  if (!icon) return null;

  return (
    <FontAwesomeIcon
      icon={icon}
      className={`fa-icon ${className}`.trim()}
      title={title}
      aria-hidden={title ? undefined : true}
      style={{
        width: `calc(${size}px * var(--font-scale, 1))`,
        height: `calc(${size}px * var(--font-scale, 1))`,
      }}
    />
  );
}

export { FaIcon };
export default FaIcon;
