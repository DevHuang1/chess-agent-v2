import { defaultPieces, type PieceRenderObject } from "react-chessboard";

function sharedDefs() {
  return (
    <defs>
      <linearGradient id="wg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fff" />
        <stop offset="100%" stopColor="#d4d4d4" />
      </linearGradient>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#555" />
        <stop offset="100%" stopColor="#111" />
      </linearGradient>
      <linearGradient id="wg2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f5f0e8" />
        <stop offset="100%" stopColor="#e8dcc8" />
      </linearGradient>
      <linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#333" />
        <stop offset="100%" stopColor="#0a0a0a" />
      </linearGradient>
      <filter id="shadow">
        <feDropShadow dx="0.5" dy="0.8" stdDeviation="0.8" floodOpacity="0.3" />
      </filter>
      <filter id="glow">
        <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#fbbf24" floodOpacity="0.15" />
      </filter>
    </defs>
  );
}

type PieceRenderer = (props?: {
  square?: string;
  svgStyle?: React.CSSProperties;
}) => React.JSX.Element;

function svgPiece(
  children: React.ReactNode,
): PieceRenderer {
  const Piece = (props?: { square?: string; svgStyle?: React.CSSProperties }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 45 45"
      width="100%"
      height="100%"
      style={props?.svgStyle}
    >
      {sharedDefs()}
      {children}
    </svg>
  );
  Piece.displayName = "SvgPiece";
  return Piece;
}

function classicPath(
  path: string,
  color: "w" | "b",
): PieceRenderer {
  const fill = color === "w" ? "url(#wg)" : "url(#bg)";
  const stroke = color === "w" ? "#999" : "#666";
  return svgPiece(
    <g filter="url(#shadow)">
      <path d={path} fill={fill} stroke={stroke} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </g>,
  );
}

function minimalPath(
  path: string,
  color: "w" | "b",
): PieceRenderer {
  const fill = color === "w" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const stroke = color === "w" ? "#1a1a1a" : "#e0e0e0";
  const strokeW = color === "w" ? 1.6 : 1.6;
  return svgPiece(
    <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />,
  );
}

function standardPath(
  path: string,
  color: "w" | "b",
): PieceRenderer {
  const fill = color === "w" ? "#ffffff" : "#1a1a1a";
  const stroke = color === "w" ? "#444" : "#888";
  return svgPiece(
    <path d={path} fill={fill} stroke={stroke} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />,
  );
}

function neoPath(
  path: string,
  color: "w" | "b",
): PieceRenderer {
  const fill = color === "w" ? "url(#wg2)" : "url(#bg2)";
  const accent = color === "w" ? "#c7924a" : "#fbbf24";
  return svgPiece(
    <g filter="url(#glow)">
      <path d={path} fill={fill} stroke={accent} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </g>,
  );
}

const paths: Record<string, string> = {
  P: "m 22.5,9 c -2.21,0 -4,1.79 -4,4 0,0.89 0.29,1.71 0.78,2.38 C 17.33,16.5 16,18.59 16,21 c 0,2.03 0.94,3.84 2.41,5.03 C 15.41,27.09 11,31.58 11,39.5 H 34 C 34,31.58 29.59,27.09 26.59,26.03 28.06,24.84 29,23.03 29,21 29,18.59 27.67,16.5 25.72,15.38 26.21,14.71 26.5,13.89 26.5,13 c 0,-2.21 -1.79,-4 -4,-4 z",
  N: "m 22,10 c 0,0 0.21,0.3 0.5,0.65 C 22.26,10.1 21.5,9.4 21.5,9.4 L 22,10 Z M 20.5,11.5 C 20,12.87 19.08,14.35 17.79,16.07 16.5,17.79 15.5,18.94 15.5,20.5 c 0,1.02 0.27,2.04 0.82,2.94 C 14.91,22.54 13.56,22 12.47,22 10.7,22 9.5,23.3 9.5,25 c 0,0.16 0,0.32 0.03,0.47 C 9.02,25.49 8.5,26.3 8.5,27.5 8.5,29.43 10.07,31 12,31 H 13 V 33.5 C 13,33.5 13,35.5 13,36.5 13,38.43 14.57,40 16.5,40 H 29.5 C 31.43,40 33,38.43 33,36.5 V 33 c 0,0 0,-10 -1,-13.5 C 31.5,18 29.5,15 26.5,13.5 24.83,12.6 23.07,11.42 22,10 Z M 19.5,13.5 C 19.5,14.33 18.83,15 18,15 17.17,15 16.5,14.33 16.5,13.5 16.5,12.67 17.17,12 18,12 18.83,12 19.5,12.67 19.5,13.5 Z",
  B: "m 22.5,11.63 C 22.5,11.63 21.71,9.88 22.5,8 c 0,0 0.79,1.88 0,3.63 z m 0,0 C 23.04,12.29 26,15.13 26,18 c 0,1.61 -0.72,3.07 -1.88,4.06 C 25.35,23.68 27,26.87 27,30 c 0,2.08 -0.69,3.99 -1.87,5.5 h 4.46 c 0,0 2.41,-2.29 2.41,-8.5 0,-3.54 -1.41,-5.63 -1.41,-5.63 0,0 0.47,0.22 1.13,0 0.37,-0.13 0.28,-0.65 0.28,-0.65 0,0 -0.66,-0.97 -1.09,-1.47 -1.03,-1.21 -2.23,-1.82 -2.23,-1.82 0,0 1.44,-0.66 2.22,-1.63 0.88,-1.1 1.13,-1.72 1.13,-1.72 0,0 0.44,0.09 0.66,0.06 0.38,-0.06 0.38,-0.47 0.38,-0.47 0,0 -0.47,-0.56 -0.75,-0.78 -0.66,-0.47 -1.59,-0.66 -1.59,-0.66 0,0 -0.13,-1.53 -0.63,-2.5 C 28.25,9 26.5,8.5 26.5,8.5 26.5,8.5 25.38,9.33 24.63,10.16 23.5,11.36 22.5,11.63 22.5,11.63 Z",
  R: "M 9,39.5 V 36.5 H 14 V 31 H 16 V 36.5 H 29 V 31 H 31 V 36.5 H 36 V 39.5 Z M 12,9 V 13 H 15 V 9 H 19 V 13 H 22 V 9 H 26 V 13 H 30 V 9 H 33 V 19.5 L 30,23 V 28 H 15 V 23 L 12,19.5 Z",
  Q: "M 24,10 c 0,0.55 -0.45,1 -1,1 -0.55,0 -1,-0.45 -1,-1 0,-0.55 0.45,-1 1,-1 0.55,0 1,0.45 1,1 z m 7.5,0.5 c -0.28,0.48 -0.89,0.64 -1.37,0.36 -0.48,-0.28 -0.64,-0.89 -0.36,-1.37 0.28,-0.48 0.89,-0.64 1.37,-0.36 0.48,0.28 0.64,0.89 0.36,1.37 z m -15,0 c -0.28,0.48 -0.89,0.64 -1.37,0.36 -0.48,-0.28 -0.64,-0.89 -0.36,-1.37 0.28,-0.48 0.89,-0.64 1.37,-0.36 0.48,0.28 0.64,0.89 0.36,1.37 z M 12,28.5 c 0,1.93 1.57,3.5 3.5,3.5 0.86,0 1.64,-0.32 2.24,-0.83 1.19,1.14 2.79,1.83 4.56,1.83 1.77,0 3.37,-0.69 4.56,-1.83 0.6,0.51 1.38,0.83 2.24,0.83 1.93,0 3.5,-1.57 3.5,-3.5 0,-0.43 -0.08,-0.84 -0.22,-1.23 L 35.5,16 32,18.5 27.5,11.5 22.5,22 17.5,12 15,18.5 11.5,16 12.72,27.27 C 12.26,27.62 12,28.09 12,28.5 Z",
  K: "M 22.5,11.63 V 8 M 20,8 h 5 M 22.5,11.63 C 22.5,11.63 24.66,13.4 26,15.5 27.34,17.6 28,18.5 28,18.5 c 0,0 0.76,-0.28 1.5,-0.5 0.74,-0.22 1.04,-0.28 1.04,-0.28 0,0 0.5,1.38 0.5,2.28 0,0.5 -0.22,0.97 -0.5,1.28 l 1.22,1.22 c 0,0 0.36,-0.65 0.88,-0.98 0.2,-0.13 0.39,-0.04 0.39,-0.04 0,0 0.1,0.43 0.16,0.69 0.06,0.26 0.22,0.85 0.22,0.85 0,0 0.38,-0.19 0.71,-0.19 0.42,0 0.71,0.19 0.71,0.19 l -0.06,0.63 c 0,0 1.38,1.44 1.84,2.69 0.46,1.25 0.46,2.78 0.46,2.78 0,0 -0.28,0.36 -0.78,0.66 -0.07,0.05 -0.83,-0.19 -0.83,-0.19 0,0 0.25,0.6 0.25,1.06 0,1.77 -1.29,2.81 -1.29,2.81 0,0 -4.35,2.5 -9.46,2.5 -5.11,0 -9.46,-2.5 -9.46,-2.5 0,0 -1.29,-1.04 -1.29,-2.81 0,-0.46 0.25,-1.06 0.25,-1.06 0,0 -0.76,0.24 -0.83,0.19 -0.5,-0.3 -0.78,-0.66 -0.78,-0.66 0,0 0,-1.53 0.46,-2.78 0.46,-1.25 1.84,-2.69 1.84,-2.69 l -0.06,-0.63 c 0,0 0.29,-0.19 0.71,-0.19 0.33,0 0.71,0.19 0.71,0.19 0,0 0.16,-0.59 0.22,-0.85 0.06,-0.26 0.16,-0.69 0.16,-0.69 0,0 0.19,-0.09 0.39,0.04 0.52,0.33 0.88,0.98 0.88,0.98 l 1.22,-1.22 c -0.28,-0.31 -0.5,-0.78 -0.5,-1.28 0,-0.9 0.5,-2.28 0.5,-2.28 0,0 0.3,0.06 1.04,0.28 0.74,0.22 1.5,0.5 1.5,0.5 0,0 0.66,-0.9 2,-3 1.34,-2.1 3.5,-3.87 3.5,-3.87 z",
};

function makePreset(
  renderer: (path: string, color: "w" | "b") => PieceRenderer,
): PieceRenderObject {
  const r: PieceRenderObject = {};
  for (const type of ["P", "N", "B", "R", "Q", "K"] as const) {
    const p = paths[type];
    r[`w${type}`] = renderer(p, "w");
    r[`b${type}`] = renderer(p, "b");
  }
  return r;
}

export const PIECE_DESIGNS: Record<string, { label: string; pieces: PieceRenderObject }> = {
  chesscom: {
    label: "Chess.com",
    pieces: defaultPieces,
  },
  classic: {
    label: "Classic",
    pieces: makePreset(classicPath),
  },
  standard: {
    label: "Standard",
    pieces: makePreset(standardPath),
  },
  minimal: {
    label: "Minimal",
    pieces: makePreset(minimalPath),
  },
  neo: {
    label: "Neo",
    pieces: makePreset(neoPath),
  },
};

export type PieceDesignKey = keyof typeof PIECE_DESIGNS;
