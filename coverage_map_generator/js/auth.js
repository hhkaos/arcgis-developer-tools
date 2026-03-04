import OAuthInfo from "https://js.arcgis.com/4.31/@arcgis/core/identity/OAuthInfo.js";
import esriId from "https://js.arcgis.com/4.31/@arcgis/core/identity/IdentityManager.js";
import { CLIENT_ID, PORTAL_URL } from "./config.js";

const sharingUrl = `${PORTAL_URL}/sharing`;
const sharingRestUrl = `${PORTAL_URL}/sharing/rest`;
const authResources = [sharingUrl, sharingRestUrl];
const redirectUri = `${window.location.origin}/index.html`;
const DEBUG_AUTH = true;

let initialized = false;

function logAuth(...args) {
  if (!DEBUG_AUTH) return;
  // eslint-disable-next-line no-console
  console.info("[auth]", ...args);
}

function logAuthWarn(...args) {
  if (!DEBUG_AUTH) return;
  // eslint-disable-next-line no-console
  console.warn("[auth]", ...args);
}

async function checkExistingCredential() {
  for (const resource of authResources) {
    try {
      const credential = await esriId.checkSignInStatus(resource);
      logAuth("existing credential found for resource:", resource, "user:", credential?.userId || "unknown");
      return credential;
    } catch (error) {
      logAuthWarn("checkSignInStatus failed for resource:", resource, "message:", error?.message || error);
    }
  }
  return null;
}

async function getCredentialWithFallback() {
  try {
    const credential = await esriId.getCredential(sharingUrl);
    logAuth("credential acquired via resource:", sharingUrl, "user:", credential?.userId || "unknown");
    return credential;
  } catch (primaryError) {
    logAuthWarn("getCredential failed for primary resource. Retrying fallback.", primaryError?.message || primaryError);
    const credential = await esriId.getCredential(sharingRestUrl);
    logAuth("credential acquired via fallback resource:", sharingRestUrl, "user:", credential?.userId || "unknown");
    return credential;
  }
}

function ensureConfigured() {
  if (initialized) return;

  if (!CLIENT_ID || CLIENT_ID === "YOUR_CLIENT_ID_HERE") {
    throw new Error("Missing ArcGIS CLIENT_ID in js/config.js");
  }

  esriId.registerOAuthInfos([
    new OAuthInfo({
      appId: CLIENT_ID,
      popup: false,
      portalUrl: PORTAL_URL,
      redirectUri,
    }),
  ]);

  logAuth("OAuth configured", { portalUrl: PORTAL_URL, redirectUri, appId: CLIENT_ID });
  initialized = true;
}

export async function initAuth() {
  ensureConfigured();
  const credential = await checkExistingCredential();
  if (credential) {
    return credential;
  }

  const params = new URLSearchParams(window.location.search);
  const hasOAuthResponse = params.has("code") && params.has("state");
  if (!hasOAuthResponse) {
    logAuth("no existing credential and no OAuth response params in URL");
    return null;
  }

  logAuth("OAuth response detected in URL; exchanging code for credential");
  const resolvedCredential = await getCredentialWithFallback();
  window.history.replaceState({}, document.title, window.location.pathname);
  return resolvedCredential;
}

export async function signIn() {
  ensureConfigured();
  logAuth("signIn initiated");
  return getCredentialWithFallback();
}

export function signOut() {
  ensureConfigured();
  esriId.destroyCredentials();
}

export async function getToken() {
  ensureConfigured();
  const credential = await getCredentialWithFallback();
  return credential.token;
}

export async function getCurrentCredential() {
  ensureConfigured();
  return checkExistingCredential();
}
