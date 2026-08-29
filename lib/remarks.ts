import type { EmotionLabel } from "@/lib/engineProfiles";

export const COACH_AUTO_ENCOURAGEMENT: Record<string, string[]> = {
  confident: [
    "You're playing with real confidence — love to see it. Keep the pressure on.",
    "Great energy! You're in control. Stay sharp.",
    "Love the swagger. Just don't get careless.",
  ],
  focused: [
    "You're locked in. That's how you win games.",
    "Nice concentration — keep calculating deep.",
    "Focused and sharp. You've got this.",
  ],
  neutral: [
    "Solid and steady. Good things will come.",
    "You're playing fine — trust your instincts.",
    "No panic. Just keep making good moves.",
  ],
  calm: [
    "You look relaxed — that's your best state to play in.",
    "Calm and collected. That's the way.",
    "Staying cool under pressure. Well played.",
  ],
  frustrated: [
    "Hey, you're doing better than you think. Take a breath.",
    "Don't be hard on yourself. One good move changes everything.",
    "Frustration is normal. Reset and focus on the next move.",
    "You've got this. Don't let one setback shake you.",
  ],
  stressed: [
    "Take a deep breath. You've handled tougher positions.",
    "You're feeling the pressure, but you're still in this.",
    "Slow down. You don't need to rush — think clearly.",
    "Trust yourself. You know more than you think.",
  ],
};

export const BOT_REMARKS: Record<string, string[]> = {
  confident: [
    "Confidence looks good on you. Shame it won't save your king.",
    "You're feeling bold. I love breaking that.",
    "That swagger won't help when I'm done with you.",
    "Love the energy. Let me crush it.",
  ],
  focused: [
    "Sharp focus. I'll still outplay you.",
    "Calculating hard? So am I. I'm just better at it.",
    "You're locked in. Good. I prefer a challenge.",
    "Focused? Good. You'll need it to keep up.",
  ],
  neutral: [
    "Playing it cool? Let's see how long that lasts.",
    "I'm just getting started.",
    "Quiet now. Let's change that.",
    "Neutral energy. I'll take that as a challenge.",
  ],
  calm: [
    "Too relaxed. Let me fix that.",
    "Calm before the storm. Here it comes.",
    "You should be nervous.",
    "Serene. Unbothered. About to be embarrassed.",
  ],
  frustrated: [
    "I can feel the frustration. Makes you sloppy.",
    "Don't tilt. Actually, do. I love it.",
    "Rage makes you predictable.",
    "Take a breath. You're playing right into my hands.",
  ],
  stressed: [
    "You look stressed. Good.",
    "Pressure cooker. Let's see if you crack.",
    "Your play is getting shaky.",
    "I can smell the panic. Beautiful.",
  ],
};

export const CHECK_REMARKS = [
  "Check. Squirm a little.",
  "Check. What are you gonna do about it?",
  "King in danger. Again. Stay focused.",
  "Check. Hope you saw that coming.",
];

export const CAPTURE_REMARKS = [
  "Piece down. You okay?",
  "Thanks for the material.",
  "That piece is mine now. Deal with it.",
  "Oops. Did you need that?",
];

export function generateRemark(
  em: EmotionLabel,
  isCheck: boolean,
  isCapture: boolean,
): string {
  const pool = BOT_REMARKS[em] ?? BOT_REMARKS.neutral;
  let remark = pool[Math.floor(Math.random() * pool.length)];
  if (isCheck) {
    remark = CHECK_REMARKS[Math.floor(Math.random() * CHECK_REMARKS.length)];
  } else if (isCapture) {
    remark =
      CAPTURE_REMARKS[Math.floor(Math.random() * CAPTURE_REMARKS.length)];
  }
  return remark;
}
