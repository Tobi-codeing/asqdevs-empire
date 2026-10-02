export type SpeechActivityState = {
  active: boolean;
  lastSpeechAt: number;
};

export function detectSpeechActivity({
  level,
  now,
  active,
  lastSpeechAt,
  threshold = 0.08,
  silenceMs = 500,
}: {
  level: number;
  now: number;
  active: boolean;
  lastSpeechAt: number;
  threshold?: number;
  silenceMs?: number;
}): SpeechActivityState {
  if (level >= threshold) {
    return { active: true, lastSpeechAt: now };
  }

  if (active && now - lastSpeechAt >= silenceMs) {
    return { active: false, lastSpeechAt };
  }

  return { active, lastSpeechAt };
}
