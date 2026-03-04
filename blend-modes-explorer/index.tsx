import { createProjector, VNode } from "maquette";
import { jsx } from "maquette-jsx";

import WebMap from "@arcgis/core/WebMap";
import MapView from "@arcgis/core/views/MapView";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";

function renderCodeSnippet(language: string, snippet: string): VNode {
  return (
    <pre
      style="margin: 0; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;"
      data-language={language}
    >
      <code>{snippet}</code>
    </pre>
  );
}

interface State {
  activeTooltipId: string | null;
  activeTooltipLeft: number;
  activeTooltipText: string;
  activeTooltipTop: number;
  blendMode: __esri.BlendLayer["blendMode"];
  filterText: string;
  layerVisible: boolean;
  opacity: number;
  showExternalMap: boolean;
}

interface BlendModeOption {
  description: string;
  label: string;
  value: __esri.BlendLayer["blendMode"];
}

interface BlendModeCategory {
  description: string;
  modes: BlendModeOption[];
  title: string;
}

const normalBlendMode: BlendModeOption = {
  description:
    "Displays the layer using its original colors and opacity without blending it with the layers below.",
  label: "Normal",
  value: "normal",
};

const mapViewerUrl =
  "https://www.arcgis.com/apps/mapviewer/index.html?webmap=dd161d7bc6d1440893118b6c1f03d866&embedded=1&hide,analysis,legend,measure&locale=en-us";

const blendModeCategories: BlendModeCategory[] = [
  {
    description:
      "Lighten blend modes create a lighter result than the colors of the original layer. Black is the neutral point, and anything brighter than black affects the layer below it.",
    title: "Lighten",
    modes: [
      {
        description:
          "Colors in the top and background layers are multiplied by their alphas and then added together. Overlapping midrange colors are lightened.",
        label: "Lighter",
        value: "lighter",
      },
      {
        description:
          "Compares the top and background layers and keeps the lighter color. Darker top colors become transparent where the background is lighter.",
        label: "Lighten",
        value: "lighten",
      },
      {
        description:
          "Inverts the background colors and multiplies them with the top layer. The result is lighter with less contrast.",
        label: "Screen",
        value: "screen",
      },
      {
        description:
          "Creates a brighter effect by decreasing contrast between the top and background layers, producing saturated midtones and bright highlights.",
        label: "Color Dodge",
        value: "color-dodge",
      },
      {
        description:
          "Adds the colors of the top and background layers together, lightening overlapping midrange colors.",
        label: "Plus",
        value: "plus",
      },
    ],
  },
  {
    description:
      "Darken blend modes create darker results. Pure white in the top layer becomes transparent, while darker colors increasingly darken the layer.",
    title: "Darken",
    modes: [
      {
        description:
          "Emphasizes the darkest parts of overlapping layers. Lighter top colors become transparent where the background is darker.",
        label: "Darken",
        value: "darken",
      },
      {
        description:
          "Intensifies dark areas by increasing contrast and tinting overlapping colors toward the top color.",
        label: "Color Burn",
        value: "color-burn",
      },
      {
        description:
          "Emphasizes darker areas by multiplying the top and background colors, mixing midrange colors more evenly.",
        label: "Multiply",
        value: "multiply",
      },
    ],
  },
  {
    description:
      "Contrast blend modes increase contrast and saturation by lightening lighter areas and darkening darker areas.",
    title: "Contrast",
    modes: [
      {
        description:
          "Combines Multiply and Screen to darken and lighten the top layer while letting the background show through.",
        label: "Overlay",
        value: "overlay",
      },
      {
        description:
          "Multiplies or screens colors depending on the top layer, similar to shining a harsh spotlight on the layer.",
        label: "Hard Light",
        value: "hard-light",
      },
      {
        description:
          "Applies a softer mix of Screen to lighter areas and Multiply to darker areas. It is a softer version of Overlay.",
        label: "Soft Light",
        value: "soft-light",
      },
      {
        description:
          "Combines Color Burn and Color Dodge by increasing or decreasing contrast based on the colors in the top layer.",
        label: "Vivid Light",
        value: "vivid-light",
      },
    ],
  },
  {
    description:
      "Component blend modes use hue, saturation, and luminosity to blend the top and background layers.",
    title: "Component",
    modes: [
      {
        description:
          "Uses the hue and saturation of the top layer with the luminosity of the background layer.",
        label: "Color",
        value: "color",
      },
      {
        description:
          "Uses the hue of the top layer with the luminosity and saturation of the background layer.",
        label: "Hue",
        value: "hue",
      },
      {
        description:
          "Uses the saturation of the top layer with the hue and luminosity of the background layer.",
        label: "Saturation",
        value: "saturation",
      },
      {
        description:
          "Uses the luminosity of the top layer with the hue and saturation of the background layer.",
        label: "Luminosity",
        value: "luminosity",
      },
    ],
  },
  {
    description:
      "Compositing blend modes mask the top layer, the background layer, or both. Destination modes mask the top layer with the background, and source modes do the reverse.",
    title: "Compositing",
    modes: [
      {
        description:
          "The background layer covers the top layer. The top layer only shows through where the background is transparent or has no data.",
        label: "Destination Over",
        value: "destination-over",
      },
      {
        description:
          "The background layer is drawn only where it overlaps the top layer. The top layer shows through where the background is transparent or has no data.",
        label: "Destination Atop",
        value: "destination-atop",
      },
      {
        description:
          "The background layer is drawn only where it overlaps the top layer. Everything else becomes transparent.",
        label: "Destination In",
        value: "destination-in",
      },
      {
        description:
          "The background layer is drawn where it does not overlap the top layer. Everything else becomes transparent.",
        label: "Destination Out",
        value: "destination-out",
      },
      {
        description:
          "The top layer is drawn only where it overlaps the background layer. The background shows through where the top layer is transparent or has no data.",
        label: "Source Atop",
        value: "source-atop",
      },
      {
        description:
          "The top layer is drawn only where it overlaps the background layer. Everything else becomes transparent.",
        label: "Source In",
        value: "source-in",
      },
      {
        description:
          "The top layer is drawn where it does not overlap the background layer. Everything else becomes transparent.",
        label: "Source Out",
        value: "source-out",
      },
      {
        description:
          "Both layers become transparent where they overlap and are drawn normally everywhere else.",
        label: "XOR",
        value: "xor",
      },
    ],
  },
  {
    description:
      "Invert blend modes invert or cancel out colors depending on the background layer and help identify differences between overlapping layers.",
    title: "Invert",
    modes: [
      {
        description:
          "Inverts the background colors wherever the layers overlap, similar to a photographic negative.",
        label: "Invert",
        value: "invert",
      },
      {
        description:
          "Creates the appearance of shiny objects or added light. Black pixels in the background are ignored as if transparent.",
        label: "Reflect",
        value: "reflect",
      },
      {
        description:
          "Takes the mathematical average of the top and background layers, often similar to setting opacity to 50 percent.",
        label: "Average",
        value: "average",
      },
      {
        description:
          "Subtracts the darker overlapping color from the lighter one. Useful for aligning layers with similar content.",
        label: "Difference",
        value: "difference",
      },
      {
        description:
          "Similar to Difference, but the overall result is lighter. Lighter overlaps brighten and darker overlaps become transparent.",
        label: "Exclusion",
        value: "exclusion",
      },
      {
        description:
          "Subtracts the top layer colors from the background layer, darkening the result. Negative values display as black.",
        label: "Minus",
        value: "minus",
      },
    ],
  },
];

export function blendExplorerApplication() {
  let view: MapView | undefined;
  let layer: __esri.FeatureLayer;

  const state: State = {
    activeTooltipId: null,
    activeTooltipLeft: 0,
    activeTooltipText: "",
    activeTooltipTop: 0,
    blendMode: "normal",
    filterText: "",
    layerVisible: true,
    opacity: 1,
    showExternalMap: false,
  };

  function setState(props: Partial<State>) {
    Object.assign(state, props);
    if (layer) {
      layer.blendMode = state.blendMode;
      layer.visible = state.layerVisible;
      layer.opacity = state.opacity;
    }
    projector.scheduleRender();
  }

  function showTooltip(
    id: string,
    description: string,
    target: HTMLElement
  ): void {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 280;
    const horizontalPadding = 16;
    const verticalPadding = 16;
    const left = Math.min(
      rect.right + 8,
      window.innerWidth - tooltipWidth - horizontalPadding
    );
    const top = Math.min(
      Math.max(rect.top + rect.height / 2, verticalPadding),
      window.innerHeight - verticalPadding
    );

    setState({
      activeTooltipId: id,
      activeTooltipLeft: Math.max(horizontalPadding, left),
      activeTooltipText: description,
      activeTooltipTop: top,
    });
  }

  function hideTooltip(id: string): void {
    if (state.activeTooltipId !== id) {
      return;
    }

    setState({
      activeTooltipId: null,
      activeTooltipText: "",
    });
  }

  function renderInfoIcon(id: string, description: string): VNode {
    const isVisible = state.activeTooltipId === id;

    return (
      <span style="display: inline-flex; align-items: center;">
        <button
          aria-label="Show blend mode description"
          onclick={(event: MouseEvent) => {
            const target = event.currentTarget as HTMLElement;
            if (isVisible) {
              hideTooltip(id);
              return;
            }
            showTooltip(id, description, target);
          }}
          onblur={() => {
            hideTooltip(id);
          }}
          onmouseenter={(event: MouseEvent) => {
            showTooltip(id, description, event.currentTarget as HTMLElement);
          }}
          onmouseleave={() => {
            hideTooltip(id);
          }}
          style="display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                border: 1px solid var(--calcite-ui-border-1);
                color: var(--calcite-ui-text-2);
                font-size: 12px;
                cursor: help;
                background: var(--calcite-ui-foreground-1);
                padding: 0;"
          type="button"
        >
          i
        </button>
      </span>
    );
  }

  function renderBlendModeOption(option: BlendModeOption): VNode {
    return (
      <div
        key={option.value}
        style="display: flex;
              align-items: center;
              gap: 8px;
              padding: 4px 0;"
      >
        <button
          onclick={() => setState({ blendMode: option.value })}
          style={`flex: 1;
                border: 0;
                border-radius: 6px;
                text-align: left;
                padding: 8px 10px;
                cursor: pointer;
                background: ${
                  option.value === state.blendMode
                    ? "var(--calcite-ui-brand)"
                    : "transparent"
                };
                color: ${
                  option.value === state.blendMode
                    ? "var(--calcite-ui-text-inverse)"
                    : "var(--calcite-ui-text-1)"
                };`}
        >
          {option.label}
        </button>
        {renderInfoIcon(option.value, option.description)}
      </div>
    );
  }

  function renderLayerVisibilityToggle(): VNode {
    return (
      <div
        style="padding: 4px 0 10px;
              margin-bottom: 6px;
              border-bottom: 1px solid var(--calcite-ui-border-3);"
      >
        <div
          style="display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;"
        >
          <div
            style="font-size: 13px;
                  font-weight: 600;
                  color: var(--calcite-ui-text-1);"
          >
            Show layer
          </div>
          <button
            aria-pressed={state.layerVisible ? "true" : "false"}
            onclick={() => setState({ layerVisible: !state.layerVisible })}
            style={`position: relative;
                width: 42px;
                height: 24px;
                border: 0;
                border-radius: 999px;
                cursor: pointer;
                padding: 0;
                background: ${
                  state.layerVisible
                    ? "var(--calcite-ui-brand)"
                    : "var(--calcite-ui-border-2)"
                };`}
            type="button"
          >
            <span
              style={`position: absolute;
                  top: 3px;
                  left: ${state.layerVisible ? "21px" : "3px"};
                  width: 18px;
                  height: 18px;
                  border-radius: 50%;
                  background: white;
                  box-shadow: 0 1px 3px rgb(0 0 0 / 20%);`}
            ></span>
          </button>
        </div>
        <div style="margin-top: 12px;">
          <div
            style="display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 12px;
                  margin-bottom: 6px;"
          >
            <label
              for="layer-opacity"
              style="font-size: 13px;
                    font-weight: 600;
                    color: var(--calcite-ui-text-1);"
            >
              Opacity
            </label>
            <span
              style="font-size: 12px;
                    color: var(--calcite-ui-text-2);"
            >
              {`${Math.round(state.opacity * 100)}%`}
            </span>
          </div>
          <input
            id="layer-opacity"
            min="0"
            max="1"
            oninput={(event: Event) => {
              const target = event.target as HTMLInputElement;
              setState({ opacity: Number(target.value) });
            }}
            step="0.05"
            style="width: 100%;"
            type="range"
            value={String(state.opacity)}
          />
        </div>
      </div>
    );
  }

  function renderBlendModeCategory(category: BlendModeCategory): VNode[] {
    const normalizedFilter = state.filterText.trim().toLowerCase();
    const visibleModes = category.modes.filter((mode) => {
      if (!normalizedFilter) {
        return true;
      }

      return (
        mode.label.toLowerCase().includes(normalizedFilter) ||
        mode.description.toLowerCase().includes(normalizedFilter) ||
        category.title.toLowerCase().includes(normalizedFilter)
      );
    });

    if (!visibleModes.length) {
      return [];
    }

    return [
      <div
        key={`group-${category.title}`}
        style="display: flex;
              align-items: center;
              gap: 8px;
              margin: 14px 0 4px;"
      >
        <div
          style="flex: 1;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                color: var(--calcite-ui-text-2);"
        >
          {category.title}
        </div>
        {renderInfoIcon(`category-${category.title}`, category.description)}
      </div>,
      ...visibleModes.map((mode) => renderBlendModeOption(mode))
    ];
  }

  function renderHeaderActions(): VNode {
    return (
      <div style="display: flex; gap: 8px; align-items: center; margin-right: 16px;">
        <calcite-button
          appearance={state.showExternalMap ? "outline" : "solid"}
          onclick={() =>
            setState({
              activeTooltipId: null,
              activeTooltipText: "",
              showExternalMap: !state.showExternalMap,
            })
          }
          scale="s"
        >
          {state.showExternalMap ? "Back To App" : "Open Blend Modes Map"}
        </calcite-button>
      </div>
    );
  }

  function renderSidebar(): VNode {
    return (
      <div
        style={`display: ${state.showExternalMap ? "none" : "block"};
              width: 320px;
              min-width: 320px;
              height: 100%;
              border-right: 1px solid var(--calcite-ui-border-3);
              background: var(--calcite-ui-foreground-1);`}
      >
        <calcite-panel>
          <div style="padding: 12px;">
            <input
              oninput={(event: Event) => {
                const target = event.target as HTMLInputElement;
                setState({ filterText: target.value });
              }}
              placeholder="Filter results"
              style="width: 100%;
                    box-sizing: border-box;
                    padding: 10px 12px;
                    border-radius: 6px;
                    border: 1px solid var(--calcite-ui-border-1);
                    background: var(--calcite-ui-foreground-1);
                    color: var(--calcite-ui-text-1);"
              type="text"
              value={state.filterText}
            />
          </div>
          <div
            style="padding: 0 12px 12px;
                  max-height: calc(100vh - 140px);
                  overflow-y: auto;
                  overflow-x: hidden;"
          >
            {renderLayerVisibilityToggle()}
            {renderBlendModeOption(normalBlendMode)}
            {blendModeCategories.reduce(
              (nodes, category) => nodes.concat(renderBlendModeCategory(category)),
              [] as VNode[]
            )}
          </div>
        </calcite-panel>
      </div>
    );
  }

  function renderExplorerView(): VNode {
    return (
      <div
        style={`padding: 0;
              margin: 0;
              height: 100%;
              width: 100%;
              display: ${state.showExternalMap ? "none" : "block"};
              position: relative;`}
      >
        <div
          style="padding: 0; margin: 0; height: 100%; width: 100%;"
          afterCreate={createMapView}
        ></div>
        <div
          style="position: absolute;
                bottom: 24px;
                right: 12px;
                display: flex;
                flex-direction: column;
                align-items: flex-end"
        >
          <div
            style="background-color: var(--calcite-ui-foreground-1);
                  box-shadow: 0 1px 2px rgb(0 0 0 / 30%);
                  padding: 12px;
                  margin: 6px;"
          >
            {effectCodeBlock(state)}
          </div>
        </div>
      </div>
    );
  }

  function renderExternalMapView(): VNode {
    return (
      <div
        style={`width: 100%;
              height: 100%;
              padding: 12px;
              box-sizing: border-box;
              display: ${state.showExternalMap ? "block" : "none"};`}
      >
        <div
          style="width: 100%;
                height: 100%;
                background: var(--calcite-ui-foreground-1);
                border: 1px solid var(--calcite-ui-border-2);
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 1px 2px rgb(0 0 0 / 15%);"
        >
          <iframe
            allow="clipboard-read; clipboard-write"
            src={mapViewerUrl}
            style="width: 100%; height: 100%; border: 0;"
            title="Blend modes Playground"
          ></iframe>
        </div>
      </div>
    );
  }

  //Renders the application content
  function render() {
    return (
      <calcite-shell>
        <header slot="header">
          <div
            style="display: flex;
                  align-items: center;
                  justify-content: space-between;
                  width: 100%;"
          >
            <h2 style="margin-left: 30px">Blend modes Playground</h2>
            {renderHeaderActions()}
          </div>
        </header>
        <div
          key="app-layout"
          style="display: flex;
                width: 100%;
                height: 100%;"
        >
          {renderSidebar()}
          <div
            key="main-content"
            style="flex: 1;
                  width: 100%;
                  height: 100%;
                  min-width: 0;"
          >
            {renderExplorerView()}
            {renderExternalMapView()}
          </div>
        </div>
        <div
          aria-hidden={state.activeTooltipId ? "false" : "true"}
          style={`position: fixed;
                left: ${state.activeTooltipLeft}px;
                top: ${state.activeTooltipTop}px;
                transform: translateY(-50%);
                width: 280px;
                max-width: calc(100vw - 32px);
                padding: 8px 10px;
                border-radius: 6px;
                background: var(--calcite-ui-foreground-1);
                border: 1px solid var(--calcite-ui-border-2);
                box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
                color: var(--calcite-ui-text-1);
                font-size: 12px;
                line-height: 1.4;
                pointer-events: none;
                opacity: ${state.activeTooltipId ? "1" : "0"};
                visibility: ${state.activeTooltipId ? "visible" : "hidden"};
                z-index: 1000;`}
        >
          {state.activeTooltipText}
        </div>
      </calcite-shell>
    );
  }

  function effectCodeBlock(state: State) {
    const snippet = `layer.blendMode = '${state.blendMode}';`;
    return (
      <div style="display: flex; flex-direction: column">
        {renderCodeSnippet("javascript", snippet)}
        <calcite-button
          appearance="outline"
          icon-start="copyToClipboard"
          color="light"
          scale="s"
          onclick={() => { navigator.clipboard.writeText(snippet) }}
        >
          Copy to clipboard
        </calcite-button>
      </div>
    );
  }

  async function createMapView(container: HTMLDivElement) {
    const map = new WebMap({
      basemap: "topo-vector",
      portalItem: {
        id: "183a8679b8d34e7cb316dd6c7e5dea84"
      }
    });
    (window as any).view = view = new MapView({
      map, 
      container,
      zoom: 3,
      center: [0, 40],
      constraints: {
        snapToZoom: false,
      },
    });

    map.loadAll().then(() => {
      if (view) {
        layer = view.map.layers.getItemAt(0) as __esri.FeatureLayer;
        layer.blendMode = state.blendMode;
        layer.visible = state.layerVisible;
        layer.opacity = state.opacity;
      }
    });

    view.ui.add(new BasemapGallery({ view }), "top-right");
  }

  const projector = createProjector();
  projector.append(document.body, render);
}
