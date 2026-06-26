import { schemaErrorMetadata } from "@signature-kit/core/config";
import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { Effect, Schema } from "effect";
import * as React from "react";
import {
  ReactIntegrationError,
  ReactIntegrationErrorCodeValue,
  ReactIntegrationOperationValue,
  ReactIntegrationSchemaNameValue,
  ReactPdfRenderOptionsSchema,
  ReactSignatureTemplateSchema,
} from "./config";
import type { ReactPdfRenderOptions, ReactSignatureField, ReactSignatureTemplate } from "./config";
import {
  groupReactSignatureFieldsByPage,
  reactSignatureFieldsForPage,
  validateReactSignatureTemplate,
} from "./builder";

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    position: "relative",
  },
  field: {
    alignItems: "center",
    backgroundColor: "#f5f3ff",
    borderColor: "#7c3aed",
    borderRadius: 4,
    borderWidth: 1,
    display: "flex",
    justifyContent: "center",
    padding: 4,
    position: "absolute",
  },
  fieldText: {
    color: "#5b21b6",
    fontSize: 9,
    lineHeight: 1.2,
  },
  signatureImage: {
    objectFit: "contain",
    width: "100%",
    height: "100%",
  },
  pageLabel: {
    color: "#94a3b8",
    fontSize: 9,
    position: "absolute",
    right: 10,
    top: 10,
  },
});

export type ReactPdfSignatureTemplateDocumentProps = ReactPdfRenderOptions & {
  readonly template: ReactSignatureTemplate;
};

const fieldLabel = (template: ReactSignatureTemplate, field: ReactSignatureField): string => {
  const role = template.roles.find((candidate) => candidate.id === field.roleId);
  return field.value?.text ?? field.label ?? role?.label ?? field.type;
};

const ReactPdfSignatureField = ({
  template,
  field,
}: {
  readonly template: ReactSignatureTemplate;
  readonly field: ReactSignatureField;
}): React.ReactElement => (
  <View
    style={[
      styles.field,
      {
        left: field.rect.x,
        top: field.rect.y,
        width: field.rect.width,
        height: field.rect.height,
      },
    ]}
  >
    {field.value?.imageDataUrl === undefined ? (
      <Text style={styles.fieldText}>{fieldLabel(template, field)}</Text>
    ) : (
      <Image src={field.value.imageDataUrl} style={styles.signatureImage} />
    )}
  </View>
);

export const ReactPdfSignatureTemplateDocument = ({
  template,
  title,
  author,
  subject,
  keywords,
  language,
  creator,
  producer,
}: ReactPdfSignatureTemplateDocumentProps): React.ReactElement => {
  const fieldsByPage = groupReactSignatureFieldsByPage(template.fields);

  return (
    <Document
      title={title ?? template.name}
      {...(author === undefined ? {} : { author })}
      {...(subject === undefined ? {} : { subject })}
      {...(keywords === undefined ? {} : { keywords })}
      {...(language === undefined ? {} : { language })}
      {...(creator === undefined ? {} : { creator })}
      {...(producer === undefined ? {} : { producer })}
    >
      {template.documents.map((document) =>
        document.pages.map((page) => (
          <Page
            key={`${document.id}:${page.index}`}
            size={{ width: page.width, height: page.height }}
            style={styles.page}
            wrap={false}
          >
            <Text style={styles.pageLabel}>
              {page.label ?? `${document.name} · ${page.index + 1}`}
            </Text>
            {reactSignatureFieldsForPage(fieldsByPage, document.id, page.index).map((field) => (
              <ReactPdfSignatureField key={field.id} template={template} field={field} />
            ))}
          </Page>
        )),
      )}
    </Document>
  );
};

export const renderReactSignatureTemplatePdf = (
  template: ReactSignatureTemplate,
  options: ReactPdfRenderOptions = {},
): Effect.Effect<Uint8Array, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(ReactPdfRenderOptionsSchema)(options).pipe(
    Effect.mapError((error) => {
      const issue = schemaErrorMetadata(error);
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.renderPdf,
        schemaName: ReactIntegrationSchemaNameValue.reactPdfRenderOptions,
        reason: "React PDF render options do not match the schema.",
        ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
        ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
      });
    }),
    Effect.flatMap((validOptions) =>
      Schema.decodeUnknownEffect(ReactSignatureTemplateSchema)(template).pipe(
        Effect.mapError((error) => {
          const issue = schemaErrorMetadata(error);
          return new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: ReactIntegrationOperationValue.renderPdf,
            schemaName: ReactIntegrationSchemaNameValue.reactSignatureTemplate,
            reason: "React PDF template does not match the builder schema.",
            ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
            ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
          });
        }),
        Effect.flatMap(validateReactSignatureTemplate),
        Effect.flatMap((valid) =>
          Effect.tryPromise({
            try: async () => {
              const blob = await pdf(
                <ReactPdfSignatureTemplateDocument template={valid} {...validOptions} />,
              ).toBlob();
              return new Uint8Array(await blob.arrayBuffer());
            },
            catch: () =>
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.renderFailed,
                retryable: false,
                operation: ReactIntegrationOperationValue.renderPdf,
                reason: "React PDF renderer failed to produce a PDF blob.",
              }),
          }),
        ),
      ),
    ),
  );
