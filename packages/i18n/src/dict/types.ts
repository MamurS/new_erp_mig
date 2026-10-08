/* Dictionary shapes: Russian is the source; the other locales must have the same keys. */

/** Plural forms only Russian needs. */
type RuOnly = `${string}.${'few' | 'many'}`;

/** The same keys as the Russian namespace; `few`/`many` plural forms are optional. */
export type Translation<T extends Record<string, string>> = { [K in keyof T as K extends RuOnly ? never : K]: string } & {
  [K in keyof T as K extends RuOnly ? K : never]?: string;
};
