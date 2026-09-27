// Theme keys match BootAnimRXDK BootAnimConfigData / bootanim.ini.
const DEFAULT_THEME = {
  cameraMode: 1,
  plasmaRender: true,
  plasma1: 0x00ff00,
  plasma2: 0x9fff66,
  plasma3: 0xa0ff60,
  shieldRender: true,
  shieldWireframe: false,
  shield: 0x66ff4d,
  blobRender: true,
  blobWireframe: false,
  blobColor: 0x40ff26,
  blobGlow: 0xa0ff40,
  sceneRender: true,
  sceneWireframe: false,
  sceneIntensity: 2,
  sceneAmbient: 0x35ff1a,
  sceneDiffuse: 0x35ff1a,
  sceneSpecular: 0x35ff1a,
  slashBackgroundStart: 0x000000,
  slashBackgroundEnd: 0xffffff,
  slashLipGradientStart: 0x000100,
  slashLipGradientEnd: 0x4b9b4b,
  slashInnerStage1Gradient1: 0xd0ff97,
  slashInnerStage1Gradient2: 0xd0ff97,
  slashInnerStage1Gradient3: 0xd0ff87,
  slashInnerStage1Gradient4: 0xd0ff87,
  slashInnerStage2Gradient1: 0xd0ff87,
  slashInnerStage2Gradient2: 0xd0ff87,
  slashInnerStage2Gradient3: 0xcbdf01,
  slashInnerStage2Gradient4: 0x216a17,
  tradeMarkRender: true,
  tradeMark: 0x6fbb1b,
  xboxRender: true,
  xbox: 0x62ca13,
  brandRender: true,
  brand: 0xffffff,
};

const THEME_FIELDS = [
  { group: "Camera", key: "cameraMode", ini: "cameraMode", kind: "int", min: 0, max: 15 },
  { group: "Plasma", key: "plasmaRender", ini: "PlasmaRender", kind: "bool" },
  { group: "Plasma", key: "plasma1", ini: "Plasma1", kind: "color" },
  { group: "Plasma", key: "plasma2", ini: "Plasma2", kind: "color" },
  { group: "Plasma", key: "plasma3", ini: "Plasma3", kind: "color" },
  { group: "Shield", key: "shieldRender", ini: "ShieldRender", kind: "bool" },
  { group: "Shield", key: "shieldWireframe", ini: "ShieldWireframe", kind: "bool" },
  { group: "Shield", key: "shield", ini: "Shield", kind: "color" },
  { group: "Blob", key: "blobRender", ini: "BlobRender", kind: "bool" },
  { group: "Blob", key: "blobWireframe", ini: "BlobWireframe", kind: "bool" },
  { group: "Blob", key: "blobColor", ini: "BlobColor", kind: "color" },
  { group: "Blob", key: "blobGlow", ini: "BlobGlow", kind: "color" },
  { group: "Scene", key: "sceneRender", ini: "SceneRender", kind: "bool" },
  { group: "Scene", key: "sceneWireframe", ini: "SceneWireframe", kind: "bool" },
  { group: "Scene", key: "sceneIntensity", ini: "SceneIntensity", kind: "int", min: 0, max: 8 },
  { group: "Scene", key: "sceneAmbient", ini: "SceneAmbient", kind: "color" },
  { group: "Scene", key: "sceneDiffuse", ini: "SceneDiffuse", kind: "color" },
  { group: "Scene", key: "sceneSpecular", ini: "SceneSpecular", kind: "color" },
  { group: "Slash", key: "slashBackgroundStart", ini: "SlashBackgroundStart", kind: "color" },
  { group: "Slash", key: "slashBackgroundEnd", ini: "SlashBackgroundEnd", kind: "color" },
  { group: "Slash", key: "slashLipGradientStart", ini: "SlashLipGradientStart", kind: "color" },
  { group: "Slash", key: "slashLipGradientEnd", ini: "SlashLipGradientEnd", kind: "color" },
  { group: "Slash", key: "slashInnerStage1Gradient1", ini: "SlashInnerStage1Gradient1", kind: "color" },
  { group: "Slash", key: "slashInnerStage1Gradient2", ini: "SlashInnerStage1Gradient2", kind: "color" },
  { group: "Slash", key: "slashInnerStage1Gradient3", ini: "SlashInnerStage1Gradient3", kind: "color" },
  { group: "Slash", key: "slashInnerStage1Gradient4", ini: "SlashInnerStage1Gradient4", kind: "color" },
  { group: "Slash", key: "slashInnerStage2Gradient1", ini: "SlashInnerStage2Gradient1", kind: "color" },
  { group: "Slash", key: "slashInnerStage2Gradient2", ini: "SlashInnerStage2Gradient2", kind: "color" },
  { group: "Slash", key: "slashInnerStage2Gradient3", ini: "SlashInnerStage2Gradient3", kind: "color" },
  { group: "Slash", key: "slashInnerStage2Gradient4", ini: "SlashInnerStage2Gradient4", kind: "color" },
  { group: "Marks", key: "tradeMarkRender", ini: "TradeMarkRender", kind: "bool" },
  { group: "Marks", key: "tradeMark", ini: "TradeMark", kind: "color" },
  { group: "Marks", key: "xboxRender", ini: "XboxRender", kind: "bool" },
  { group: "Marks", key: "xbox", ini: "Xbox", kind: "color" },
  { group: "Marks", key: "brandRender", ini: "BrandRender", kind: "bool" },
  { group: "Marks", key: "brand", ini: "Brand", kind: "color" },
];

function cloneTheme(src) {
  return Object.assign({}, src);
}

function rgbOf(value) {
  const n = value >>> 0;
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function cssHex(value) {
  const c = rgbOf(value);
  const h = (n) => n.toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}

function cssRgba(value, a) {
  const c = rgbOf(value);
  return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
}

function mixHex(a, b, t) {
  const ca = rgbOf(a);
  const cb = rgbOf(b);
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(ca.r + (cb.r - ca.r) * u);
  const g = Math.round(ca.g + (cb.g - ca.g) * u);
  const bl = Math.round(ca.b + (cb.b - ca.b) * u);
  return (r << 16) | (g << 8) | bl;
}

function scaleColor(value, scale) {
  const c = rgbOf(value);
  const s = Math.max(0, scale);
  const ch = (n) => Math.max(0, Math.min(255, Math.round(n * s)));
  return (ch(c.r) << 16) | (ch(c.g) << 8) | ch(c.b);
}

function parseIni(text) {
  const theme = cloneTheme(DEFAULT_THEME);
  const byIni = {};
  for (const field of THEME_FIELDS) byIni[field.ini.toUpperCase()] = field;

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const cut = raw.split(";")[0];
    const eq = cut.indexOf("=");
    if (eq < 0) continue;
    const name = cut.slice(0, eq).trim().toUpperCase();
    const value = cut.slice(eq + 1).trim();
    const field = byIni[name];
    if (!field) continue;
    if (field.kind === "bool") {
      const upper = value.toUpperCase();
      if (upper === "TRUE") theme[field.key] = true;
      else if (upper === "FALSE") theme[field.key] = false;
    } else if (field.kind === "color" || field.kind === "int") {
      let n;
      const upper = value.toUpperCase();
      if (upper.startsWith("0X")) n = parseInt(upper.slice(2), 16);
      else if (upper.startsWith("#")) n = parseInt(upper.slice(1), 16);
      else n = parseInt(upper, 10);
      if (!Number.isNaN(n)) {
        if (field.kind === "int") {
          n = Math.max(field.min, Math.min(field.max, n));
        }
        theme[field.key] = n >>> 0;
      }
    }
  }
  return theme;
}

function themeToIni(theme) {
  const lines = ["; BootAnim theme"];
  let group = "";
  for (const field of THEME_FIELDS) {
    if (field.group !== group) {
      lines.push("", "; " + field.group);
      group = field.group;
    }
    let value;
    if (field.kind === "bool") value = theme[field.key] ? "true" : "false";
    else if (field.kind === "color") value = "0x" + (theme[field.key] & 0xffffff).toString(16).padStart(6, "0");
    else value = String(theme[field.key]);
    lines.push(field.ini + " = " + value);
  }
  lines.push("");
  return lines.join("\r\n");
}
