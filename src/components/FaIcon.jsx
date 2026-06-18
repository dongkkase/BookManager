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
  faFile,
  faFileLines,
  faFloppyDisk,
  faFolder,
  faGear,
  faHouse,
  faLanguage,
  faLayerGroup,
  faLink,
  faMagnifyingGlass,
  faSquareCheck,
  faStar,
  faTag,
  faTrash,
  faUser,
  faWandMagicSparkles,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

const ICONS = {
  folder: faFolder,
  file: faFile,
  minusCircle: faCircleMinus,
  trash: faTrash,
  checkSquare: faSquareCheck,
  bug: faBug,
  circleCheck: faCircleCheck,
  gear: faGear,
  search: faMagnifyingGlass,
  floppy: faFloppyDisk,
  wand: faWandMagicSparkles,
  archive: faBoxArchive,
  eye: faEye,
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
  language: faLanguage,
  layers: faLayerGroup,
  'layer-group': faLayerGroup,
  child: faChild,
  calendar: faCalendarDays,
  link: faLink,
};

function FaIcon({ name, className = '', title, size = 14 }) {
  const icon = ICONS[name];
  if (!icon) return null;

  return (
    <FontAwesomeIcon
      icon={icon}
      className={`fa-icon ${className}`.trim()}
      title={title}
      aria-hidden={title ? undefined : true}
      style={{ width: size, height: size }}
    />
  );
}

export { FaIcon };
export default FaIcon;
