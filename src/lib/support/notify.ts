import { APP_NAME } from "@/lib/brand";

/**
 * Emails a Contact Us submission to the support inbox via Resend's REST API.
 *
 * The support_requests row is the source of truth — this notification is a
 * convenience so someone sees the request without opening the admin page.
 * Every failure path returns rather than throws: a submission the user already
 * completed must never be reported back to them as an error because a third
 * party was down.
 *
 * With RESEND_API_KEY unset (local dev, preview deploys) this is a no-op and
 * Contact Us behaves exactly as it did before email existed.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const SUPPORT_TO =
  process.env.SUPPORT_EMAIL_TO ?? "contactus@stockduelgames.com";
const SUPPORT_FROM =
  process.env.SUPPORT_EMAIL_FROM ??
  `${APP_NAME} Support <support@stockduelgames.com>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendSupportEmail(params: {
  userEmail: string;
  userId: string;
  supportCode: string | null;
  message: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY not set" };
  }

  const code = params.supportCode ?? "—";
  const subject = params.supportCode
    ? `${APP_NAME} support — ${params.supportCode}`
    : `${APP_NAME} support — ${params.userEmail}`;

  const text = [
    `From: ${params.userEmail}`,
    `League support code: ${code}`,
    `User ID: ${params.userId}`,
    "",
    params.message,
  ].join("\n");

  const html = [
    `<p><strong>From:</strong> ${escapeHtml(params.userEmail)}</p>`,
    `<p><strong>League support code:</strong> ${escapeHtml(code)}</p>`,
    `<p><strong>User ID:</strong> ${escapeHtml(params.userId)}</p>`,
    `<hr />`,
    `<p style="white-space:pre-wrap">${escapeHtml(params.message)}</p>`,
  ].join("\n");

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SUPPORT_FROM,
        to: [SUPPORT_TO],
        // Replying in the mail client goes straight back to the user.
        reply_to: params.userEmail,
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }

    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return { sent: false, reason };
  }
}
