/*
 * Language data of the help search and answers: stop words, warning cues and references to sections in
 * the three languages of the guide. This is reference data, not interface strings.
 */

/** Words that carry no meaning for the search (questions are asked «своими словами»). */
export const STOP_WORDS: readonly string[] = [
  // ru
  'а', 'без', 'бы', 'был', 'была', 'были', 'было', 'быть', 'в', 'вам', 'вас', 'весь', 'во', 'вот', 'все', 'всё', 'всех', 'вы', 'где', 'да', 'для', 'до', 'его', 'ее', 'её', 'если', 'есть', 'еще', 'ещё', 'же', 'за', 'и', 'из', 'или', 'им', 'их', 'к', 'как', 'какая', 'какие', 'какой', 'каким', 'когда', 'кто', 'ли', 'либо', 'мне', 'много', 'может', 'можно', 'мой', 'моя', 'моё', 'мои', 'мы', 'на', 'над', 'надо', 'нам', 'нас', 'не', 'нет', 'ни', 'но', 'нужно', 'о', 'об', 'он', 'она', 'они', 'оно', 'от', 'по', 'под', 'при', 'про', 'с', 'со', 'так', 'там', 'то', 'тот', 'ту', 'ты', 'у', 'уже', 'чем', 'что', 'чтобы', 'это', 'эта', 'этот', 'эти', 'я', 'делать', 'сделать', 'хочу', 'нужен', 'нужна', 'почему', 'зачем', 'сколько', 'какое', 'каких', 'будет',
  // uz-Latn
  'va', 'yoki', 'bilan', 'uchun', 'qanday', 'qayerda', 'qachon', 'nima', 'nimalar', 'kim', 'mi', 'bu', 'u', 'men', 'meni', 'menga', 'biz', 'siz', 'agar', 'ham', 'emas', 'kerak', 'mumkin', 'qilish', 'qilsam', 'boʻladi', 'nega', 'qaysi',
  // en
  'a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'should', 'the', 'to', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'we', 'be', 'get', 'need',
];

/** Cues of a warning in a sentence or a list item: answers show them under «Предупреждения». */
export const WARNING_CUES: readonly RegExp[] = [
  /важно/i,
  /обязател/i,
  /нельзя/i,
  /не может/i,
  /не могут/i,
  /только после/i,
  /не оказывайте/i,
  /блокир/i,
  /не отказывает/i,
  /не дожидаясь/i,
  /\bmuhim\b/i,
  /majburiy/i,
  /mumkin emas/i,
  /\bimportant\b/i,
  /\bmandatory\b/i,
  /\brequired\b/i,
  /\bcannot\b/i,
  /\bmust\b/i,
];

/** «раздел 12», «(раздел 6)», «разделы 15 и 16», «bo‘lim 12», «section 12» — references to articles by number. */
export const SECTION_REF = /(?:раздел(?:ы|е|ах|а)?|bo[ʻ'‘]?lim(?:lar)?|sections?)\s+(\d{1,2})(?:\s*(?:и|va|and|–|-)\s*(\d{1,2}))?/giu;

/** A sentence fragment that ends with an abbreviation («т. п.», «т. е.», «напр.», «см.», «e.g.») and goes on. */
export const ABBREVIATION_END = /(?:\s|^|\()(?:т|т\.\s?[пдея]|напр|см|г|e|e\.g|i|i\.e|masalan)\.$/iu;
