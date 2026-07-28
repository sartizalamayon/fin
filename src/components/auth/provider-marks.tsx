/**
 * Brand marks for the OAuth buttons, inlined as SVG.
 *
 * Inline rather than remote images: a sign-in button that waits on a CDN is a
 * sign-in button that sometimes renders blank, and these never change.
 * Both are drawn at the brands' own colours, which stay legible on light and
 * dark backgrounds, so they are not theme-swapped.
 */

export function GoogleMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.21 7.21 0 0 1 0-4.56V6.63H1.26a12 12 0 0 0 0 10.74l4.01-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.63l4.01 3.09C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

export function OutlookMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path fill="#F25022" d="M1 1h10.2v10.2H1z" />
      <path fill="#7FBA00" d="M12.8 1H23v10.2H12.8z" />
      <path fill="#00A4EF" d="M1 12.8h10.2V23H1z" />
      <path fill="#FFB900" d="M12.8 12.8H23V23H12.8z" />
    </svg>
  );
}
