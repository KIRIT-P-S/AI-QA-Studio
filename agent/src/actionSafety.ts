export const riskyAction =
  /delete|remove|destroy|purchase|pay\b|checkout|submit|approve|revoke|transfer|publish|send|invite|reset|logout|sign.?out|deactivate/i;
export function clickRequiresHuman(
  info: {
    label: string;
    type: string;
    formMethod: string;
    formAction: string;
    isSearch: boolean;
  },
  origin: string,
): boolean {
  let safeSearch = false;
  try {
    safeSearch =
      info.formMethod.toLowerCase() === "get" &&
      info.isSearch &&
      new URL(info.formAction, origin).origin === origin &&
      !riskyAction.test(new URL(info.formAction, origin).pathname);
  } catch {}
  const meaningfulLabel = safeSearch
    ? info.label.replace(/^\s*(?:submit|go|search)\s*$/i, "")
    : info.label;
  return (
    riskyAction.test(meaningfulLabel) ||
    (info.type.toLowerCase() === "submit" && !safeSearch)
  );
}
