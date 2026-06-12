// Minimal WebAuthn helper for "enable biometrics on this device".
// This is a frontend-only demo: we register a credential and store its ID locally.

const CRED_KEY = "jm-biometric-credential";

export function isWebAuthnSupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export async function isPlatformAuthenticatorAvailable() {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function randomBytes(len: number) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

export async function registerBiometric(userId: string, userName: string) {
  if (!isWebAuthnSupported()) throw new Error("WebAuthn no soportado en este dispositivo");
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: randomBytes(32),
    rp: { name: "Josias Muebles" },
    user: {
      id: new TextEncoder().encode(userId),
      name: userName,
      displayName: userName,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    timeout: 60000,
    attestation: "none",
  };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No se pudo registrar la biometría");
  const id = cred.id;
  localStorage.setItem(CRED_KEY, id);
  return id;
}

export function hasRegisteredBiometric() {
  return !!localStorage.getItem(CRED_KEY);
}

export function clearBiometric() {
  localStorage.removeItem(CRED_KEY);
}

export async function verifyBiometric() {
  const id = localStorage.getItem(CRED_KEY);
  if (!id) throw new Error("No hay biometría registrada");
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: randomBytes(32),
    timeout: 60000,
    userVerification: "required",
    allowCredentials: [
      {
        id: Uint8Array.from(atob(id.replace(/-/g, "+").replace(/_/g, "/").padEnd(id.length + ((4 - (id.length % 4)) % 4), "=")), (c) => c.charCodeAt(0)),
        type: "public-key",
      },
    ],
  };
  const assertion = await navigator.credentials.get({ publicKey });
  if (!assertion) throw new Error("Verificación cancelada");
  return true;
}
