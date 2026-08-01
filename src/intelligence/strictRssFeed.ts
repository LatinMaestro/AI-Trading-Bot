import type { ExternalIntelligencePayloadCapture } from "./sourceAdapters.ts";

const MAXIMUM_XML_CHARACTERS = 1_048_576;
const MAXIMUM_TEXT_LENGTH = 20_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface StrictRssItem {
  readonly title: string;
  readonly link: string;
  readonly guid: string;
  readonly publicationText: string;
}

function decodeXmlText(value: string, name: string): string {
  let text = value;
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/u.exec(text);
  if (cdata !== null) text = cdata[1] ?? "";
  if (/<[^>]*>/u.test(text)) {
    throw new Error(`${name} must not contain nested markup`);
  }
  if (
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/u.test(text)
  ) {
    throw new Error(`${name} contains an unsupported XML entity`);
  }
  text = text.replace(
    /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/gu,
    (_entity, token: string) => {
      switch (token) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default: {
          const codePoint = token.startsWith("#x")
            ? Number.parseInt(token.slice(2), 16)
            : Number.parseInt(token.slice(1), 10);
          if (
            !Number.isSafeInteger(codePoint) ||
            codePoint <= 0 ||
            codePoint > 0x10ffff ||
            (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ) {
            throw new Error(`${name} contains an invalid XML character`);
          }
          return String.fromCodePoint(codePoint);
        }
      }
    },
  );
  if (
    text.trim() !== text ||
    text.length === 0 ||
    text.length > MAXIMUM_TEXT_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
  ) {
    throw new Error(`${name} must be bounded canonical XML text`);
  }
  return text;
}

function exactlyOneTag(block: string, tag: string, sourceName: string): string {
  const pattern = new RegExp(
    `<${tag}(?:\\s+[^<>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "gu",
  );
  const values = [...block.matchAll(pattern)];
  if (values.length !== 1) {
    throw new Error(`${sourceName} RSS item must contain exactly one ${tag}`);
  }
  return decodeXmlText(values[0]?.[1] ?? "", `${sourceName} RSS ${tag}`);
}

async function exactPayloadDigest(
  capture: ExternalIntelligencePayloadCapture,
): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(capture.payloadBytes),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function parseStrictRssPayload(
  capture: ExternalIntelligencePayloadCapture,
  sourceName: string,
  maximumItems: number,
): Promise<readonly StrictRssItem[]> {
  if (
    !Number.isSafeInteger(maximumItems) ||
    maximumItems < 1 ||
    maximumItems > 1_000
  ) {
    throw new Error("RSS maximumItems is outside bounds");
  }
  if (
    capture.payloadByteLength <= 0 ||
    capture.payloadByteLength > MAXIMUM_XML_CHARACTERS
  ) {
    throw new Error(`${sourceName} RSS byte length is outside bounds`);
  }
  if (capture.payloadByteLength !== capture.payloadBytes.byteLength) {
    throw new Error(`${sourceName} RSS byte length does not match its capture`);
  }
  if ((await exactPayloadDigest(capture)) !== capture.payloadSha256) {
    throw new Error(`${sourceName} RSS digest does not match its capture`);
  }
  let xml: string;
  try {
    xml = decoder.decode(capture.payloadBytes);
  } catch {
    throw new Error(`${sourceName} RSS must be valid UTF-8 XML`);
  }
  if (
    xml.length === 0 ||
    xml.length > MAXIMUM_XML_CHARACTERS ||
    /<!DOCTYPE|<!ENTITY/iu.test(xml)
  ) {
    throw new Error(`${sourceName} RSS contains forbidden or oversized XML`);
  }
  const rss = /^\s*(?:<\?xml\s+[^<>]*\?>\s*)?<rss(?:\s+[^<>]*)?>([\s\S]*)<\/rss>\s*$/u.exec(
    xml,
  );
  if (rss === null || /<\/?rss(?:\s|>)/u.test(rss[1] ?? "")) {
    throw new Error(`${sourceName} RSS must contain one canonical RSS root`);
  }
  const rssBody = rss[1] ?? "";
  const channels = [
    ...rssBody.matchAll(
      /<channel(?:\s+[^<>]*)?>([\s\S]*?)<\/channel>/gu,
    ),
  ];
  const channelOpenings = [
    ...rssBody.matchAll(/<channel(?:\s+[^<>]*)?>/gu),
  ].length;
  const channelClosings = [...rssBody.matchAll(/<\/channel>/gu)].length;
  if (
    channels.length !== 1 ||
    channelOpenings !== 1 ||
    channelClosings !== 1
  ) {
    throw new Error(`${sourceName} RSS must contain exactly one channel`);
  }
  const channel = channels[0]?.[1] ?? "";
  const itemBlocks = [
    ...channel.matchAll(/<item(?:\s+[^<>]*)?>([\s\S]*?)<\/item>/gu),
  ];
  const itemOpenings = [...channel.matchAll(/<item(?:\s+[^<>]*)?>/gu)].length;
  const itemClosings = [...channel.matchAll(/<\/item>/gu)].length;
  if (
    itemOpenings !== itemBlocks.length ||
    itemClosings !== itemBlocks.length
  ) {
    throw new Error(`${sourceName} RSS contains malformed item markup`);
  }
  if (itemBlocks.length > maximumItems) {
    throw new Error(`${sourceName} RSS exceeds ${maximumItems} items`);
  }
  return itemBlocks.map((match) => {
    const block = match[1] ?? "";
    return {
      title: exactlyOneTag(block, "title", sourceName),
      link: exactlyOneTag(block, "link", sourceName),
      guid: exactlyOneTag(block, "guid", sourceName),
      publicationText: exactlyOneTag(block, "pubDate", sourceName),
    };
  });
}
