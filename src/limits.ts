// WhatsApp Cloud API hard limits. Over-long titles get cut off on the phone
// without any API error, so we refuse to send them at all.

export const LIMITS = {
  buttonsMax: 3,
  buttonTitle: 20,
  listRowsMax: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listSectionTitle: 24,
  listButtonText: 20,
  interactiveBody: 1024,
  text: 4096,
  id: 200,
} as const;

export interface Button {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export function validateButtons(body: string, buttons: Button[]): string | null {
  if (buttons.length < 1 || buttons.length > LIMITS.buttonsMax) {
    return `buttons: need 1-${LIMITS.buttonsMax}, got ${buttons.length}`;
  }
  if (body.length > LIMITS.interactiveBody) return `body over ${LIMITS.interactiveBody} chars`;
  for (const b of buttons) {
    if (b.title.length > LIMITS.buttonTitle) return `button title "${b.title}" over ${LIMITS.buttonTitle} chars`;
    if (b.id.length > LIMITS.id) return `button id over ${LIMITS.id} chars`;
  }
  return null;
}

export function validateList(body: string, buttonText: string, sectionTitle: string, rows: ListRow[]): string | null {
  if (rows.length < 1 || rows.length > LIMITS.listRowsMax) {
    return `list: need 1-${LIMITS.listRowsMax} rows, got ${rows.length}`;
  }
  if (body.length > LIMITS.interactiveBody) return `body over ${LIMITS.interactiveBody} chars`;
  if (buttonText.length > LIMITS.listButtonText) return `list button "${buttonText}" over ${LIMITS.listButtonText} chars`;
  if (sectionTitle.length > LIMITS.listSectionTitle) return `section title over ${LIMITS.listSectionTitle} chars`;
  for (const r of rows) {
    if (r.title.length > LIMITS.listRowTitle) return `row title "${r.title}" over ${LIMITS.listRowTitle} chars`;
    if (r.description !== undefined && r.description.length > LIMITS.listRowDescription) {
      return `row description for "${r.title}" over ${LIMITS.listRowDescription} chars`;
    }
    if (r.id.length > LIMITS.id) return `row id over ${LIMITS.id} chars`;
  }
  return null;
}

export function validateText(body: string): string | null {
  if (body.length === 0) return "text is empty";
  if (body.length > LIMITS.text) return `text over ${LIMITS.text} chars`;
  return null;
}
