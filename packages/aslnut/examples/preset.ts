import { AslnutError } from '../src/core/world/errors.ts';

/** Validate the shared example query before starting a scene. */
export function presetOf(query: URLSearchParams, known: readonly string[], fallback: string): string {
  const name = query.get('go') ?? fallback;
  if (known.includes(name)) return name;
  const message = `Unknown preset '${name}'. Known presets: ${known.join(', ')}`;
  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;inset:16px 16px auto;z-index:2147483647;padding:16px;background:#fff;color:#111;font:16px/1.5 sans-serif;white-space:pre-wrap';
  notice.textContent = message;
  document.body.appendChild(notice);
  throw new AslnutError('E-DATA-001', message, { fix: 'choose one of the listed presets in ?go=' });
}
