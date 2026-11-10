"""把 ECharts 4.9.0 内置的 china.json（压缩编码）解码为普通经纬度坐标，输出 china-provinces.js。

用法:
    npm pack echarts@4.9.0 && tar xzf echarts-4.9.0.tgz package/map/json/china.json
    python3 build_geo.py package/map/json/china.json ../china-provinces.js

数据来源：Apache ECharts 4.9.0（Apache-2.0）。该数据未经审图，详见 README「地图合规」。
"""
import json
import sys


def decode_ring(s, offset, scale=1024.0):
    out = []
    px, py = offset
    for i in range(0, len(s), 2):
        x = ord(s[i]) - 64
        y = ord(s[i + 1]) - 64
        x = (x >> 1) ^ (-(x & 1))
        y = (y >> 1) ^ (-(y & 1))
        x += px
        y += py
        px, py = x, y
        out.append([round(x / scale, 3), round(y / scale, 3)])
    return out


def main(src, dst):
    data = json.load(open(src, encoding="utf-8"))
    assert data.get("UTF8Encoding"), "expected echarts-encoded geojson"
    provinces = []
    for f in data["features"]:
        g = f["geometry"]
        offs = g["encodeOffsets"]
        if g["type"] == "Polygon":
            polys = [[decode_ring(r, offs[j]) for j, r in enumerate(g["coordinates"])]]
        else:
            polys = [[decode_ring(r, offs[i][j]) for j, r in enumerate(poly)]
                     for i, poly in enumerate(g["coordinates"])]
        provinces.append({
            "id": f["properties"]["id"],
            "name": f["properties"]["name"],
            "polygons": polys,
        })
    provinces.sort(key=lambda p: p["id"])

    # 南海诸岛示意框（来自 echarts/src/coord/geo/fix/nanhai.js），仅作描线展示，不参与点亮。
    pts = [
        [[0, 3.5], [7, 11.2], [15, 11.9], [30, 7], [42, 0.7], [52, 0.7], [56, 7.7], [59, 0.7], [64, 0.7], [64, 0], [5, 0], [0, 3.5]],
        [[13, 16.1], [19, 14.7], [16, 21.7], [11, 23.1], [13, 16.1]],
        [[12, 32.2], [14, 38.5], [15, 38.5], [13, 32.2], [12, 32.2]],
        [[16, 47.6], [12, 53.2], [13, 53.2], [18, 47.6], [16, 47.6]],
        [[6, 64.4], [8, 70], [9, 70], [8, 64.4], [6, 64.4]],
        [[23, 82.6], [29, 79.8], [30, 79.8], [25, 82.6], [23, 82.6]],
        [[37, 70.7], [43, 62.3], [44, 62.3], [39, 70.7], [37, 70.7]],
        [[48, 51.1], [51, 45.5], [53, 45.5], [50, 51.1], [48, 51.1]],
        [[51, 35], [51, 28.7], [53, 28.7], [53, 35], [51, 35]],
        [[52, 22.4], [55, 17.5], [56, 17.5], [53, 22.4], [52, 22.4]],
        [[58, 12.6], [62, 7], [63, 7], [60, 12.6], [58, 12.6]],
        [[0, 3.5], [0, 93.1], [64, 93.1], [64, 0], [63, 0], [63, 92.4], [1, 92.4], [1, 3.5], [0, 3.5]],
    ]
    nanhai = [[[round(x / 10.5 + 126, 3), round(y / (-10.5 / 0.75) + 25, 3)] for x, y in ring] for ring in pts]

    js = ("// 自动生成，勿手改。来源：Apache ECharts 4.9.0 map/json/china.json（Apache-2.0），见 tools/build_geo.py\n"
          "window.CHINA_PROVINCES = " + json.dumps(provinces, ensure_ascii=False, separators=(",", ":")) + ";\n"
          "window.CHINA_NANHAI = " + json.dumps(nanhai, separators=(",", ":")) + ";\n")
    open(dst, "w", encoding="utf-8").write(js)
    print(f"wrote {len(provinces)} provinces, {len(js)} bytes -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
