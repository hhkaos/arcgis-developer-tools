# ArcGIS Developer Tools

This repository collects small ArcGIS-focused utilities, experiments, and workflow helpers. Most of them are browser-based tools that can be hosted as static apps.

## Table of contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Available tools](#available-tools)
  - [Styling and cartography](#styling-and-cartography)
    - [ArcGIS Vector Style Custom Source](#arcgis-vector-style-custom-source)
    - [Basemap Effects Code Explorer](#basemap-effects-code-explorer)
    - [Blend Modes Explorer](#blend-modes-explorer)
    - [Layer Palette](#layer-palette)
  - [Map exploration and app prototyping](#map-exploration-and-app-prototyping)
    - [Coverage Map Generator](#coverage-map-generator)
    - [WebMap Multiview Explorer](#webmap-multiview-explorer)
  - [3D and scene workflows](#3d-and-scene-workflows)
    - [Get Scene Camera Snippet](#get-scene-camera-snippet)
    - [glTF Placement](#gltf-placement)
- [Notes](#notes)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Available tools

### Styling and cartography

#### ArcGIS Vector Style Custom Source

[![ArcGIS Vector Style Custom Source preview](./arcgis-vector-style-custom-source/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/arcgis-vector-style-custom-source/)

- Live: [arcgis-vector-style-custom-source](https://hhkaos.github.io/arcgis-developer-tools/arcgis-vector-style-custom-source/)
- Source: [arcgis-vector-style-custom-source](./arcgis-vector-style-custom-source/)
- Experimental vector style merge tool for loading ArcGIS vector tile styles, combining sources, inspecting style structure, and rearranging layers outside the official style editor.

#### Basemap Effects Code Explorer

[![Basemap Effects Code Explorer preview](./basemap-effects-code-explorer/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/basemap-effects-code-explorer/)

- Live: [basemap-effects-code-explorer](https://hhkaos.github.io/arcgis-developer-tools/basemap-effects-code-explorer/)
- Source: [basemap-effects-code-explorer](./basemap-effects-code-explorer/)
- Explorer for testing basemap visual effects in 2D and 3D, loading maps by item ID, comparing rendering support, and generating code for the active configuration.

#### Blend Modes Explorer

[![Blend Modes Explorer preview](./blend-modes-explorer/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/blend-modes-explorer/)

- Live: [blend-modes-explorer](https://hhkaos.github.io/arcgis-developer-tools/blend-modes-explorer/)
- Source: [blend-modes-explorer](./blend-modes-explorer/)
- Playground for understanding ArcGIS layer blend modes, with grouped mode explanations and an interactive map to compare visual outcomes.

#### Layer Palette

[![Layer Palette preview](./layer-palette/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/layer-palette/)

- Live: [layer-palette](https://hhkaos.github.io/arcgis-developer-tools/layer-palette/)
- Source: [layer-palette](./layer-palette/)
- Curated catalog of ArcGIS layers and external references used to build custom basemaps, with search, metadata previews, and quick links into Map Viewer.

### Map exploration and app prototyping

#### Coverage Map Generator

[![Coverage Map Generator preview](./coverage_map_generator/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/coverage_map_generator/)

- Live: [coverage_map_generator](https://hhkaos.github.io/arcgis-developer-tools/coverage_map_generator/)
- Source: [coverage_map_generator](./coverage_map_generator/)
- Utility for generating coverage maps from public layers, private layers, or uploaded GeoJSON, then reviewing, dissolving, and downloading the resulting outputs.

#### WebMap Multiview Explorer

[![WebMap Multiview Explorer preview](./webmap-multiview-explorer/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/webmap-multiview-explorer/)

- Live: [webmap-multiview-explorer](https://hhkaos.github.io/arcgis-developer-tools/webmap-multiview-explorer/)
- Source: [webmap-multiview-explorer](./webmap-multiview-explorer/)
- Multi-view web map explorer that loads a WebMap by item ID and shows one main view plus synchronized comparison views at multiple zoom levels.

### 3D and scene workflows

#### Get Scene Camera Snippet

[![Get Scene Camera Snippet preview](./get-scene-camera-snippet/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/get-scene-camera-snippet/)

- Live: [get-scene-camera-snippet](https://hhkaos.github.io/arcgis-developer-tools/get-scene-camera-snippet/)
- Source: [get-scene-camera-snippet](./get-scene-camera-snippet/)
- Scene helper that watches the current 3D camera and continuously generates a copyable `<arcgis-scene>` snippet with the live camera position, tilt, and heading.

#### glTF Placement

[![glTF Placement preview](./gltf-placement/preview.png)](https://hhkaos.github.io/arcgis-developer-tools/gltf-placement/)

- Live: [gltf-placement](https://hhkaos.github.io/arcgis-developer-tools/gltf-placement/)
- Source: [gltf-placement](./gltf-placement/)
- 3D placement tool for dropping preset or uploaded glTF models into a scene, exporting placement JSON, and creating or applying polygon masks.

## Notes

- Folder names are the deployment paths used for GitHub Pages.
- Some tools are polished utilities and some are intentionally experimental prototypes.
- A few projects use framework-less HTML/JS, while others use Vite-based setups for local development.
