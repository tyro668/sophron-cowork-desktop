/**
 * One redaction pass for everything a generated program prints before it reaches the model or
 * the UI: known secret values (app config, process env, the secret store) plus the generic
 * patterns of redactSecrets (bearer tokens, keys in URLs, JWTs, …).
 */
import { collectSecretValues, redactSecrets } from '../../shared/fix-error';

type SecretSource = () => string[];
const sources = new Set<SecretSource>();

/** Register a provider of secret values (config store, secret store). Returns an unregister. */
export function registerSecretSource(source: SecretSource): () => void {
  sources.add(source);
  return () => sources.delete(source);
}

export function knownSecretValues(): string[] {
  const values = new Set(collectSecretValues(process.env));
  for (const source of sources) {
    try {
      for (const value of source()) if (value && value.length >= 6) values.add(value);
    } catch {
      // A failing source must not break redaction of the others.
    }
  }
  return [...values];
}

export function redactOutput(text: string, extra: string[] = []): string {
  if (!text) return text;
  return redactSecrets(text, [...knownSecretValues(), ...extra]);
}
