import * as React from "react";
import { Text } from "@react-pdf/renderer";

export type PdfSignatureAnchorProps = {
  readonly token?: string;
  readonly children?: React.ReactNode;
  readonly fontSize?: number;
  readonly color?: string;
};

const invisibleAnchorStyle = (fontSize: number, color: string) => ({
  fontSize,
  opacity: 0,
  color,
});

export function PdfSignatureAnchor({
  token = "{{signature}}",
  children,
  fontSize = 6,
  color = "#ffffff",
}: PdfSignatureAnchorProps) {
  return <Text style={invisibleAnchorStyle(fontSize, color)}>{children ?? token}</Text>;
}
