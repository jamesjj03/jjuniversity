import { projectAtlasWgs84 } from "./projection";

type Placement = { at: [number, number]; angle?: number; name?: string; priority?: number; minimumZoom?: number };
/** Authored reading anchors, not geographic centroids or new source facts. */
const placements: Record<string, Placement> = {
  USA:{at:[-101,39],name:"United States",priority:0}, CAN:{at:[-104,59],priority:0},
  BRA:{at:[-52,-10],angle:-8,priority:0}, RUS:{at:[97,61],priority:0},
  CHN:{at:[103,36],priority:0}, IND:{at:[79,22],priority:0}, AUS:{at:[134,-25],priority:0},
  // These large shapes have useful regional labels, but neither is a primary
  // world-view anchor. Keeping the threshold explicit avoids accidental
  // survival merely because an area or population score happened to win.
  DZA:{at:[2,28],minimumZoom:1.8}, COD:{at:[23,-3],name:"DR Congo",minimumZoom:1.8},
  MEX:{at:[-102,24],angle:22,priority:1}, ARG:{at:[-65,-37],angle:65}, CHL:{at:[-71,-31],angle:82},
  JPN:{at:[138,36],angle:-48}, NOR:{at:[9,62],angle:-55}, ITA:{at:[12.5,43],angle:43},
  FRA:{at:[2.2,46.5]}, GBR:{at:[-2.8,54],name:"United Kingdom"},
  ESP:{at:[-4,40]}, DEU:{at:[10.5,51.2]}, POL:{at:[19,52]}, UKR:{at:[32,49]},
  TUR:{at:[35,39]}, IRN:{at:[54,32]}, SAU:{at:[44,24]}, EGY:{at:[29,27]},
  ZAF:{at:[25,-30]}, NGA:{at:[8,9]}, ETH:{at:[39,8]}, SDN:{at:[30,16]},
  KAZ:{at:[67,48]}, MNG:{at:[103,46]}, IDN:{at:[113,-1]}, PNG:{at:[144,-6]},
};

export function atlasLabelPlacement(entityId: string) {
  const value = placements[entityId.split(":").at(-1) ?? ""];
  return value ? { ...value, point: projectAtlasWgs84(value.at) } : null;
}
