export const ATLAS_MAP_WIDTH = 1672;
export const ATLAS_MAP_HEIGHT = 941;

export type AtlasMapStagePlacement = {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  labelAlign?: "left" | "right";
};

export const ATLAS_MAP_STAGE_PLACEMENTS: Record<string, AtlasMapStagePlacement> = {
  "early-universe": {
    x: 92,
    y: 110,
    labelX: 42,
    labelY: 151,
  },
  "fundamental-forces-and-particles": {
    x: 375,
    y: 155,
    labelX: 308,
    labelY: 209,
  },
  atoms: {
    x: 764,
    y: 119,
    labelX: 736,
    labelY: 178,
  },
  "stars-and-heavy-elements": {
    x: 1127,
    y: 146,
    labelX: 1060,
    labelY: 202,
  },
  "planetary-systems": {
    x: 1122,
    y: 286,
    labelX: 1052,
    labelY: 220,
  },
  earth: {
    x: 1461,
    y: 316,
    labelX: 1410,
    labelY: 257,
    labelAlign: "right",
  },
  life: {
    x: 918,
    y: 421,
    labelX: 841,
    labelY: 354,
  },
  "multicellular-life": {
    x: 660,
    y: 544,
    labelX: 594,
    labelY: 474,
  },
  "nervous-systems": {
    x: 203,
    y: 415,
    labelX: 119,
    labelY: 343,
  },
  humans: {
    x: 279,
    y: 630,
    labelX: 213,
    labelY: 559,
  },
  culture: {
    x: 530,
    y: 745,
    labelX: 457,
    labelY: 675,
  },
  civilization: {
    x: 940,
    y: 742,
    labelX: 848,
    labelY: 670,
  },
  "science-technology-and-institutions": {
    x: 1302,
    y: 548,
    labelX: 1218,
    labelY: 466,
  },
  "present-day": {
    x: 1484,
    y: 812,
    labelX: 1412,
    labelY: 727,
  },
};

export const ATLAS_PRIMARY_ROUTE =
  "M 92 110 C 175 122 269 151 375 155 S 642 121 764 119 " +
  "S 1012 133 1127 146 C 1150 186 1147 242 1122 286 " +
  "C 1237 285 1367 287 1461 316 C 1327 362 1118 391 918 421 " +
  "C 825 465 748 517 660 544 C 510 483 359 428 203 415 " +
  "C 207 501 235 574 279 630 C 354 671 444 719 530 745 " +
  "C 664 753 805 755 940 742 C 1059 688 1184 607 1302 548 " +
  "C 1370 626 1438 728 1484 812";

export const ATLAS_BRANCH_OFFSETS = [
  { x: -76, y: 44 },
  { x: 72, y: -44 },
  { x: 83, y: 47 },
  { x: -69, y: -53 },
  { x: 7, y: 82 },
];
