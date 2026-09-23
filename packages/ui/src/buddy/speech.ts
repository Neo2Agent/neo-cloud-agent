export function modelShortLabel(model: string): string {
  const id = model.trim();
  if (/step-5|neo\/step|stepfun|^step5$|^step$/i.test(id)) return "Step 5";
  if (/^gpt-|^o[1-9]|^chatgpt/i.test(id)) return "GPT";
  if (!id || /deepseek|^ds$|neo\/ds/i.test(id)) return "Flash";
  return id.length > 16 ? id.slice(0, 16) : id;
}

export function holdPadLabel(input: {
  supported: boolean;
  holding: boolean;
  followUp?: boolean;
  finishing?: boolean;
  fileFallback?: boolean;
}): string {
  if (input.finishing) return "正在转文字…";
  if (input.holding) return "正在听…再点一下完成";
  if (!input.supported) return input.followUp ? "继续说一句…" : "说说你要做什么";
  if (input.fileFallback) return "选录音文件";
  return "点一下开始说话";
}
