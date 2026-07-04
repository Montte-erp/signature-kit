import { Result, Schema } from "effect";

const LocalizedMessageMapSchema = Schema.Record(Schema.String, Schema.String);
export type LocalizedMessageMap = (typeof LocalizedMessageMapSchema)["Type"];

export const LocalizedCatalogSchema = Schema.Record(Schema.String, LocalizedMessageMapSchema);
export type LocalizedCatalog = (typeof LocalizedCatalogSchema)["Type"];

const ErrorMessageFallbackLocaleSchema = Schema.Literals(["en-US"]);

export const ErrorMessageOptionsSchema = Schema.Struct({
  locale: Schema.String,
  catalogs: Schema.Array(LocalizedCatalogSchema),
  fallbackLocale: Schema.optional(ErrorMessageFallbackLocaleSchema),
  overrides: Schema.optional(LocalizedCatalogSchema),
});
export type ErrorMessageOptions = (typeof ErrorMessageOptionsSchema)["Type"];

const TaggedErrorShapeSchema = Schema.Struct({
  _tag: Schema.String,
  code: Schema.String,
});

export const ErrorMessageFallbackCodeSchema = Schema.Literals(["i18n.GENERIC_ERROR"]);
export type ErrorMessageFallbackCode = (typeof ErrorMessageFallbackCodeSchema)["Type"];

export const ErrorMessageLocaleSchema = Schema.Literals(["en-US", "pt-BR"]);
export type ErrorMessageLocale = (typeof ErrorMessageLocaleSchema)["Type"];
type ErrorMessageFallbackMessages = Record<
  ErrorMessageLocale,
  Record<ErrorMessageFallbackCode, string>
>;

export const errorMessageFallbackMessages = {
  "en-US": {
    "i18n.GENERIC_ERROR": "Something went wrong.",
  },
  "pt-BR": {
    "i18n.GENERIC_ERROR": "Algo deu errado.",
  },
} satisfies ErrorMessageFallbackMessages;

const localizedErrorMessageFallbacks: LocalizedCatalog = errorMessageFallbackMessages;

const getMessageFromCatalog = (
  catalog: LocalizedCatalog,
  locale: string,
  code: string,
): string | undefined => {
  if (!Object.hasOwn(catalog, locale)) {
    return undefined;
  }

  const messages = catalog[locale];
  if (messages === undefined) {
    return undefined;
  }

  return Object.hasOwn(messages, code) ? messages[code] : undefined;
};

const genericErrorCode: ErrorMessageFallbackCode = "i18n.GENERIC_ERROR";

export const errorMessage = (error: unknown, options: ErrorMessageOptions): string => {
  const validOptions = Result.getOrThrow(
    Schema.decodeUnknownResult(ErrorMessageOptionsSchema)(options),
  );

  const fallbackLocale = validOptions.fallbackLocale ?? "en-US";
  const code = Schema.is(TaggedErrorShapeSchema)(error) ? error.code : undefined;
  const overrides = validOptions.overrides;

  if (code !== undefined) {
    const explicitOverride =
      overrides === undefined
        ? undefined
        : getMessageFromCatalog(overrides, validOptions.locale, code);
    if (explicitOverride !== undefined) {
      return explicitOverride;
    }

    for (const catalog of validOptions.catalogs) {
      const catalogMessage = getMessageFromCatalog(catalog, validOptions.locale, code);
      if (catalogMessage !== undefined) {
        return catalogMessage;
      }
    }

    const fallbackLocaleOverride =
      overrides === undefined ? undefined : getMessageFromCatalog(overrides, fallbackLocale, code);
    if (fallbackLocaleOverride !== undefined) {
      return fallbackLocaleOverride;
    }

    for (const catalog of validOptions.catalogs) {
      const fallbackCatalogMessage = getMessageFromCatalog(catalog, fallbackLocale, code);
      if (fallbackCatalogMessage !== undefined) {
        return fallbackCatalogMessage;
      }
    }
  }

  return (
    getMessageFromCatalog(localizedErrorMessageFallbacks, validOptions.locale, genericErrorCode) ??
    getMessageFromCatalog(localizedErrorMessageFallbacks, fallbackLocale, genericErrorCode) ??
    getMessageFromCatalog(localizedErrorMessageFallbacks, "en-US", genericErrorCode) ??
    "Something went wrong."
  );
};
