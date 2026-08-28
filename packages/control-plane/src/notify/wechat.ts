import { createHash } from "node:crypto";

export type WeChatMessage = {
  toUser: string;
  fromUser: string;
  msgType: string;
  content: string;
  picUrl?: string;
  mediaId?: string;
};

export function verifyWeChatSignature(input: {
  token: string;
  timestamp: string;
  nonce: string;
  signature: string;
}): boolean {
  if (!input.token || !input.signature) return false;
  const hashed = createHash("sha1")
    .update([input.token, input.timestamp, input.nonce].sort().join(""))
    .digest("hex");
  return hashed === input.signature.toLowerCase();
}

export function parseWeChatXml(xml: string): WeChatMessage {
  return {
    toUser: xmlTag(xml, "ToUserName"),
    fromUser: xmlTag(xml, "FromUserName"),
    msgType: xmlTag(xml, "MsgType") || "text",
    content: xmlTag(xml, "Content"),
    picUrl: xmlTag(xml, "PicUrl") || undefined,
    mediaId: xmlTag(xml, "MediaId") || undefined,
  };
}

export function weChatTextReply(toUser: string, fromUser: string, content: string): string {
  const now = Math.floor(Date.now() / 1000);
  return (
    `<xml>` +
    `<ToUserName><![CDATA[${toUser}]]></ToUserName>` +
    `<FromUserName><![CDATA[${fromUser}]]></FromUserName>` +
    `<CreateTime>${now}</CreateTime>` +
    `<MsgType><![CDATA[text]]></MsgType>` +
    `<Content><![CDATA[${content}]]></Content>` +
    `</xml>`
  );
}

function xmlTag(xml: string, name: string): string {
  const cdata = new RegExp(`<${name}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${name}>`, "i").exec(xml);
  if (cdata?.[1]) return cdata[1].trim();
  const plain = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return (plain?.[1] ?? "").trim();
}
