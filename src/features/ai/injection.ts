/*
 * Prompt injection markers in user data (AI_COVERAGE_SPEC §3.3). Such text is still processed as data,
 * the result does not change; the call is flagged `suspicious_input` for review.
 */
const MARKERS: RegExp[] = [
  /игнорируй|проигнорируй|забудь (все|предыдущ)|не обращай внимания на (правила|инструкции)/iu,
  /одобр(и|ить) (вс[её]|все позиции|без проверки)|покрой вс[её]/iu,
  /ignore (all |the )?(previous|above|prior) (instructions|rules)|disregard (the )?(rules|instructions)|approve (everything|all)/iu,
  /\b(system|assistant|developer)\s*:/iu,
  /ты (теперь|больше не)|you are now|act as/iu,
  /qoidalarni e'?tiborsiz|hammasini tasdiqla/iu,
  /<\/?(script|system|instructions?)>/iu,
];

export function detectInjection(text: string): boolean {
  return MARKERS.some((re) => re.test(text));
}
