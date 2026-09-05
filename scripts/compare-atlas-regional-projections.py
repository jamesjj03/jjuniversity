#!/usr/bin/env python3
"""Product-oriented projection review: identical world and regional extents.

Generated SVGs compare shapes and direction, not only full-globe silhouette.
World panels show a practical inhabited-world frame; no source geometry changes.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
from xml.sax.saxutils import escape
from rasterio.warp import transform

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("atlas_geo", ROOT / "scripts/build-atlas-geography-pack.py")
geo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geo)
CANDIDATES = [
    ("equal-earth", "Equal Earth · current", None),
    ("robinson", "Robinson", "+proj=robin +R=6371007.180918475 +units=m"),
    ("miller", "Miller cylindrical", "+proj=mill +R=6371007.180918475 +units=m"),
    ("mercator", "Mercator", "+proj=merc +R=6371007.180918475 +units=m"),
]
REGIONS = [("world", "World · 60°S to 84°N", [-180,-60,180,84]),
    ("japan", "Japan", [127,29,148,47]), ("india", "India", [66,5,100,39]),
    ("china", "China", [72,15,139,56]), ("europe", "Europe", [-13,34,38,63]),
    ("benelux", "Benelux · close exploration", [1.7,48.3,8,53.8])]
PALETTE = ["#76aeb2", "#d5b569", "#97af7e", "#d18178", "#a39fbe", "#74aa9c", "#c89b6d"]
IDENTITY = {"USA":"#658fbd","CAN":"#d89073","MEX":"#70a78d","FRA":"#668eb5","GBR":"#c77c89","CHN":"#d37b70","RUS":"#b7a77c","IND":"#ddb668","JPN":"#bb9ba4","AUS":"#c7ae76","BRA":"#83ae80"}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT/"output/atlas-finish/projections")
    args=parser.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    lock=json.loads((ROOT/"data/atlas/sources.lock.json").read_text("utf8"))
    source=next(s for s in lock["sources"] if s["id"]=="natural-earth-admin-0-50m-5.1.2")
    source_path=ROOT/lock["cacheDirectory"]/source["target"]
    assert geo.sha256_file(source_path)==source["checksumSha256"]
    features=json.loads(source_path.read_text("utf8"))["features"]
    for region_id,region_title,bounds in REGIONS:
        pieces=['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1120" viewBox="0 0 1600 1120"><rect width="1600" height="1120" fill="#111c28"/>',f'<text x="32" y="36" fill="#f4ede0" font-family="Georgia" font-size="26">Atlas / {escape(region_title)}</text><text x="32" y="61" fill="#afbfc7" font-family="sans-serif" font-size="14">Same source polygons, geographic extent and country colors. Regional panels fitted independently; north stays up.</text>']
        for i,(projection_id,title,crs) in enumerate(CANDIDATES):
            left=24+(i%2)*788; top=86+(i//2)*503; width=764; height=468
            west,south,east,north=bounds
            def raw(points):
                if crs is None: return [geo.equal_earth_raw(x,y) for x,y,*_ in points]
                x,y=transform("EPSG:4326",crs,[p[0] for p in points],[max(-85,min(85,p[1])) for p in points])
                return list(zip(x,[-v for v in y]))
            edge=[(west+(east-west)*j/100,south) for j in range(101)]+[(east,south+(north-south)*j/100) for j in range(101)]+[(east-(east-west)*j/100,north) for j in range(101)]+[(west,north-(north-south)*j/100) for j in range(101)]
            projected=raw(edge); xs=[p[0] for p in projected]; ys=[p[1] for p in projected]
            scale=min((width-24)/(max(xs)-min(xs)),(height-60)/(max(ys)-min(ys)))
            tx=left+width/2-(max(xs)+min(xs))/2*scale; ty=top+height/2+20-(max(ys)+min(ys))/2*scale
            def path(points,closed=False):
                return ''.join(f'{"M" if j==0 else "L"}{x*scale+tx:.2f},{y*scale+ty:.2f}' for j,(x,y) in enumerate(raw(points)))+('Z' if closed else '')
            clip=f'clip-{i}'; pieces.append(f'<defs><clipPath id="{clip}"><rect x="{left}" y="{top+40}" width="{width}" height="{height-40}"/></clipPath></defs><rect x="{left}" y="{top}" width="{width}" height="{height}" rx="8" fill="#20374b"/><text x="{left+16}" y="{top+27}" fill="#f4ede0" font-size="20" font-family="Georgia">{escape(title)}</text><g clip-path="url(#{clip})">')
            for lon in range(-180,181,10 if region_id!='world' else 30):
                pieces.append(f'<path d="{path([(lon,lat) for lat in range(-85,86)])}" fill="none" stroke="#9bb7c7" stroke-opacity=".15" stroke-width=".6"/>')
            for lat in range(-80,90,10 if region_id!='world' else 30):
                pieces.append(f'<path d="{path([(lon,lat) for lon in range(-180,181)])}" fill="none" stroke="#9bb7c7" stroke-opacity=".15" stroke-width=".6"/>')
            for feature in features:
                geometry=feature['geometry']; polygons=geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
                shape=''.join(path(ring,True) for polygon in polygons for ring in polygon)
                props=feature['properties']; color=IDENTITY.get(props['ADM0_A3'],PALETTE[(int(props.get('MAPCOLOR7') or 1)-1)%7])
                pieces.append(f'<path d="{shape}" fill="{color}" stroke="#344656" stroke-width=".7" fill-rule="evenodd"/>')
            pieces.append('</g>')
        pieces.append('<text x="32" y="1101" fill="#afbfc7" font-size="13" font-family="sans-serif">Natural Earth 1:50m v5.1.2 · WGS84 canonical data unchanged · Miller/Mercator north–south meridians stay vertical; both inflate high-latitude area.</text></svg>')
        (args.output/f'{region_id}.svg').write_text(''.join(pieces),'utf8')
    print(json.dumps({'output':str(args.output),'regions':[r[0] for r in REGIONS],'candidates':[c[0] for c in CANDIDATES]}))

if __name__=='__main__': main()
