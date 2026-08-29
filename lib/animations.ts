import { animate } from "animejs";

const ease = "cubicBezier(0.22, 1, 0.36, 1)";
const easeBack = "cubicBezier(0.34, 1.56, 0.64, 1)";
const easeShake = "cubicBezier(0.36, 0.07, 0.19, 0.97)";

/**
 * Controller panel content slide-in from right.
 */
export function controllerContentIn(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1],
    filter: ["blur(5px)", "blur(0px)"],
    translateX: [22, 0],
    scale: [0.985, 1],
    duration: 420,
    ease,
  });
}

/**
 * Controller scan line — moves from top to bottom and fades.
 */
export function controllerScan(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1, 1, 0],
    translateY: ["-18%", "118%"],
    duration: 900,
    ease,
    keyframes: [
      { opacity: 0, translateY: "-18%" },
      { opacity: 1, offset: 0.28 },
      { opacity: 1, offset: 0.72 },
      { opacity: 0, translateY: "118%" },
    ],
  });
}

/**
 * Controller toggle button entrance — rotate + scale.
 */
export function controllerToggleIn(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1],
    rotate: [-12, 0],
    scale: [0.78, 1],
    duration: 420,
    ease,
  });
}

/**
 * Controller rail slide-in from right.
 */
export function controllerRailIn(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1],
    translateX: [12, 0],
    duration: 420,
    ease,
  });
}

/**
 * Controller label entrance — translateY + letter-spacing.
 */
export function controllerLabelIn(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1],
    letterSpacing: ["0.05em", "0.2em"],
    translateY: [8, 0],
    duration: 520,
    delay: 80,
    ease,
  });
}

/**
 * Controller status indicator pulse — infinite scale + opacity.
 */
export function controllerStatusPulse(el: HTMLElement) {
  return animate(el, {
    opacity: [0.55, 1, 0.55],
    scale: [0.9, 1.18, 0.9],
    duration: 2400,
    ease: "easeInOut",
    loop: true,
  });
}

/**
 * Controller wide-mode entrance — translateX + scale.
 */
export function controllerWideIn(el: HTMLElement) {
  return animate(el, {
    opacity: [0.72, 1],
    translateX: [16, 0],
    scale: [0.985, 1],
    duration: 460,
    ease,
  });
}

/**
 * Controller floating panel entrance — translateY + scale.
 */
export function controllerFloatIn(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1],
    translateY: [14, 0],
    scale: [0.98, 1],
    duration: 360,
    ease,
  });
}

/**
 * Training shake — horizontal jitter for wrong answers.
 */
export function trainShake(el: HTMLElement) {
  return animate(el, {
    translateX: [
      { value: -1.5, duration: 42 },
      { value: 3, duration: 84 },
      { value: -5, duration: 126 },
      { value: 5, duration: 168 },
      { value: -5, duration: 210 },
      { value: 5, duration: 252 },
      { value: -1.5, duration: 336 },
    ],
    duration: 420,
    ease: easeShake,
  });
}

/**
 * Training solve pulse — green box-shadow ring expand.
 */
export function trainSolvePulse(el: HTMLElement) {
  return animate(el, {
    boxShadow: [
      "0 0 0 0 rgba(52, 211, 153, 0.55)",
      "0 0 0 14px rgba(52, 211, 153, 0)",
      "0 0 0 0 rgba(52, 211, 153, 0)",
    ],
    duration: 620,
    ease: "easeOut",
  });
}

/**
 * Training XP pop — float upward and fade out.
 */
export function trainXpPop(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1, 0],
    translateY: [6, -4, -26],
    scale: [0.85, 1.08, 0.95],
    duration: 1100,
    ease,
  });
}

/**
 * Training level-up entrance — scale bounce + rotate.
 */
export function trainLevelUpIn(el: HTMLElement) {
  return animate(el, {
    opacity: [0, 1, 1],
    scale: [0.7, 1.06, 1],
    rotate: [-4, 1.5, 0],
    duration: 720,
    ease: easeBack,
  });
}
