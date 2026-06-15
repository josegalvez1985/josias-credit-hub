// Minimal WebAuthn helper for "enable biometrics on this device".
// This is a frontend-only demo: we register a credential and store its ID locally.

const CRED_KEY = "jm-biometric-credential";
const SECRET_KEY = "jm-biometric-secret";

// Guarda credenciales (username/password) ofuscadas para reusarlas tras verificar
// la huella. Nota: localStorage no es almacenamiento seguro; esto es ofuscación,
// no cifrado fuerte. El acceso queda protegido por la verificación biométrica.
export function storeBiometricSecret(username: string, password: string) {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ username, password }))));
  localStorage.setItem(SECRET_KEY, payload);
}

export function getBiometricSecret(): { username: string; password: string } | null {
  const raw = localStorage.getItem(SECRET_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch {
    return null;
  }
}

function clearBiometricSecret() {
  localStorage.removeItem(SECRET_KEY);
}

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
    rp: { name: "Créditos" },
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
  clearBiometricSecret();
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
