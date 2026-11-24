export type ImportNotice = { kind: 'ok' | 'error'; title: string; lines: string[]; fallback?: boolean };

/** The API reports a refused page fetch as "The site returned 403 Forbidden." */
const SITE_STATUS = /The site returned (\d{3})/i;

/** Plain-language explanation of a failed website import. Doesn't claim the link was mistyped unless the server says so. */
export function urlImportError(message: string): ImportNotice {
  const status = SITE_STATUS.exec(message)?.[1];
  if (status === '401' || status === '403' || status === '429') {
    return {
      kind: 'error',
      title: 'This website blocked automated recipe imports',
      lines: ['Some recipe sites don\'t allow apps to read their pages, so not every site can be imported from a link.'],
      fallback: true,
    };
  }
  if (status) {
    return {
      kind: 'error',
      title: 'The website didn\'t return the recipe',
      lines: [`The site answered with error ${status}. Try again later, or use one of the options below.`],
      fallback: true,
    };
  }
  return { kind: 'error', title: 'Website import failed', lines: [message], fallback: true };
}

export const paprikaImportError = (message: string): ImportNotice => ({ kind: 'error', title: 'Paprika import failed', lines: [message] });
